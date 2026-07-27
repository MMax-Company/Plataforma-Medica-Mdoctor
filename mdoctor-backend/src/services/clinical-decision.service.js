const { PROTOCOL_VERSION } = require('./clinical-intelligence.service');
const { isVisibleInMedicalPanel } = require('./clinical-payload-normalizer.service');
const { buildRejectMotivoText, validateRejectPayload } = require('../constants/clinical-reject-reasons');
const { createAuditLog } = require('../store/audit.store');
const { STATUS, getAtendimento, updateAtendimentoStatus, createDecisaoLog } = require('../store/atendimentos.store');
const {
  enqueueClinicalRejection,
  enqueueClinicalApproval,
  findPendingRejectionMessage,
  findPendingApprovalMessage,
  claimRejectionMessageForSend,
  finishRejectionMessage
} = require('../store/whatsapp-outbox.store');

const CLINICAL_REJECT_WHATSAPP_MESSAGE =
  'Após avaliação médica, não foi possível emitir a receita solicitada.\n\nNossa equipe analisará as providências administrativas referentes ao pagamento.\n\nCaso precise de ajuda, digite 2 para falar com o suporte.';

const CLINICAL_APPROVE_WHATSAPP_MESSAGE = '✅ Sua solicitação foi aprovada pelo médico.';

function resolveDecisionRationale(rationale, notes) {
  if (rationale && typeof rationale === 'object') {
    return rationale.text || rationale.reasonLabel || notes || null;
  }
  return rationale || notes || null;
}

function buildClinicalAudit(previous, { doctorId, correlationId, decision, rationale, notes }) {
  const timestamp = new Date().toISOString();
  const base = {
    ...(previous?.dados_clinicos?.clinical_audit || {}),
    decision,
    criteriaUsed: previous?.elegibilidade?.criteriaUsed || previous?.dados_clinicos?.criteria_used || [],
    protocolVersion:
      previous?.elegibilidade?.protocolVersion || previous?.dados_clinicos?.protocol_version || PROTOCOL_VERSION,
    mode: previous?.dados_clinicos?.clinical_audit?.mode || 'panel',
    correlationId,
    decisionRationale: resolveDecisionRationale(rationale, notes),
    observacao_medica: notes || previous?.dados_clinicos?.observacao_medica || null,
    medico_responsavel: doctorId || previous?.dados_clinicos?.clinical_audit?.medico_responsavel || null
  };

  if (decision === 'rejected') {
    const reasonCode =
      (typeof rationale === 'object' && rationale.reasonCode) || base.rejectReasonCode || null;
    const reasonLabel =
      (typeof rationale === 'object' && rationale.reasonLabel) || base.rejectReasonLabel || null;
    return {
      ...base,
      rejectedBy: doctorId,
      rejectedAt: timestamp,
      rejectReasonCode: reasonCode,
      rejectReasonLabel: reasonLabel
    };
  }

  return {
    ...base,
    approvedBy: doctorId,
    approvedAt: timestamp
  };
}

function hasPrescriptionPhoto(clinical = {}) {
  const file = clinical.foto_receita_url || clinical.previous_prescription_file || clinical.prescription_photo_url;
  return Boolean(file && String(file).trim().length > 3);
}

function hasPreviousPrescription(clinical = {}) {
  return Boolean(
    clinical.previous_prescription === true ||
      clinical.has_previous_prescription === true ||
      clinical.receita_anterior === true ||
      hasPrescriptionPhoto(clinical)
  );
}

