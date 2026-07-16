const { PROTOCOL_VERSION } = require('./clinical-intelligence.service');
const { isVisibleInMedicalPanel } = require('./clinical-payload-normalizer.service');
const { DEFAULT_REJECT_MESSAGE } = require('./n8n-clinical-notify.service');
const { refundRejectedAtendimento } = require('./stripe-refund.service');
const { buildRejectMotivoText, validateRejectPayload } = require('../constants/clinical-reject-reasons');
const { createAuditLog } = require('../store/audit.store');
const { STATUS, getAtendimento, updateAtendimentoStatus, createDecisaoLog } = require('../store/atendimentos.store');

// Mensagem enviada ao paciente quando a reprovação médica veio acompanhada de
// estorno iniciado. Sem prazo fixo: o prazo real depende da instituição
// financeira e não há prazo configurável aprovado para operação.
function buildRefundRejectMessage(pacienteNome) {
  const nome = String(pacienteNome || '').trim() || 'paciente';
  return [
    `Olá, ${nome}. Após avaliação médica, sua solicitação não foi aprovada e nenhuma receita será emitida. ` +
      'O estorno do valor pago foi solicitado e será devolvido pela mesma forma de pagamento. ' +
      'O prazo para aparecer na conta ou fatura depende da instituição financeira e será informado conforme o retorno do meio de pagamento.',
    '',
    '*1* - Encerrar atendimento',
    '*2* - Falar com o suporte'
  ].join('\n');
}

// Estados de estorno em que a mensagem ao paciente pode afirmar que o estorno
// foi solicitado. failed/payment_not_found/error usam a mensagem padrão, sem
// prometer devolução que não foi iniciada.
const REFUND_CLAIMED_STATUSES = new Set(['succeeded', 'pending', 'requires_action', 'already_refunded']);

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

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'clinical_approved',
    actor: doctorId || 'backend',
    payload: {
      correlationId,
      memedEmission: 'manual_sinapse_required',
      protocolVersion: PROTOCOL_VERSION
    }
  });

  return {
    ok: true,
    atendimento,
    decisao,
    memed: {
      emission: 'manual_sinapse_required',
      nextStep: 'POST /api/memed/iniciar-emissao then widget Sinapse + POST /api/memed/receita'
    },
    correlationId
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
  // anterior sem novo estorno, nova mensagem ou nova decisão.
  const previousStatus = String(previous.status || '').toLowerCase();
  const previousRejection = previous.dados_clinicos?.motivo_rejeicao || null;
  if ((previousStatus === 'rejected' || previousStatus === 'recusado') && previousRejection) {
    await createAuditLog({
      entity_type: 'atendimento',
      entity_id: atendimentoId,
      action: 'clinical_reject_duplicate_ignored',
      actor: doctorId || 'backend',
      payload: { correlationId, estorno_status: previous.dados_clinicos?.estorno?.status || null }
    });
    return {
      ok: true,
      duplicate: true,
      atendimento: previous,
      decisao: null,
      estorno: previous.dados_clinicos?.estorno || null,
      notification: { sent: false, skipped: true, reason: 'atendimento_ja_reprovado' },
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

  // Estorno somente na reprovação médica (este é o único caminho que chama
  // refundRejectedAtendimento). Sem pagamento confirmado não há o que
  // estornar; sem payment_intent localizável o estado fica registrado como
  // payment_not_found e a reprovação segue valendo.
  const paymentConfirmed = String(previous.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
  const estorno = paymentConfirmed
    ? await refundRejectedAtendimento({
        atendimento: previous,
        requestedPaymentIntent: body.payment_intent || null,
        doctorId,
        correlationId
      })
    : {
        status: 'no_payment_to_refund',
        reason: `Pagamento não confirmado (${previous.pagamento_status || 'ausente'}) — nada a estornar`,
        checked_at: new Date().toISOString()
      };

  // Mensagem ao paciente sai direto pela Meta Cloud API (mesmo canal de todos
  // os envios do backend). Só afirma estorno quando ele foi de fato iniciado.
  const refundClaimed = REFUND_CLAIMED_STATUSES.has(String(estorno?.status || ''));
  const message =
    body.mensagem_whatsapp ||
    (refundClaimed ? buildRefundRejectMessage(previous.paciente_nome) : DEFAULT_REJECT_MESSAGE);

  let notification;
  if (previous.paciente_telefone) {
    try {
      // eslint-disable-next-line global-require
      const { sendWhatsAppText } = require('../delivery/delivery.service');
      const sendResult = await sendWhatsAppText({
        to: previous.paciente_telefone,
        text: message,
        correlationId,
        idempotencyKey: `clinical-reject:${atendimentoId}`
      });
      notification = {
        sent: true,
        provider: sendResult?.provider || null,
        providerMessageId: sendResult?.providerMessageId || null
      };
    } catch (error) {
      notification = { sent: false, error: error.message, code: error.code || null };
    }
  } else {
    notification = { sent: false, skipped: true, reason: 'telefone_ausente' };
  }

  mergedClinical.estorno = estorno;
  mergedClinical.notificacao_reprovacao = {
    ...notification,
    attempted_at: new Date().toISOString()
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
      whatsappSent: notification.sent,
      whatsappSkipped: notification.skipped || false,
      whatsappError: notification.error || null,
      estorno_status: estorno?.status || null,
      estorno_refund_id: estorno?.refund_id || null,
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
    estorno,
    correlationId,
    reason_code: reasonCode,
    reason_label: reasonMeta.label
  };
}

module.exports = {
  approveAtendimento,
  rejectAtendimento,
  assertCanApprove,
  validateRejectPayload
};
