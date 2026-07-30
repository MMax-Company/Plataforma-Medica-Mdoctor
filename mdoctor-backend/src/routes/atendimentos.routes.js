const { randomUUID } = require('crypto');
const express = require('express');
const eligibilityEngine = require('../eligibility/engine');
const {
  sendPrescription,
  sendWhatsAppText,
  resolveWhatsAppProvider,
  isDryRunMode,
  buildPrescriptionDeliveryWhatsAppMessage
} = require('../delivery/delivery.service');
const {
  enqueueClinicalPrescriptionDelivery,
  findPendingPrescriptionDeliveryMessage,
  claimRejectionMessageForSend,
  finishRejectionMessage
} = require('../store/whatsapp-outbox.store');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { requireIngressOrAuth } = require('../middlewares/ingress-service-auth');
const { createAuditLog } = require('../store/audit.store');
const {
  VALID_STATUS,
  STATUS,
  normalizeStatus,
  listAtendimentos,
  getAtendimento,
  createAtendimento,
  updateAtendimentoStatus,
  createDecisaoLog,
  listDecisoesLog,
  createEntregaReceitaLog
} = require('../store/atendimentos.store');
const { buildClinicalNarrative, PROTOCOL_VERSION } = require('../services/clinical-intelligence.service');
const { approveAtendimento, rejectAtendimento } = require('../services/clinical-decision.service');
const { listRejectReasons } = require('../constants/clinical-reject-reasons');
const { isMedicalQueue, isMedicalSupportQueue } = require('../constants/whatsapp-queue');
const { isVisibleInMedicalPanel, hasStoredPreviousPrescription } = require('../services/clinical-payload-normalizer.service');
const {
  listWhatsAppSupportQueue,
  startSupportAttendance,
  finalizeSupportAttendance,
  forwardSupportTicketToDoctor,
  answerSupportTicketAsDoctor,
  closeSupportTicketByAdmin,
  listMedicalForwardedTickets
} = require('../services/whatsapp-support.service');
const {
  buildInvalidatedPrescriptionClinical,
  createViewSignedUrl,
  resolvePreviousPrescriptionStoragePath
} = require('../services/previous-prescription-storage.service');
const { isDeliveryMockEnabled } = require('../config/memed-runtime');
const { fetchPrescriptionArtifacts } = require('../services/memed-prescription-api.service');
const { triggerPostDeliverySurvey } = require('../services/post-delivery-survey.service');
const { getPrescriptionByAtendimento, savePrescription } = require('../store/prescriptions.store');
const logger = require('../config/logger');

const router = express.Router();

function isPaid(atendimento = {}) {
  return String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
}

function isClinicallyEligible(atendimento = {}) {
  return atendimento.elegibilidade?.eligible === true || atendimento.risco === 'BAIXO';
}

function maskTarget(target = '') {
  return String(target).includes('@')
    ? String(target).replace(/^(.{2}).*(@.*)$/, '$1***$2')
    : String(target).replace(/\d(?=\d{4})/g, '*');
}

function listPreviousDeliveries(clinical = {}) {
  if (Array.isArray(clinical.entregas_receita)) return clinical.entregas_receita;
  if (clinical.entrega_receita) return [clinical.entrega_receita];
  return [];
}

function hasSuccessfulDelivery(deliveries = [], channel = '') {
  return deliveries.some((item) => item?.channel === channel && item?.status === 'sent');
}

function assertCanDeliverPrescription(atendimento = {}) {
  const status = String(atendimento.status || '').toLowerCase();
  const readyStatuses = new Set(['ready', 'validated', 'aprovado', 'receita_emitida']);

  if (!readyStatuses.has(status)) {
    return {
      ok: false,
      statusCode: 422,
      error: 'Receita só pode ser enviada após validação Memed (status ready).'
    };
  }

  // Fase 3 pedido 2: entrega exige emissão E validação médica confirmadas —
  // sem exceção por status (receita_emitida sozinho não basta mais).
  const receipt = atendimento.dados_clinicos?.memed_receita || {};
  if (!receipt.validated_at && !receipt.validatedAt) {
    return { ok: false, statusCode: 422, error: 'Receita ainda não foi validada pelo médico.' };
  }

  if (atendimento.dados_clinicos?.memed_bloqueado === true) {
    return { ok: false, statusCode: 409, error: 'Atendimento reprovado — envio de receita bloqueado.' };
  }

  return { ok: true };
}

function buildHistoricoReceita(receipt = {}, doctorId = null, delivery = null) {
  const timestamp = new Date().toISOString();
  return {
    pdf_url: receipt.pdfUrl || receipt.pdf_url || null,
    imagem_url: receipt.imageUrl || receipt.imagem_url || null,
    link_memed: receipt.receitaUrl || receipt.link || receipt.pdfUrl || null,
    receita_id: receipt.receitaId || receipt.providerPrescriptionId || receipt.id || null,
    status_prescricao: receipt.validated_at || receipt.validatedAt ? 'validated' : 'processing',
    emitida_em: receipt.gerada_em || receipt.createdAt || timestamp,
    validada_em: receipt.validated_at || receipt.validatedAt || null,
    medico_responsavel: doctorId || receipt.validated_by || null,
    ultimo_canal: delivery?.channel || null,
    ultimo_envio_em: delivery?.sent_at || null,
    entregas: delivery ? [delivery] : []
  };
}