function assertCanApprove(atendimento) {
  if (!atendimento) {
    return { ok: false, statusCode: 404, error: 'Atendimento não encontrado' };
  }

  const status = String(atendimento.status || '').toLowerCase();
  if (status === 'rejected' || status === 'recusado') {
    return { ok: false, statusCode: 409, error: 'Atendimento reprovado não pode ser aprovado nem enviado à Memed' };
  }

  if (atendimento.dados_clinicos?.memed_bloqueado === true) {
    return { ok: false, statusCode: 409, error: 'Memed bloqueada para este atendimento reprovado' };
  }

  const alreadyApprovedStatuses = new Set([
    STATUS.APPROVED,
    STATUS.RECEITA_EM_EDICAO,
    STATUS.RECEITA_EMITIDA,
    STATUS.MEMED_PROCESSING,
    STATUS.AWAITING_VALIDATION,
    STATUS.READY,
    STATUS.VALIDATED,
    STATUS.APROVADO,
    STATUS.DELIVERED,
    STATUS.FINISHED,
    'approved',
    'receita_em_edicao',
    'receita_emitida',
    'memed_processing'
  ]);
  if (alreadyApprovedStatuses.has(status)) {
    return {
      ok: false,
      statusCode: 409,
      error: 'Atendimento já aprovado ou em processamento de receita. Aprovação duplicada não permitida.',
      code: 'CLINICAL_ALREADY_APPROVED'
    };
  }

  if (atendimento.dados_clinicos?.memed_receita?.receitaId || atendimento.dados_clinicos?.memed_receita?.providerPrescriptionId) {
    return {
      ok: false,
      statusCode: 409,
      error: 'Receita Memed já vinculada a este atendimento.',
      code: 'MEMED_PRESCRIPTION_ALREADY_EXISTS'
    };
  }

  if (!isVisibleInMedicalPanel(atendimento)) {
    return {
      ok: false,
      statusCode: 422,
      error: 'Paciente inelegível, não pago ou fora do protocolo médico. Aprovação não permitida.'
    };
  }

  const clinical = atendimento.dados_clinicos || {};
  if (!hasPreviousPrescription(clinical)) {
    return { ok: false, statusCode: 422, error: 'Aprovação exige comprovação de receita anterior.' };
  }

  if (!hasPrescriptionPhoto(clinical)) {
    return { ok: false, statusCode: 422, error: 'Aprovação exige foto da receita anterior anexada.' };
  }

  return { ok: true };
}

function mergeClinicalPayload(previous, body = {}) {
  const incoming = body.dados_clinicos || {};
  const merged = {
    ...(previous.dados_clinicos || {}),
    ...incoming,
    conduta_medica:
      body.conduta_medica ||
      incoming.conduta_medica ||
      incoming.conduta_sugerida ||
      previous.dados_clinicos?.conduta_medica ||
      previous.dados_clinicos?.conduta_sugerida ||
      null,
    observacao_medica:
      body.observacao_medica || body.notes || incoming.observacao_medica || previous.dados_clinicos?.observacao_medica || null,
    protocol_version: previous?.dados_clinicos?.protocol_version || PROTOCOL_VERSION
  };

  return merged;
}

async function persistClinicalDecision({
  atendimentoId,
  previous,
  status,
  motivo,
  doctorId,
  correlationId,
  dados_clinicos,
  snapshotExtra = {}
}) {
  const atendimento = await updateAtendimentoStatus(atendimentoId, status, {
    motivo,
    medicoId: doctorId,
    dados_clinicos
  });

  const decisao = await createDecisaoLog({
    atendimento_id: atendimentoId,
    status_anterior: previous.status,
    status_novo: status,
    motivo,
    medico_id: doctorId,
    snapshot: {
      paciente_nome: atendimento?.paciente_nome,
      condicao: atendimento?.condicao,
      correlationId,
      protocolVersion: dados_clinicos?.protocol_version || PROTOCOL_VERSION,
      ...snapshotExtra
    }
  });

  return { atendimento, decisao };
}

