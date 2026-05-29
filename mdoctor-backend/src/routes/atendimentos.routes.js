const express = require('express');
const eligibilityEngine = require('../eligibility/engine');
const { sendPrescription, isDryRunMode } = require('../delivery/delivery.service');
const { requireAuth } = require('../auth/auth.middleware');
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
const { isMedicalQueue, isSupportQueue } = require('../constants/whatsapp-queue');
const { isVisibleInMedicalPanel } = require('../services/clinical-payload-normalizer.service');
const { listWhatsAppSupportQueue } = require('../services/whatsapp-support.service');

const router = express.Router();

function isPaid(atendimento = {}) {
  return String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
}

function isClinicallyEligible(atendimento = {}) {
  return atendimento.elegibilidade?.eligible === true || atendimento.risco === 'BAIXO';
}

function isDeliveryMockEnabled() {
  return process.env.DELIVERY_MOCK_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
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
  const readyStatuses = new Set(['ready', 'validated', 'receita_emitida', 'aprovado']);

  if (!readyStatuses.has(status)) {
    return {
      ok: false,
      statusCode: 422,
      error: 'Receita só pode ser enviada após validação Memed (status ready).'
    };
  }

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

router.get('/', async (req, res) => {
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

router.get('/queue', async (_req, res) => {
  const atendimentos = await listAtendimentos({
    status: [
      STATUS.FILA,
      STATUS.QUEUE,
      STATUS.EM_ATENDIMENTO,
      STATUS.UNDER_REVIEW,
      STATUS.MEMED_PROCESSING,
      STATUS.AWAITING_VALIDATION,
      STATUS.PRONTO_PARA_DECISAO,
      STATUS.APROVADO,
      STATUS.VALIDATED,
      STATUS.RECEITA_EMITIDA
    ].join(',')
  });
  res.json({
    success: true,
    atendimentos: atendimentos.filter((item) => isPaid(item) && isClinicallyEligible(item))
  });
});

router.post('/', async (req, res) => {
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

router.get('/:id', async (req, res) => {
  const atendimento = await getAtendimento(req.params.id);
  if (!atendimento) return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
  return res.json({ success: true, atendimento });
});

router.get('/:id/decisoes', async (req, res) => {
  const decisoes = await listDecisoesLog(req.params.id);
  return res.json({ success: true, decisoes });
});

router.patch('/:id/clinical', requireAuth, async (req, res) => {
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

router.post('/:id/clinical/approve', requireAuth, async (req, res) => {
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

router.post('/:id/clinical/reject', requireAuth, async (req, res) => {
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
    notification: result.notification
  });
});

router.post('/:id/clinical/validate', requireAuth, async (req, res) => {
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

  return res.json({ success: true, correlationId, atendimento, decisao });
});

router.post('/:id/deliver', requireAuth, async (req, res) => {
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';
  const { channel = 'whatsapp', doctorId, medicoId } = req.body || {};
  const authenticatedDoctorId = req.user?.sub || medicoId || doctorId || null;
  const allowedChannels = new Set(['whatsapp', 'email', 'sms']);
  if (!allowedChannels.has(channel)) {
    return res.status(400).json({ success: false, error: 'Canal de entrega inválido', correlationId });
  }

  const previous = await getAtendimento(req.params.id);
  if (!previous) return res.status(404).json({ success: false, error: 'Atendimento não encontrado', correlationId });

  const deliverGuard = assertCanDeliverPrescription(previous);
  if (!deliverGuard.ok) {
    return res.status(deliverGuard.statusCode || 422).json({
      success: false,
      error: deliverGuard.error,
      code: 'DELIVERY_NOT_ALLOWED',
      correlationId
    });
  }

  const receipt = previous.dados_clinicos?.memed_receita || {};
  const receiptUrl = receipt.pdfUrl || receipt.receitaUrl || (isDeliveryMockEnabled() ? `/api/prescriptions/${req.params.id}/pdf` : '');
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
    if (isDeliveryMockEnabled() && !(channel === 'whatsapp' && isDryRunMode())) {
      delivery = {
        id: `delivery-mock-${Date.now()}`,
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
      id: `delivery-failed-${Date.now()}`,
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

  const atendimento = await updateAtendimentoStatus(req.params.id, STATUS.DELIVERED, {
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
  });

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
