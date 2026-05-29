const memed = require('./memed.service');
const { PROTOCOL_VERSION } = require('./clinical-intelligence.service');
const { isVisibleInMedicalPanel } = require('./clinical-payload-normalizer.service');
const { DEFAULT_REJECT_MESSAGE, notifyClinicalRejection } = require('./n8n-clinical-notify.service');
const { createAuditLog } = require('../store/audit.store');
const { STATUS, getAtendimento, updateAtendimentoStatus, createDecisaoLog } = require('../store/atendimentos.store');
const { savePrescription } = require('../store/prescriptions.store');

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
    decisionRationale: rationale || notes || null,
    observacao_medica: notes || previous?.dados_clinicos?.observacao_medica || null,
    medico_responsavel: doctorId || previous?.dados_clinicos?.clinical_audit?.medico_responsavel || null
  };

  if (decision === 'rejected') {
    return {
      ...base,
      rejectedBy: doctorId,
      rejectedAt: timestamp
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

async function triggerMemedForAtendimento(atendimento, { doctorId, correlationId }) {
  const result = await memed.createPrescription(atendimento);
  const saved = await savePrescription({
    atendimento_id: atendimento.id,
    patient_id: atendimento.patient_id || null,
    status: result.source === 'memed' ? 'processing' : 'mock',
    provider: result.source,
    provider_prescription_id: result.prescriptionId,
    pdf_url: result.pdfUrl,
    medications: [
      atendimento.medicacao_em_uso ||
        atendimento.dados_clinicos?.medicacao_em_uso ||
        atendimento.dados_clinicos?.medicamento ||
        'Medicamento conforme avaliação médica'
    ],
    payload: result.data || result
  });

  return { result, saved };
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

  let memedOutcome = null;
  let memedError = null;

  try {
    memedOutcome = await triggerMemedForAtendimento(previous, { doctorId, correlationId });
    mergedClinical.memed_receita = {
      receitaId: memedOutcome.saved.id,
      providerPrescriptionId: memedOutcome.saved.provider_prescription_id,
      source: memedOutcome.result.source,
      pdfUrl: memedOutcome.saved.pdf_url,
      warning: memedOutcome.result.warning || null,
      memedError: memedOutcome.result.memedError || null,
      gerada_em: new Date().toISOString()
    };
    if (memedOutcome.result.memedError) {
      memedError = memedOutcome.result.memedError;
      mergedClinical.memed_erro = memedOutcome.result.memedError;
    }
  } catch (error) {
    memedError = { code: 'MEMED_TRIGGER_FAILED', message: error.message };
    mergedClinical.memed_erro = memedError;
  }

  const { atendimento, decisao } = await persistClinicalDecision({
    atendimentoId,
    previous,
    status: STATUS.MEMED_PROCESSING,
    motivo: body.motivo || 'Atendimento aprovado — prescrição em processamento na Memed',
    doctorId,
    correlationId,
    dados_clinicos: mergedClinical,
    snapshotExtra: {
      decision: 'approved',
      conduta_medica: conduta,
      memedSource: memedOutcome?.result?.source || null,
      memedError
    }
  });

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'clinical_approved',
    actor: doctorId || 'backend',
    payload: {
      correlationId,
      memedSource: memedOutcome?.result?.source || null,
      memedError,
      protocolVersion: PROTOCOL_VERSION
    }
  });

  return {
    ok: true,
    atendimento,
    decisao,
    memed: memedOutcome
      ? {
          source: memedOutcome.result.source,
          prescription: memedOutcome.saved,
          warning: memedOutcome.result.warning || null,
          error: memedError
        }
      : { error: memedError },
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

  const notes = body.observacao_medica || body.notes || null;
  const mergedClinical = mergeClinicalPayload(previous, body);
  mergedClinical.memed_bloqueado = true;
  const clinicalAudit = buildClinicalAudit(previous, {
    doctorId,
    correlationId,
    decision: 'rejected',
    rationale: body.motivo || notes || 'Atendimento reprovado pelo médico',
    notes
  });

  mergedClinical.clinical_audit = clinicalAudit;
  mergedClinical.correlation_id = correlationId;

  const motivo = body.motivo || notes || 'Atendimento reprovado pelo médico';
  const { atendimento, decisao } = await persistClinicalDecision({
    atendimentoId,
    previous,
    status: STATUS.REJECTED,
    motivo,
    doctorId,
    correlationId,
    dados_clinicos: mergedClinical,
    snapshotExtra: { decision: 'rejected', observacao_medica: notes }
  });

  const message = body.mensagem_whatsapp || DEFAULT_REJECT_MESSAGE;
  const notification = await notifyClinicalRejection({
    atendimentoId,
    phone: previous.paciente_telefone,
    pacienteNome: previous.paciente_nome,
    message,
    correlationId
  });

  mergedClinical.notificacao_reprovacao = {
    ...notification,
    attempted_at: new Date().toISOString()
  };

  if (notification.sent || notification.skipped) {
    await updateAtendimentoStatus(atendimentoId, STATUS.REJECTED, {
      motivo,
      medicoId: doctorId,
      dados_clinicos: {
        ...mergedClinical,
        notificacao_reprovacao: mergedClinical.notificacao_reprovacao
      }
    });
  }

  await createAuditLog({
    entity_type: 'atendimento',
    entity_id: atendimentoId,
    action: 'clinical_rejected',
    actor: doctorId || 'backend',
    payload: {
      correlationId,
      whatsappSent: notification.sent,
      whatsappSkipped: notification.skipped || false,
      whatsappError: notification.error || null,
      protocolVersion: PROTOCOL_VERSION
    }
  });

  return {
    ok: true,
    atendimento,
    decisao,
    notification,
    correlationId
  };
}

module.exports = {
  approveAtendimento,
  rejectAtendimento,
  assertCanApprove
};