async function approveAtendimento(atendimentoId, body = {}, meta = {}) {
  const doctorId = meta.doctorId || null;
  const correlationId = meta.correlationId || `approve-${Date.now()}`;
  const previous = await getAtendimento(atendimentoId);
  if (!previous) {
    return { ok: false, statusCode: 404, error: 'Atendimento não encontrado' };
  }

  // Idempotência do botão APROVAR: clique repetido sobre um atendimento já
  // aprovado por esta mesma decisão (ainda não avançou para emissão/Memed)
  // devolve a decisão existente — sem nova decisão, novo status ou nova
  // mensagem — em vez do erro de bloqueio usado para os demais casos já
  // cobertos por assertCanApprove (reprovado, em edição, receita emitida...).
  const previousStatus = String(previous.status || '').toLowerCase();
  const alreadyApprovedByThisDecision =
    previousStatus === String(STATUS.APPROVED).toLowerCase() &&
    Boolean(previous.dados_clinicos?.memed_context?.approved_at);
  if (alreadyApprovedByThisDecision) {
    const notification = await sendApprovalNotificationOnce({ atendimento: previous, doctorId, correlationId });
    await createAuditLog({
      entity_type: 'atendimento',
      entity_id: atendimentoId,
      action: 'clinical_approve_duplicate_ignored',
      actor: doctorId || 'backend',
      payload: { correlationId }
    });
    return {
      ok: true,
      duplicate: true,
      atendimento: previous,
      decisao: null,
      memed: {
        emission: 'manual_sinapse_required',
        nextStep: 'POST /api/memed/iniciar-emissao then widget Sinapse + POST /api/memed/receita'
      },
      notification,
      correlationId
    };
  }

  const guard = assertCanApprove({
    ...previous,
    dados_clinicos: mergeClinicalPayload(previous, body)
  });
  if (!guard.ok) {
    return guard;
  }

  const notes = body.observacao_medica || body.notes || null;
  const conduta =
    body.conduta_medica ||
    body.dados_clinicos?.conduta_medica ||
    body.dados_clinicos?.conduta_sugerida ||
    previous.dados_clinicos?.conduta_medica ||
    previous.dados_clinicos?.conduta_sugerida ||
    null;

  const mergedClinical = mergeClinicalPayload(previous, body);
  const approvedAt = new Date().toISOString();
  const clinicalAudit = buildClinicalAudit(previous, {
    doctorId,
    correlationId,
    decision: 'approved',
    rationale: body.motivo || 'Atendimento aprovado pelo médico',
    notes
  });

  mergedClinical.clinical_audit = clinicalAudit;
  mergedClinical.conduta_medica = conduta;
  mergedClinical.correlation_id = correlationId;
  mergedClinical.memed_context = {
    fluxo: 'sinapse_widget',
    pendente_emissao: true,
    emissao_automatica: false,
    approved_at: approvedAt,
    approved_by: doctorId
  };

  const { atendimento, decisao } = await persistClinicalDecision({
    atendimentoId,
    previous,
    status: STATUS.APPROVED,
    motivo: body.motivo || 'Atendimento aprovado — aguardando emissão explícita via Memed Sinapse',
    doctorId,
    correlationId,
    dados_clinicos: mergedClinical,
    snapshotExtra: {
      decision: 'approved',
      conduta_medica: conduta,
      memedEmission: 'manual_sinapse_required'
    }
  });

  if (!atendimento) {
    return {
      ok: false,
      statusCode: 502,
      error: 'Falha ao persistir status approved do atendimento',
      code: 'CLINICAL_APPROVE_PERSIST_FAILED',
      correlationId,
      decisao
    };
  }

  const notification = await sendApprovalNotificationOnce({ atendimento, doctorId, correlationId });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'clinical_approved',
    actor: doctorId || 'backend',
    payload: {
      correlationId,
      memedEmission: 'manual_sinapse_required',
      whatsappSent: notification.sent || false,
      whatsappQueued: notification.queued || false,
      whatsappQueueId: notification.queueId || null,
      whatsappSkipped: notification.skipped || false,
      whatsappError: notification.error || null,
      protocolVersion: PROTOCOL_VERSION
    }
  });

  return {
    ok: true,
    duplicate: false,
    atendimento,
    decisao,
    memed: {
      emission: 'manual_sinapse_required',
      nextStep: 'POST /api/memed/iniciar-emissao then widget Sinapse + POST /api/memed/receita'
    },
    notification,
    correlationId
  };
}