router.get('/', requireAuth, async (req, res) => {
  const scope = String(req.query.scope || 'medical').toLowerCase();
  if (scope === 'support') {
    const tickets = await listWhatsAppSupportQueue();
    return res.json({ success: true, tickets, atendimentos: tickets, scope });
  }

  const atendimentos = await listAtendimentos({ status: req.query.status });
  const filtered = scope === 'all'
    ? atendimentos
    : atendimentos.filter((item) => isMedicalQueue(item) && isVisibleInMedicalPanel(item));
  res.json({ success: true, atendimentos: filtered, scope });
});

router.get('/support-queue', requireAuth, async (_req, res) => {
  const tickets = await listWhatsAppSupportQueue();
  // `atendimentos` permanece como alias temporário para não quebrar o painel
  // atual; cada item usa `id`/`ticket_id` do support_tickets e traz o
  // atendimento clínico relacionado separadamente em `atendimento_id`.
  res.json({ success: true, tickets, atendimentos: tickets, total: tickets.length });
});

router.post('/:id/support/start', requireAuth, async (req, res) => {
  try {
    const ticket = await startSupportAttendance(req.params.id);
    return res.json({ success: true, ticket });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/:id/support/finalize', requireAuth, async (req, res) => {
  try {
    const result = await finalizeSupportAttendance(req.params.id);
    return res.json({ success: true, messageText: result.messageText });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// ─── Suporte Geral: ciclo administrativo → médico → administrativo ─────────
// Opera sobre o próprio support_ticket (nunca sobre um atendimento clínico
// nem cria um). Distinto e independente do bloco "Suporte Médico" abaixo,
// que escala atendimentos clínicos reais — os dois fluxos não se cruzam.

router.get('/support-queue/medical', requireAuth, async (_req, res) => {
  try {
    const tickets = await listMedicalForwardedTickets();
    res.json({ success: true, tickets, total: tickets.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/:id/support/forward-to-doctor', requireAuth, async (req, res) => {
  try {
    const ticket = await forwardSupportTicketToDoctor(req.params.id, {
      motivo: req.body?.motivo,
      actor: req.user?.name || req.user?.username || null
    });
    return res.json({ success: true, ticket });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/:id/support/answer', requireAuth, async (req, res) => {
  try {
    const ticket = await answerSupportTicketAsDoctor(req.params.id, {
      resposta: req.body?.resposta,
      actor: req.user?.name || req.user?.username || null
    });
    return res.json({ success: true, ticket });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/:id/support/close', requireAuth, async (req, res) => {
  try {
    const ticket = await closeSupportTicketByAdmin(req.params.id, {
      actor: req.user?.name || req.user?.username || null
    });
    return res.json({ success: true, ticket });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// ─── Suporte Médico: fila de encaminhamento (admin → médico) ────────────────
// Diferente de /support/*, que é Suporte Geral (WhatsApp, sem revisão clínica).
// Aqui o atendimento já é um caso clínico real, temporariamente marcado com
// dados_clinicos.queue_type='medical_support' por admin.routes.js
// (forward-to-doctor). requireRole('admin','doctor') porque é decisão médica,
// no mesmo padrão de /clinical/approve|reject|validate.

router.get('/medical-support-queue', requireAuth, requireRole('admin', 'doctor'), async (_req, res) => {
  const atendimentos = (await listAtendimentos()).filter((item) => isMedicalSupportQueue(item));
  res.json({ success: true, atendimentos, total: atendimentos.length });
});

router.post('/:id/medical-support/resolve', requireAuth, requireRole('admin', 'doctor'), async (req, res) => {
  try {
    const atendimento = await getAtendimento(req.params.id);
    if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
    if (!isMedicalSupportQueue(atendimento)) {
      return res.status(400).json({ success: false, error: 'Atendimento não está na fila de suporte médico' });
    }

    const { queue_type, ...restClinical } = atendimento.dados_clinicos || {};
    const updated = await updateAtendimentoStatus(req.params.id, atendimento.status, {
      // preserva medico_id/motivo_decisao — updateAtendimentoStatus os zera se
      // não forem repassados explicitamente, e esta ação não deve alterá-los.
      medicoId: atendimento.medico_id,
      motivo: atendimento.motivo_decisao,
      dados_clinicos: {
        ...restClinical,
        medical_support_resolved_at: new Date().toISOString(),
        medical_support_resolved_by: req.user?.name || req.user?.username || null,
      },
    });

    await createAuditLog({
      entity_type: 'atendimento',
      entity_id: req.params.id,
      action: 'medical_support_resolved',
      actor: req.user?.name || req.user?.username || 'doctor',
      payload: { atendimento_id: req.params.id },
    });

    res.json({ success: true, atendimento: updated });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.post('/:id/medical-support/return', requireAuth, requireRole('admin', 'doctor'), async (req, res) => {
  try {
    const atendimento = await getAtendimento(req.params.id);
    if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
    if (!isMedicalSupportQueue(atendimento)) {
      return res.status(400).json({ success: false, error: 'Atendimento não está na fila de suporte médico' });
    }

    const { queue_type, ...restClinical } = atendimento.dados_clinicos || {};
    const notasExistentes = Array.isArray(restClinical.observacoes_admin) ? restClinical.observacoes_admin : [];
    const nota = {
      id: randomUUID(),
      texto: 'Retornado pelo médico após esclarecimento — ver jornada para detalhes.',
      autor: req.user?.name || req.user?.username || 'médico',
      criado_em: new Date().toISOString(),
      resolvido: false,
    };

    const updated = await updateAtendimentoStatus(req.params.id, atendimento.status, {
      medicoId: atendimento.medico_id,
      motivo: atendimento.motivo_decisao,
      dados_clinicos: {
        ...restClinical,
        medical_support_returned_at: new Date().toISOString(),
        observacoes_admin: [...notasExistentes, nota],
      },
    });

    await createAuditLog({
      entity_type: 'atendimento',
      entity_id: req.params.id,
      action: 'medical_support_returned_to_admin',
      actor: req.user?.name || req.user?.username || 'doctor',
      payload: { atendimento_id: req.params.id },
    });

    res.json({ success: true, atendimento: updated });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.get('/queue', requireAuth, async (_req, res) => {
  const atendimentos = await listAtendimentos();
  const terminal = new Set([STATUS.DELIVERED, STATUS.REJECTED, 'cancelado']);
  const paid = atendimentos.filter((item) => isPaid(item));
  const activeEligible = paid.filter((item) => {
    const st = String(item.status || '').toLowerCase();
    if (terminal.has(st)) return false;
    return isClinicallyEligible(item) && isVisibleInMedicalPanel(item);
  });
  res.json({
    success: true,
    atendimentos: activeEligible
  });
});

router.post('/', requireIngressOrAuth, async (req, res) => {
  const clinicalData = req.body?.dados_clinicos || req.body || {};
  const decision = eligibilityEngine.evaluate(clinicalData);
  const clinicalNarrative = buildClinicalNarrative({
    patientName: req.body?.paciente_nome || req.body?.nome || req.body?.name || 'Paciente',
    condition: req.body?.condicao || req.body?.condition || req.body?.doenca_cronica || clinicalData?.condition,
    medication: req.body?.medicacao_em_uso || req.body?.medicamento || clinicalData?.medicacao_em_uso,
    decision
  });
  const paymentStatus =
    typeof req.body?.pagamento === 'boolean'
      ? req.body.pagamento
        ? 'CONFIRMADO'
        : 'PENDENTE'
      : req.body?.pagamento_status || req.body?.pagamento || req.body?.paymentStatus || 'PENDENTE';
  const paymentConfirmed = String(paymentStatus).toUpperCase() === 'CONFIRMADO';
  const requestedStatus = req.body?.status ? normalizeStatus(req.body.status) : null;
  const status = !decision.eligible
    ? STATUS.REJECTED
    : paymentConfirmed
      ? requestedStatus || STATUS.QUEUE
      : STATUS.AGUARDANDO_PAGAMENTO;

  const atendimento = await createAtendimento({
    ...req.body,
    status,
    pagamento_status: paymentStatus,
    risco: decision.eligible ? 'BAIXO' : 'BLOQUEADO',
    elegibilidade: decision,
    dados_clinicos: {
      ...clinicalData,
      protocol_version: decision.protocolVersion || PROTOCOL_VERSION,
      criteria_used: decision.criteriaUsed || [],
      renewal_status: decision.renewalStatus || null,
      risk_level: decision.riskLevel || null,
      clinical_summary: clinicalNarrative.summary,
      queixa_principal: clinicalNarrative.chiefComplaint,
      historico_clinico: clinicalNarrative.clinicalHistory,
      exame_fisico_telemedicina: clinicalNarrative.teleExam,
      conduta_sugerida: clinicalNarrative.conduct,
      orientacoes_clinicas: clinicalNarrative.guidance
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimento.id,
    action: 'atendimento_triage_evaluated',
    actor: 'backend',
    payload: {
      eligible: decision.eligible,
      reason: decision.reason,
      reasonCode: decision.reasonCode || null,
      criteriaUsed: decision.criteriaUsed || [],
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION,
      mode: 'mock'
    }
  });

  res.status(201).json({ success: true, atendimento });
});

router.get('/clinical/reject-reasons', requireAuth, (_req, res) => {
  return res.json({ success: true, reasons: listRejectReasons() });
});

router.get('/search', requireAuth, async (req, res) => {
  const { cpf, phone, name, birth_date, id, atendimento_id } = req.query;
  const idValue = String(id || atendimento_id || '').trim().toLowerCase();
  const hasId = Boolean(idValue);
  const hasCpf = Boolean(String(cpf || '').replace(/\D/g, ''));
  const hasPhone = Boolean(String(phone || '').replace(/\D/g, ''));
  const hasName = Boolean(String(name || '').trim());

  if (!hasId && !hasCpf && !hasPhone && !hasName) {
    return res.status(400).json({
      success: false,
      error: 'Informe ID do atendimento, CPF, telefone ou nome'
    });
  }

  function normDigits(v) { return String(v || '').replace(/\D/g, ''); }
  function normText(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function normDate(v) {
    const s = String(v || '').trim();
    // Accept YYYY-MM-DD or DD/MM/YYYY → normalize to YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return s;
  }

  const cpfDigits = hasCpf ? normDigits(cpf) : null;
  const phoneDigits = hasPhone ? normDigits(phone) : null;
  const nameLower = hasName ? normText(name) : null;
  const birthNorm = hasName && birth_date ? normDate(birth_date) : null;

  const rows = await listAtendimentos();

  const matched = rows.filter((item) => {
    if (hasId) return String(item.id || '').toLowerCase() === idValue;
    if (cpfDigits) {
      const c = normDigits(item.paciente_cpf);
      return c.length > 0 && c === cpfDigits;
    }
    if (phoneDigits) {
      const p = normDigits(item.paciente_telefone);
      if (!p) return false;
      return p === phoneDigits || p.endsWith(phoneDigits) || phoneDigits.endsWith(p);
    }
    if (nameLower) {
      const nameMatch = normText(item.paciente_nome).includes(nameLower);
      if (!nameMatch) return false;
      if (!birthNorm) return true;
      const dob = normDate(item.dados_clinicos?.data_nascimento || item.dados_clinicos?.birth_date || '');
      return dob === birthNorm;
    }
    return false;
  });

  matched.sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));

  const results = matched.map((item) => ({
    id: item.id,
    paciente_nome: item.paciente_nome || '',
    paciente_cpf: item.paciente_cpf || '',
    paciente_telefone: item.paciente_telefone || '',
    data_nascimento: item.dados_clinicos?.data_nascimento || item.dados_clinicos?.birth_date || '',
    criado_em: item.criado_em || '',
    status: item.status || '',
    condicao: item.condicao || ''
  }));

  return res.json({ success: true, results, total: results.length });
});

router.get('/:id/prescription-upload/status', async (req, res) => {
  try {
    const {
      getPrescriptionUploadStatusByAtendimentoId
    } = require('../services/typebot-prescription-upload.service');
    const status = await getPrescriptionUploadStatusByAtendimentoId(req.params.id);
    if (!status.found) {
      return res.status(404).json({
        success: false,
        error: 'Atendimento não encontrado',
        code: 'ATENDIMENTO_NOT_FOUND'
      });
    }
    return res.json({ success: true, ...status });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'PRESCRIPTION_UPLOAD_STATUS_ERROR'
    });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const atendimento = await getAtendimento(req.params.id);
  if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
  return res.json({ success: true, atendimento });
});

router.get('/:id/previous-prescription/view-url', requireAuth, async (req, res) => {
  const atendimento = await getAtendimento(req.params.id);
  if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const clinical = atendimento.dados_clinicos || {};
  let storagePath = await resolvePreviousPrescriptionStoragePath(atendimento.id, clinical);

  if (!storagePath) {
    const invalidatedClinical = buildInvalidatedPrescriptionClinical(clinical);
    await updateAtendimentoStatus(atendimento.id, atendimento.status, {
      dados_clinicos: invalidatedClinical,
      motivo: 'Upload de receita invalidado — arquivo ausente no storage'
    });
    return res.status(404).json({
      success: false,
      error: 'Nenhuma receita válida encontrada para este atendimento. Envie novamente pelo link de upload.',
      code: 'PRESCRIPTION_STORAGE_NOT_FOUND'
    });
  }

  if (storagePath !== clinical.previous_prescription_storage_path) {
    await updateAtendimentoStatus(atendimento.id, atendimento.status, {
      dados_clinicos: {
        ...clinical,
        previous_prescription_storage_path: storagePath,
        previous_prescription_url: null,
        previous_prescription_file: null,
        foto_receita_url: null
      }
    });
  }

  try {
    const viewUrl = await createViewSignedUrl(storagePath);
    return res.json({
      success: true,
      viewUrl,
      storagePath,
      mimeType: clinical.previous_prescription_mime_type || null,
      uploadedAt: clinical.previous_prescription_uploaded_at || null
    });
  } catch (error) {
    if (error.code === 'PRESCRIPTION_STORAGE_NOT_FOUND') {
      await updateAtendimentoStatus(atendimento.id, atendimento.status, {
        dados_clinicos: buildInvalidatedPrescriptionClinical(clinical)
      });
      return res.status(404).json({
        success: false,
        error: 'Arquivo da receita anterior não encontrado. Upload invalidado.',
        code: error.code
      });
    }
    return res.status(502).json({
      success: false,
      error: error.message || 'Falha ao gerar link de visualização'
    });
  }
});

router.get('/:id/decisoes', requireAuth, async (req, res) => {
  const decisoes = await listDecisoesLog(req.params.id);
  return res.json({ success: true, decisoes });
});

router.patch('/:id/clinical', requireRole('admin', 'doctor'), async (req, res) => {
  const authenticatedDoctorId = req.user?.sub || null;
  const previous = await getAtendimento(req.params.id);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const clinical = req.body?.dados_clinicos || {};
  const mergedClinical = {
    ...(previous.dados_clinicos || {}),
    ...clinical
  };

  const atendimento = await updateAtendimentoStatus(req.params.id, previous.status, {
    motivo: 'Prontuário editado pelo médico',
    medicoId: authenticatedDoctorId,
    paciente_nome: req.body?.paciente_nome ?? previous.paciente_nome,
    paciente_telefone: req.body?.paciente_telefone ?? previous.paciente_telefone,
    paciente_cpf: req.body?.paciente_cpf ?? previous.paciente_cpf,
    paciente_email: req.body?.paciente_email ?? previous.paciente_email,
    condicao: req.body?.condicao ?? previous.condicao,
    pagamento_status: req.body?.pagamento_status ?? previous.pagamento_status,
    dados_clinicos: mergedClinical
  });

  if (!atendimento) {
    return res.status(500).json({ success: false, error: 'Não foi possível salvar o prontuário' });
  }

  const decisao = await createDecisaoLog({
    atendimento_id: req.params.id,
    status_anterior: previous.status,
    status_novo: previous.status,
    motivo: 'Prontuário editado pelo médico',
    medico_id: authenticatedDoctorId,
    snapshot: {
      paciente_nome: atendimento.paciente_nome,
      condicao: atendimento.condicao,
      dados_clinicos: mergedClinical
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: req.params.id,
    action: 'clinical_record_updated',
    actor: authenticatedDoctorId || 'backend',
    payload: {
      protocolVersion: PROTOCOL_VERSION,
      mode: 'mock',
      fieldsUpdated: Object.keys(clinical || {}),
      correlationId: req.correlationId || req.get('X-Correlation-Id') || req.requestId || null
    }
  });

  return res.json({ success: true, atendimento, decisao });
});

router.post('/:id/clinical/approve', requireRole('admin', 'doctor'), async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || `approve-${Date.now()}`;
  const doctorId = req.user?.sub || req.body?.medicoId || req.body?.doctorId || null;
  const result = await approveAtendimento(req.params.id, req.body || {}, { doctorId, correlationId });

  if (!result.ok) {
    return res.status(result.statusCode || 500).json({ success: false, error: result.error, correlationId });
  }

  return res.json({
    success: true,
    correlationId,
    duplicate: result.duplicate === true,
    atendimento: result.atendimento,
    decisao: result.decisao,
    memed: result.memed,
    notification: result.notification
  });
});

router.post('/:id/clinical/reject', requireRole('admin', 'doctor'), async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || `reject-${Date.now()}`;
  const doctorId = req.user?.sub || req.body?.medicoId || req.body?.doctorId || null;
  const result = await rejectAtendimento(req.params.id, req.body || {}, { doctorId, correlationId });

  if (!result.ok) {
    return res.status(result.statusCode || 500).json({ success: false, error: result.error, correlationId });
  }

  return res.json({
    success: true,
    correlationId,
    duplicate: result.duplicate === true,
    atendimento: result.atendimento,
    decisao: result.decisao,
    notification: result.notification,
    pendencia_pagamento: result.pendencia_pagamento || null,
    reason_code: result.reason_code,
    reason_label: result.reason_label
  });
});

router.post('/:id/clinical/validate', requireRole('admin', 'doctor'), async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || `validate-${Date.now()}`;
  const doctorId = req.user?.sub || req.body?.medicoId || req.body?.doctorId || null;
  const previous = await getAtendimento(req.params.id);

  if (!previous) {
    return res.status(404).json({ success: false, error: 'Atendimento não encontrado', correlationId });
  }

  const status = String(previous.status || '').toLowerCase();
  if (status === 'rejected' || status === 'recusado') {
    return res.status(409).json({ success: false, error: 'Atendimento reprovado não pode ser validado', correlationId });
  }

  const receipt = previous.dados_clinicos?.memed_receita || {};
  if (!receipt.receitaId && !receipt.memed_id && !receipt.pdfUrl && !receipt.receitaUrl) {
    return res.status(422).json({
      success: false,
      error: 'Nenhuma receita Memed vinculada para validar.',
      correlationId
    });
  }

  const validatableStatuses = new Set([
    STATUS.RECEITA_EMITIDA,
    STATUS.MEMED_PROCESSING,
    STATUS.AWAITING_VALIDATION,
    'receita_emitida',
    'memed_processing'
  ]);
  if (!validatableStatuses.has(status)) {
    return res.status(409).json({
      success: false,
      error: 'Validação só após emissão da receita via Memed (status receita_emitida).',
      correlationId
    });
  }

  const validatedAt = new Date().toISOString();
  const enrichedReceipt = {
    ...receipt,
    validated_at: validatedAt,
    validated_by: doctorId,
    status: 'validated'
  };
  const historicoReceita = {
    ...(previous.dados_clinicos?.historico_receita || {}),
    ...buildHistoricoReceita(enrichedReceipt, doctorId),
    validada_em: validatedAt,
    medico_validador: doctorId
  };

  const atendimento = await updateAtendimentoStatus(req.params.id, STATUS.READY, {
    motivo: req.body?.motivo || 'Receita validada pelo médico na etapa Memed',
    medicoId: doctorId,
    dados_clinicos: {
      ...(previous.dados_clinicos || {}),
      memed_receita: enrichedReceipt,
      historico_receita: historicoReceita,
      clinical_audit: {
        ...(previous.dados_clinicos?.clinical_audit || {}),
        memedValidatedAt: validatedAt,
        memedValidatedBy: doctorId,
        correlationId
      }
    }
  });

  const decisao = await createDecisaoLog({
    atendimento_id: req.params.id,
    status_anterior: previous.status,
    status_novo: STATUS.READY,
    motivo: 'Receita validada pelo médico',
    medico_id: doctorId,
    snapshot: {
      paciente_nome: atendimento?.paciente_nome,
      memed_receita: atendimento?.dados_clinicos?.memed_receita || receipt,
      correlationId
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: req.params.id,
    action: 'memed_prescription_validated',
    actor: doctorId || 'backend',
    payload: { correlationId, protocolVersion: PROTOCOL_VERSION }
  });

  try {
    const existingPrescription = await getPrescriptionByAtendimento(req.params.id);
    if (existingPrescription?.id && existingPrescription.status !== 'validated') {
      await savePrescription({ ...existingPrescription, status: 'validated' });
    }
  } catch { /* atualização de prescriptions.status é best-effort */ }

  return res.json({ success: true, correlationId, atendimento, decisao });
});

router.post('/:id/deliver', requireIngressOrAuth, async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';
  const { channel = 'whatsapp', doctorId, medicoId, contingency = false, contingency_text = '' } = req.body || {};
  const authenticatedDoctorId = req.user?.sub || medicoId || doctorId || null;
  const allowedChannels = new Set(['whatsapp', 'email', 'sms']);
  if (!allowedChannels.has(channel)) {
    return res.status(400).json({ success: false, error: 'Canal de entrega inválido', correlationId });
  }

  const previous = await getAtendimento(req.params.id);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado', correlationId });

  const isContingency = Boolean(contingency) && channel === 'whatsapp';

  if (!isContingency) {
    const deliverGuard = assertCanDeliverPrescription(previous);
    if (!deliverGuard.ok) {
      return res.status(deliverGuard.statusCode || 422).json({
        success: false,
        error: deliverGuard.error,
        code: 'DELIVERY_NOT_ALLOWED',
        correlationId
      });
    }
  }
  const receipt = previous.dados_clinicos?.memed_receita || {};
  let resolvedReceiptUrl =
    receipt.pdfUrl ||
    receipt.receitaUrl ||
    (isDeliveryMockEnabled() ? `/api/prescriptions/${req.params.id}/pdf` : '') ||
    (isContingency ? 'contingency' : '');

  // Tenta recuperar a URL on-demand se não foi persistida mas o memed_id existe
  if (!resolvedReceiptUrl && !isContingency) {
    const memedId = receipt.receitaId
      || receipt.memed_id
      || receipt.payload?.prescricao?.prescriptionUuid;
    if (memedId) {
      try {
        const artifacts = await fetchPrescriptionArtifacts(memedId);
        resolvedReceiptUrl = artifacts.pdfUrl || artifacts.digitalLink || null;
        if (resolvedReceiptUrl) {
          logger.info({ correlationId, memedId }, 'delivery: pdfUrl recuperado on-demand via fetchPrescriptionArtifacts');
        }
      } catch (enrichErr) {
        logger.warn({ correlationId, memedId, err: enrichErr.message }, 'delivery: falha ao recuperar pdfUrl on-demand');
      }
    }
  }

  if (!resolvedReceiptUrl) {
    return res.status(400).json({
      success: false,
      error: 'Receita/PDF ainda não está disponível para envio pelo WhatsApp.',
      correlationId
    });
  }
  const receiptUrl = resolvedReceiptUrl;

  const target =
    channel === 'email'
      ? previous.paciente_email
      : previous.paciente_telefone;

  if (!target && !isDeliveryMockEnabled()) {
    return res.status(400).json({ success: false, error: `Contato do paciente ausente para ${channel}`, correlationId });
  }

  const previousClinical = previous.dados_clinicos || {};
  const previousDeliveries = listPreviousDeliveries(previousClinical);

  if (hasSuccessfulDelivery(previousDeliveries, channel)) {
    return res.status(409).json({
      success: false,
      error: `Receita já enviada por ${channel} para este atendimento.`,
      code: 'DELIVERY_ALREADY_SENT',
      correlationId
    });
  }

  // Fase 3 pedido 2 — trava atômica (índice único em whatsapp_messages,
  // mesmo mecanismo já usado para aprovação/reprovação clínica) contra
  // clique repetido e retry concorrente do Backend: hasSuccessfulDelivery
  // acima é leitura-antes-de-escrever (janela de corrida); esta reserva é
  // quem garante "apenas uma vez" de fato para o canal WhatsApp.
  let outboxClaim = null;
  if (channel === 'whatsapp' && !isContingency) {
    const enqueueResult = await enqueueClinicalPrescriptionDelivery({
      atendimentoId: req.params.id,
      phone: target,
      message: buildPrescriptionDeliveryWhatsAppMessage(receiptUrl),
      doctorId: authenticatedDoctorId,
      correlationId
    });
    if (enqueueResult.duplicate && enqueueResult.message.status === 'sent') {
      return res.status(409).json({
        success: false,
        error: `Receita já enviada por ${channel} para este atendimento.`,
        code: 'DELIVERY_ALREADY_SENT',
        correlationId
      });
    }
    outboxClaim = await claimRejectionMessageForSend(enqueueResult.message.id);
    if (!outboxClaim) {
      return res.status(409).json({
        success: false,
        error: 'Envio da receita por WhatsApp já está em andamento.',
        code: 'DELIVERY_IN_PROGRESS',
        correlationId
      });
    }
  }

  let delivery;
  try {
    if (isContingency) {
      const provider = resolveWhatsAppProvider();
      if (provider === 'mock') throw Object.assign(new Error('WhatsApp não configurado'), { code: 'PROVIDER_NOT_CONFIGURED' });
      const sendResult = await sendWhatsAppText({
        to: target,
        text: String(contingency_text || '').trim() || 'Receita médica enviada pelo Doctor Prescreve.',
        correlationId,
        idempotencyKey: `${req.params.id}:contingency:${correlationId}`
      });
      delivery = {
        id: randomUUID(),
        channel,
        targetMasked: target.replace(/\d(?=\d{4})/g, '*'),
        receiptUrl: 'contingency',
        provider: sendResult?.provider || provider,
        status: 'sent',
        sent_at: new Date().toISOString(),
        providerMessageId: sendResult?.providerMessageId || null
      };
    } else if (isDeliveryMockEnabled() && !(channel === 'whatsapp' && isDryRunMode())) {
      delivery = {
        id: randomUUID(),
        channel,
        targetMasked: maskTarget(target || 'mock-target'),
        receiptUrl,
        provider: 'mock',
        status: 'sent',
        sent_at: new Date().toISOString()
      };
    } else {
      delivery = await sendPrescription({
        channel,
        target,
        receiptUrl,
        pacienteNome: previous.paciente_nome,
        correlationId,
        idempotencyKey: `${req.params.id}:${channel}:${correlationId}`
      });
    }
  } catch (error) {
    if (outboxClaim) {
      await finishRejectionMessage({
        messageId: outboxClaim.id,
        status: 'failed',
        errorMessage: error.message,
        metadata: outboxClaim.metadata
      }).catch(() => {});
    }

    const failedDelivery = {
      id: randomUUID(),
      channel,
      targetMasked: target.includes('@') ? target.replace(/^(.{2}).*(@.*)$/, '$1***$2') : target.replace(/\d(?=\d{4})/g, '*'),
      receiptUrl,
      provider: error.code === 'PROVIDER_NOT_CONFIGURED' ? 'not-configured' : 'provider-error',
      status: 'failed',
      error: error.message,
      attempted_at: new Date().toISOString()
    };

    const atendimento = await updateAtendimentoStatus(req.params.id, previous.status, {
      motivo: `Falha na entrega por ${channel}: ${error.message}`,
      medicoId: authenticatedDoctorId,
      dados_clinicos: {
        ...previousClinical,
        correlation_id: correlationId,
        memed_receita: receipt,
        entrega_receita: failedDelivery,
        entregas_receita: [failedDelivery, ...previousDeliveries]
      }
    });

    await createDecisaoLog({
      atendimento_id: req.params.id,
      status_anterior: previous.status,
      status_novo: previous.status,
      motivo: `Falha na entrega por ${channel}: ${error.message}`,
      medico_id: authenticatedDoctorId,
      snapshot: {
        correlationId,
        delivery: failedDelivery,
        receitaId: receipt.receitaId || null
      }
    });

    await createEntregaReceitaLog({
      id: failedDelivery.id,
      atendimento_id: req.params.id,
      canal: channel,
      provider: failedDelivery.provider,
      status: failedDelivery.status,
      target_masked: failedDelivery.targetMasked,
      erro: failedDelivery.error,
      snapshot: failedDelivery,
      criado_em: failedDelivery.attempted_at
    });

    const statusCode = error.code === 'PROVIDER_NOT_CONFIGURED' ? 503 : 502;
    return res.status(statusCode).json({
      success: false,
      error: error.message,
      code: error.code || 'DELIVERY_FAILED',
      correlationId,
      atendimento,
      delivery: failedDelivery
    });
  }

  if (outboxClaim) {
    await finishRejectionMessage({
      messageId: outboxClaim.id,
      status: 'sent',
      providerMessageId: delivery.providerMessageId || null,
      metadata: outboxClaim.metadata
    });
  }

  const allDeliveries = [delivery, ...previousDeliveries];
  const historicoReceita = {
    ...(previousClinical.historico_receita || buildHistoricoReceita(receipt, authenticatedDoctorId)),
    ...buildHistoricoReceita(receipt, authenticatedDoctorId, delivery),
    entregas: allDeliveries,
    canais_enviados: [...new Set(allDeliveries.filter((item) => item.status === 'sent').map((item) => item.channel))],
    finalizado_em: new Date().toISOString()
  };

  const atendimento =
    (await updateAtendimentoStatus(req.params.id, STATUS.DELIVERED, {
      motivo: `Receita enviada por ${channel}`,
      medicoId: authenticatedDoctorId,
      dados_clinicos: {
        ...previousClinical,
        correlation_id: correlationId,
        memed_receita: receipt,
        historico_receita: historicoReceita,
        entrega_receita: delivery,
        entregas_receita: allDeliveries
      }
    })) || (await getAtendimento(req.params.id));

  const decisao = await createDecisaoLog({
    atendimento_id: req.params.id,
    status_anterior: previous.status,
    status_novo: STATUS.DELIVERED,
    motivo: `Entrega concluída por ${channel}`,
    medico_id: authenticatedDoctorId,
    snapshot: {
      correlationId,
      delivery,
      receitaId: receipt.receitaId || null,
      protocolVersion: PROTOCOL_VERSION,
      mode: receipt.source || 'mock'
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: req.params.id,
    action: 'delivery_completed',
    actor: authenticatedDoctorId || 'backend',
    payload: {
      correlationId,
      channel,
      provider: delivery.provider,
      protocolVersion: PROTOCOL_VERSION,
      mode: receipt.source || 'mock'
    }
  });

  await createEntregaReceitaLog({
    id: delivery.id,
    atendimento_id: req.params.id,
    canal: channel,
    provider: delivery.provider,
    provider_message_id: delivery.providerMessageId,
    status: delivery.status,
    target_masked: delivery.targetMasked,
    snapshot: delivery,
    criado_em: delivery.sent_at
  });

  if (channel === 'whatsapp' && delivery.status === 'sent' && previous.paciente_telefone) {
    setImmediate(() => {
      triggerPostDeliverySurvey({
        attendanceId: req.params.id,
        patientId: previous.patient_id || null,
        phone: previous.paciente_telefone,
        correlationId
      }).catch((error) => {
        logger.error('post_delivery_survey_trigger_failed', {
          correlationId,
          attendanceId: req.params.id,
          error: error.message
        });
      });
    });
  }

  return res.json({ success: true, correlationId, atendimento, decisao, delivery });
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status, motivo, notes, doctorId, medicoId } = req.body || {};
  const authenticatedDoctorId = req.user?.sub || medicoId || doctorId || null;
  if (!status) {
    return res.status(400).json({ success: false, error: 'Status obrigatório', code: 'STATUS_REQUIRED' });
  }

  const normalizedStatus = normalizeStatus(status);
  if (!VALID_STATUS.has(status) && !VALID_STATUS.has(normalizedStatus)) {
    return res.status(400).json({ success: false, error: 'Status inválido', code: 'STATUS_INVALID' });
  }

  const previous = await getAtendimento(req.params.id);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';
  const criteriaUsed = previous?.elegibilidade?.criteriaUsed || [];
  const clinicalAudit = {
    ...(previous?.dados_clinicos?.clinical_audit || {}),
    approvedBy: authenticatedDoctorId,
    approvedAt: new Date().toISOString(),
    criteriaUsed,
    protocolVersion: previous?.elegibilidade?.protocolVersion || previous?.dados_clinicos?.protocol_version || PROTOCOL_VERSION,
    mode: previous?.dados_clinicos?.clinical_audit?.mode || 'mock',
    correlationId,
    decisionRationale: motivo || notes || previous?.elegibilidade?.reason || null
  };

  const atendimento = await updateAtendimentoStatus(req.params.id, normalizedStatus, {
    motivo,
    notes,
    doctorId: authenticatedDoctorId,
    medicoId: authenticatedDoctorId,
    dados_clinicos: {
      ...(previous?.dados_clinicos || {}),
      clinical_audit: clinicalAudit
    }
  });

  if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const decisao = await createDecisaoLog({
    atendimento_id: req.params.id,
    status_anterior: previous.status,
    status_novo: normalizedStatus,
    motivo: motivo || notes || null,
    medico_id: authenticatedDoctorId,
    snapshot: {
      paciente_nome: atendimento.paciente_nome,
      condicao: atendimento.condicao,
      risco: atendimento.risco,
      elegibilidade: atendimento.elegibilidade,
      protocolVersion: atendimento?.dados_clinicos?.protocol_version || PROTOCOL_VERSION
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: req.params.id,
    action: 'status_updated',
    actor: authenticatedDoctorId || 'backend',
    payload: {
      statusBefore: previous.status,
      statusAfter: normalizedStatus,
      reason: motivo || notes || null,
      protocolVersion: atendimento?.dados_clinicos?.protocol_version || PROTOCOL_VERSION,
      mode: atendimento?.dados_clinicos?.clinical_audit?.mode || 'mock',
      criteriaUsed: atendimento?.elegibilidade?.criteriaUsed || [],
      approvedBy: clinicalAudit.approvedBy,
      approvedAt: clinicalAudit.approvedAt,
      correlationId
    }
  });

  return res.json({ success: true, atendimento, decisao });
});

module.exports = router;
// Exposto só para teste isolado (Fase 3 pedido 2) — não muda o comportamento da rota.
module.exports.assertCanDeliverPrescription = assertCanDeliverPrescription;
module.exports.hasSuccessfulDelivery = hasSuccessfulDelivery;
module.exports.listPreviousDeliveries = listPreviousDeliveries;
