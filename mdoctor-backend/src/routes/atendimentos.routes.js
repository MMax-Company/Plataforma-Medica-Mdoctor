const { randomUUID } = require('crypto');
const express = require('express');
const eligibilityEngine = require('../eligibility/engine');
const { sendPrescription, isDryRunMode } = require('../delivery/delivery.service');
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
const { isMedicalQueue, isSupportQueue } = require('../constants/whatsapp-queue');
const { isVisibleInMedicalPanel, hasStoredPreviousPrescription } = require('../services/clinical-payload-normalizer.service');
const { listWhatsAppSupportQueue, startSupportAttendance, finalizeSupportAttendance } = require('../services/whatsapp-support.service');
const { createViewSignedUrl } = require('../services/previous-prescription-storage.service');
const { isDeliveryMockEnabled } = require('../config/memed-runtime');
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

  const receipt = atendimento.dados_clinicos?.memed_receita || {};
  // validated_at só é obrigatório quando o fluxo de validação explícita ocorreu (status ready/validated).
  // Para receita_emitida (validate ainda não disparou), exigir apenas que a receita exista com URL.
  if (status !== 'receita_emitida' && !receipt.validated_at && !receipt.validatedAt) {
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
  const atendimentos = await listAtendimentos({ status: req.query.status });
  const scope = String(req.query.scope || 'medical').toLowerCase();
  const filtered =
    scope === 'all'
      ? atendimentos
      : scope === 'support'
        ? atendimentos.filter((item) => isSupportQueue(item))
        : atendimentos.filter((item) => isMedicalQueue(item) && isVisibleInMedicalPanel(item));
  res.json({ success: true, atendimentos: filtered, scope });
});

router.get('/support-queue', requireAuth, async (_req, res) => {
  const atendimentos = await listWhatsAppSupportQueue();
  res.json({ success: true, atendimentos, total: atendimentos.length });
});

router.post('/:id/support/start', requireAuth, async (req, res) => {
  try {
    const atendimento = await startSupportAttendance(req.params.id);
    return res.json({ success: true, atendimento });
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

router.get('/queue', requireAuth, async (_req, res) => {
  const atendimentos = await listAtendimentos();
  const terminal = new Set([STATUS.DELIVERED, STATUS.REJECTED, 'cancelado']);
  const paid = atendimentos.filter((item) => isPaid(item));
  const activeEligible = paid.filter((item) => {
    const st = String(item.status || '').toLowerCase();
    if (terminal.has(st)) return false;
    return isClinicallyEligible(item) && isVisibleInMedicalPanel(item);
  });
  const rejectedPaid = paid.filter((item) => {
    const st = String(item.status || '').toLowerCase();
    return st === 'rejected' || st === 'recusado' || item.elegibilidade?.eligible === false;
  });
  const merged = [...activeEligible];
  for (const row of rejectedPaid) {
    if (!merged.some((item) => item.id === row.id)) merged.push(row);
  }
  res.json({
    success: true,
    atendimentos: merged
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
  const { cpf, phone, name, birth_date } = req.query;
  const hasCpf = Boolean(String(cpf || '').replace(/\D/g, ''));
  const hasPhone = Boolean(String(phone || '').replace(/\D/g, ''));
  const hasNameDob = Boolean(String(name || '').trim()) && Boolean(String(birth_date || '').trim());

  if (!hasCpf && !hasPhone && !hasNameDob) {
    return res.status(400).json({
      success: false,
      error: 'Informe CPF, telefone, ou nome completo + data de nascimento'
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
  const nameLower = hasNameDob ? normText(name) : null;
  const birthNorm = hasNameDob ? normDate(birth_date) : null;

  const rows = await listAtendimentos();

  const matched = rows.filter((item) => {
    if (cpfDigits) {
      const c = normDigits(item.paciente_cpf);
      return c.length > 0 && c === cpfDigits;
    }
    if (phoneDigits) {
      const p = normDigits(item.paciente_telefone);
      if (!p) return false;
      return p === phoneDigits || p.endsWith(phoneDigits) || phoneDigits.endsWith(p);
    }
    if (nameLower && birthNorm) {
      const nameMatch = normText(item.paciente_nome).includes(nameLower);
      if (!nameMatch) return false;
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

router.get('/:id', requireAuth, async (req, res) => {
  const atendimento = await getAtendimento(req.params.id);
  if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
  return res.json({ success: true, atendimento });
});

router.get('/:id/previous-prescription/view-url', requireAuth, async (req, res) => {
  const atendimento = await getAtendimento(req.params.id);
  if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });

  const clinical = atendimento.dados_clinicos || {};
  if (!hasStoredPreviousPrescription(clinical)) {
    return res.status(404).json({ success: false, error: 'Nenhuma receita anterior anexada neste atendimento' });
  }

  const storagePath = clinical.previous_prescription_storage_path;
  if (storagePath) {
    try {
      const viewUrl = await createViewSignedUrl(storagePath);
      return res.json({
        success: true,
        viewUrl,
        mimeType: clinical.previous_prescription_mime_type || null,
        uploadedAt: clinical.previous_prescription_uploaded_at || null
      });
    } catch (error) {
      return res.status(502).json({
        success: false,
        error: error.message || 'Falha ao gerar link de visualização'
      });
    }
  }

  const fallbackUrl =
    clinical.previous_prescription_url ||
    clinical.foto_receita_url ||
    clinical.previous_prescription_file ||
    null;

  if (!fallbackUrl) {
    return res.status(404).json({ success: false, error: 'URL da receita anterior indisponível' });
  }

  return res.json({
    success: true,
    viewUrl: fallbackUrl,
    mimeType: clinical.previous_prescription_mime_type || null,
    uploadedAt: clinical.previous_prescription_uploaded_at || null
  });
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
    atendimento: result.atendimento,
    decisao: result.decisao,
    memed: result.memed
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
    atendimento: result.atendimento,
    decisao: result.decisao,
    notification: result.notification,
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
  const receiptUrl =
    receipt.pdfUrl ||
    receipt.receitaUrl ||
    (isDeliveryMockEnabled() ? `/api/prescriptions/${req.params.id}/pdf` : '') ||
    (isContingency ? 'contingency' : '');
  if (!receiptUrl) {
    return res.status(400).json({ success: false, error: 'Receita Memed não encontrada para entrega', correlationId });
  }

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

  let delivery;
  try {
    if (isContingency) {
      const evo = require('../services/providers/evolution.provider');
      if (!evo.isConfigured()) throw Object.assign(new Error('WhatsApp não configurado'), { code: 'PROVIDER_NOT_CONFIGURED' });
      const sendResult = await evo.sendTextMessage({
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
        provider: 'evolution',
        status: 'sent',
        sent_at: new Date().toISOString(),
        providerMessageId: sendResult?.key?.id || null
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