// Envia pela Meta a mensagem já registrada em whatsapp_messages. A reserva
// (pending/failed -> sending) garante que requisições concorrentes não enviem
// duas vezes; linha 'sent' devolve o resultado anterior sem novo envio.
// Genérico por message_kind (reprovação ou aprovação): claim/finish operam
// só pelo id da linha, sem depender do tipo de decisão.
async function dispatchQueuedClinicalMessage({ queuedMessage, correlationId }) {
  if (!queuedMessage) return { sent: false, status: 'sem_linha', queueId: null, providerMessageId: null };
  if (queuedMessage.status === 'sent') {
    return {
      sent: true,
      status: 'sent',
      queueId: queuedMessage.id,
      providerMessageId: queuedMessage.provider_message_id || null
    };
  }

  const claimed = await claimRejectionMessageForSend(queuedMessage.id);
  if (!claimed) {
    const findCurrent =
      queuedMessage.metadata?.message_kind === 'clinical_approval'
        ? findPendingApprovalMessage
        : findPendingRejectionMessage;
    const current = await findCurrent(queuedMessage.appointment_id);
    return {
      sent: current?.status === 'sent',
      status: current?.status || 'sending',
      queueId: queuedMessage.id,
      providerMessageId: current?.provider_message_id || null
    };
  }

  try {
    // eslint-disable-next-line global-require
    const { sendWhatsAppText } = require('../delivery/delivery.service');
    const result = await sendWhatsAppText({
      to: claimed.phone,
      text: claimed.body,
      correlationId,
      idempotencyKey: claimed.metadata?.idempotency_key || `${claimed.metadata?.message_kind || 'clinical-reject'}:${claimed.appointment_id}`
    });
    await finishRejectionMessage({
      messageId: claimed.id,
      status: 'sent',
      providerMessageId: result?.providerMessageId || null,
      metadata: claimed.metadata
    });
    return { sent: true, status: 'sent', queueId: claimed.id, providerMessageId: result?.providerMessageId || null };
  } catch (error) {
    await finishRejectionMessage({
      messageId: claimed.id,
      status: 'failed',
      errorMessage: error.message,
      metadata: claimed.metadata
    }).catch(() => {});
    return { sent: false, status: 'failed', queueId: claimed.id, providerMessageId: null, error: error.message };
  }
}

// Idempotência do WhatsApp de aprovação: usado tanto no primeiro APROVAR
// quanto no clique repetido (curto-circuito de duplicidade acima), via a
// mesma fila/índice único de whatsapp_outbox.store usados na reprovação.
async function sendApprovalNotificationOnce({ atendimento, doctorId, correlationId }) {
  if (!atendimento?.paciente_telefone) {
    return { sent: false, skipped: true, reason: 'telefone_ausente' };
  }
  const queued = await enqueueClinicalApproval({
    atendimentoId: atendimento.id,
    phone: atendimento.paciente_telefone,
    message: CLINICAL_APPROVE_WHATSAPP_MESSAGE,
    doctorId,
    correlationId
  });
  const dispatch = await dispatchQueuedClinicalMessage({ queuedMessage: queued.message, correlationId });
  return {
    sent: dispatch.sent,
    queued: true,
    status: dispatch.status,
    queueId: dispatch.queueId || queued.message.id,
    providerMessageId: dispatch.providerMessageId || null,
    error: dispatch.error || null,
    duplicate: queued.duplicate
  };
}

async function rejectAtendimento(atendimentoId, body = {}, meta = {}) {
  const doctorId = meta.doctorId || null;
  const correlationId = meta.correlationId || `reject-${Date.now()}`;
  const previous = await getAtendimento(atendimentoId);
  if (!previous) {
    return { ok: false, statusCode: 404, error: 'Atendimento não encontrado' };
  }

  // Idempotência do botão REPROVAR: um atendimento já reprovado pelo médico
  // (status rejected + motivo_rejeicao registrado) devolve o resultado
  // anterior sem nova pendência administrativa, nova mensagem ou nova decisão.
  const previousStatus = String(previous.status || '').toLowerCase();
  const previousRejection = previous.dados_clinicos?.motivo_rejeicao || null;
  if ((previousStatus === 'rejected' || previousStatus === 'recusado') && previousRejection) {
    let notification = previous.dados_clinicos?.notificacao_reprovacao || null;
    if (!notification?.sent && previous.paciente_telefone) {
      let queueRow = await findPendingRejectionMessage(atendimentoId);
      let duplicateRow = true;
      if (!queueRow) {
        const queued = await enqueueClinicalRejection({
          atendimentoId,
          phone: previous.paciente_telefone,
          message: CLINICAL_REJECT_WHATSAPP_MESSAGE,
          doctorId: previousRejection.rejected_by || doctorId,
          correlationId
        });
        queueRow = queued.message;
        duplicateRow = queued.duplicate;
      }
      const dispatch = await dispatchQueuedClinicalMessage({ queuedMessage: queueRow, correlationId });
      notification = {
        sent: dispatch.sent,
        queued: true,
        status: dispatch.status,
        queueId: dispatch.queueId || queueRow.id,
        providerMessageId: dispatch.providerMessageId || null,
        error: dispatch.error || null,
        duplicate: duplicateRow,
        queued_at: queueRow.created_at || new Date().toISOString()
      };
      await updateAtendimentoStatus(atendimentoId, STATUS.REJECTED, {
        motivo: previous.motivo_decisao,
        medicoId: previousRejection.rejected_by || doctorId,
        dados_clinicos: {
          ...(previous.dados_clinicos || {}),
          notificacao_reprovacao: notification
        }
      });
    }
    await createAuditLog({
      entity_type: 'atendimento',
      entity_id: atendimentoId,
      action: 'clinical_reject_duplicate_ignored',
      actor: doctorId || 'backend',
      payload: { correlationId, pendencia_pagamento_status: previous.dados_clinicos?.pendencia_pagamento?.status || null }
    });
    return {
      ok: true,
      duplicate: true,
      atendimento: previous,
      decisao: null,
      pendencia_pagamento: previous.dados_clinicos?.pendencia_pagamento || null,
      notification: notification || { sent: false, skipped: true, reason: 'telefone_ausente' },
      correlationId,
      reason_code: previousRejection.code || null,
      reason_label: previousRejection.label || null
    };
  }

  const validation = validateRejectPayload(body);
  if (!validation.ok) {
    return validation;
  }

  const { reasonCode, detail, meta: reasonMeta } = validation;
  const notes = body.observacao_medica || body.notes || detail || null;
  const motivo = buildRejectMotivoText({ reasonCode, detail: detail || notes });

  const mergedClinical = mergeClinicalPayload(previous, body);
  mergedClinical.memed_bloqueado = true;
  mergedClinical.rejection_sub_status = 'awaiting_response';
  mergedClinical.motivo_rejeicao = {
    code: reasonCode,
    label: reasonMeta.label,
    detail: detail || notes || null,
    rejected_at: new Date().toISOString(),
    rejected_by: doctorId
  };

  const clinicalAudit = buildClinicalAudit(previous, {
    doctorId,
    correlationId,
    decision: 'rejected',
    rationale: {
      reasonCode,
      reasonLabel: reasonMeta.label,
      text: motivo
    },
    notes
  });

  mergedClinical.clinical_audit = clinicalAudit;
  mergedClinical.correlation_id = correlationId;

  const { atendimento, decisao } = await persistClinicalDecision({
    atendimentoId,
    previous,
    status: STATUS.REJECTED,
    motivo,
    doctorId,
    correlationId,
    dados_clinicos: mergedClinical,
    snapshotExtra: {
      decision: 'rejected',
      observacao_medica: notes,
      reason_code: reasonCode,
      reason_label: reasonMeta.label
    }
  });

  // Reprovação médica NÃO estorna automaticamente (Fase 3 Pedido 1): nenhum
  // código de estorno é chamado aqui. Quando há pagamento confirmado, fica
  // apenas registrada a pendência administrativa para tratamento manual
  // futuro; sem pagamento confirmado não há pendência a registrar.
  const paymentConfirmed = String(previous.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
  const pendenciaPagamento = paymentConfirmed
    ? {
        status: 'pendente_analise_administrativa',
        motivo: 'Reprovação médica sem estorno automático — aguardando tratamento administrativo do pagamento',
        registered_at: new Date().toISOString(),
        registered_by: doctorId || null,
        correlation_id: correlationId
      }
    : {
        status: 'sem_pagamento_confirmado',
        motivo: `Pagamento não confirmado (${previous.pagamento_status || 'ausente'}) — nenhuma pendência administrativa a registrar`,
        registered_at: new Date().toISOString()
      };

  // Persiste o estado da pendência antes de enfileirar. Se o banco recusar a
  // mensagem, uma repetição da rota recupera este estado sem duplicar o registro.
  mergedClinical.pendencia_pagamento = pendenciaPagamento;
  await updateAtendimentoStatus(atendimentoId, STATUS.REJECTED, {
    motivo,
    medicoId: doctorId,
    dados_clinicos: mergedClinical
  });

  const message = CLINICAL_REJECT_WHATSAPP_MESSAGE;
  let notification;
  if (previous.paciente_telefone) {
    const queued = await enqueueClinicalRejection({
      atendimentoId,
      phone: previous.paciente_telefone,
      message,
      doctorId,
      correlationId
    });
    const dispatch = await dispatchQueuedClinicalMessage({ queuedMessage: queued.message, correlationId });
    notification = {
      sent: dispatch.sent,
      queued: true,
      status: dispatch.status,
      queueId: dispatch.queueId || queued.message.id,
      providerMessageId: dispatch.providerMessageId || null,
      error: dispatch.error || null,
      duplicate: queued.duplicate
    };
  } else {
    notification = { sent: false, skipped: true, reason: 'telefone_ausente' };
  }

  mergedClinical.notificacao_reprovacao = {
    ...notification,
    queued_at: notification.queued ? new Date().toISOString() : null
  };

  await updateAtendimentoStatus(atendimentoId, STATUS.REJECTED, {
    motivo,
    medicoId: doctorId,
    dados_clinicos: mergedClinical
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'clinical_rejected',
    actor: doctorId || 'backend',
    payload: {
      correlationId,
      reason_code: reasonCode,
      reason_label: reasonMeta.label,
      motivo_resumido: motivo,
      whatsappSent: notification.sent || false,
      whatsappQueued: notification.queued || false,
      whatsappQueueId: notification.queueId || null,
      whatsappSkipped: notification.skipped || false,
      whatsappError: notification.error || null,
      pendencia_pagamento_status: pendenciaPagamento?.status || null,
      protocolVersion: PROTOCOL_VERSION
    }
  });

  const finalAtendimento = (await getAtendimento(atendimentoId)) || atendimento;

  return {
    ok: true,
    duplicate: false,
    atendimento: finalAtendimento,
    decisao,
    notification,
    pendencia_pagamento: pendenciaPagamento,
    correlationId,
    reason_code: reasonCode,
    reason_label: reasonMeta.label
  };
}

module.exports = {
  CLINICAL_REJECT_WHATSAPP_MESSAGE,
  CLINICAL_APPROVE_WHATSAPP_MESSAGE,
  approveAtendimento,
  rejectAtendimento,
  assertCanApprove,
  validateRejectPayload
};
