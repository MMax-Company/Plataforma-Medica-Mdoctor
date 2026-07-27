const { randomUUID } = require('crypto');
const eligibilityEngine = require('../eligibility/engine');
const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const { findOrCreatePatient } = require('../store/patients.store');
const {
  STATUS,
  createAtendimento,
  getAtendimento,
  linkPatientToAppointment,
  listAtendimentos
} = require('../store/atendimentos.store');
const { getRememberedWebhookResult, rememberWebhookResult } = require('../store/webhook-idempotency.store');
const { getSessionByPhone } = require('../store/whatsapp-sessions.store');
const {
  buildClinicalNarrative,
  PROTOCOL_VERSION
} = require('./clinical-intelligence.service');
const { mapTypebotPayload } = require('./typebot-payload.mapper');
const { isExternalUploadMode, isVisibleInMedicalPanel } = require('./clinical-payload-normalizer.service');
const {
  ensurePrescriptionUploadSession,
  isExternalUploadEnabled
} = require('./prescription-upload-token.service');
const { buildUploadStatusUrlByAtendimento } = require('./typebot-prescription-upload.service');
const { persistTriagemFlow } = require('./clinical-persistence.service');
const {
  validateNestedTriagemPayload,
  nestedTriagemToTypebotFlatBody
} = require('./triagem-nested.mapper');

const ORIGEM = 'typebot-triagem';

// Sincronização de pagamento: a confirmação real do Stripe já vive em
// whatsapp_sessions.metadata.typebot_payment (Fase 2 pedido 2), mas o
// payload da triagem (n8n) não a repassa — normalizePaymentStatus só lê
// campos do próprio payload. Busca pelo MESMO telefone desta triagem (nunca
// de outro paciente/sessão) e usa como fonte de verdade quando confirmado.
async function resolveConfirmedPaymentFromSession(phone) {
  if (!phone) return null;
  const session = await getSessionByPhone(phone).catch(() => null);
  const payment = session?.metadata?.typebot_payment;
  const confirmed = payment?.status === 'completed' || payment?.payment_status === 'paid';
  if (!confirmed) return null;
  return {
    checkout_session_id: payment.checkout_session_id || null,
    paid_at: payment.paid_at || null,
    stripe_event_id: payment.stripe_event_id || null,
    amount_cents: payment.amount_cents || null,
    amount_label: payment.amount_label || null,
    currency: 'brl'
  };
}

async function findDuplicateAtendimento(idempotencyKey) {
  if (!idempotencyKey) return null;

  const remembered = await getRememberedWebhookResult(idempotencyKey);
  if (remembered?.atendimentoId) {
    const rememberedAtendimento = await getAtendimento(remembered.atendimentoId);
    if (rememberedAtendimento?.origem === ORIGEM) {
      return rememberedAtendimento;
    }
  }

  const history = await listAtendimentos();
  return (
    history.find((item) => {
      if (item?.origem !== ORIGEM) return false;
      const clinical = item?.dados_clinicos || {};
      const storedKey = String(clinical.idempotency_key || '').trim();
      return storedKey && storedKey === idempotencyKey;
    }) || null
  );
}

async function processTriagemWebhook({ body = {}, correlationId, idempotencyKey, requestId }) {
  const validation = validateNestedTriagemPayload(body);
  if (!validation.ok) {
    return { status: validation.status, body: { ...validation.body, correlationId } };
  }

  if (idempotencyKey) {
    const duplicated = await findDuplicateAtendimento(idempotencyKey);
    if (duplicated) {
      await createAuditLog({
        entity_type: 'triagem_webhook',
        entity_id: duplicated.id,
        action: 'webhook_duplicate_ignored',
        actor: 'n8n',
        payload: { requestId, correlationId, idempotencyKey, atendimento_id: duplicated.id }
      });

      return {
        status: 200,
        body: {
          success: true,
          message: 'Triagem recebida com sucesso',
          atendimentoId: duplicated.id,
          duplicate: true,
          correlationId
        }
      };
    }
  }

  const typebotContext =
    body.typebot_context && typeof body.typebot_context === 'object' ? body.typebot_context : {};
  const flatBody = {
    ...nestedTriagemToTypebotFlatBody(validation.paciente, validation.triagem),
    ...typebotContext
  };
  const mapped = mapTypebotPayload({
    ...flatBody,
    correlationId,
    correlation_id: correlationId
  });
  const normalized = mapped.normalized;
  const originalPayload = {
    ...mapped.original,
    paciente: validation.paciente,
    triagem: validation.triagem
  };

  const sessionPayment = await resolveConfirmedPaymentFromSession(
    normalized.whatsapp || validation.paciente.telefone
  );

  const patientData = {
    ...mapped.patientData,
    idempotency_key: idempotencyKey || null,
    protocol_version: PROTOCOL_VERSION,
    pagamento_status: sessionPayment ? 'CONFIRMADO' : normalized.pagamento_status,
    payment_status: sessionPayment ? 'paid' : normalized.payment_status,
    payment_confirmed: sessionPayment ? true : normalized.payment_confirmed,
    queue_type: 'medical',
    validation: normalized.validation,
    prescription_upload_pending: normalized.validation?.awaiting_prescription_upload === true
  };

  const decision = eligibilityEngine.evaluate(patientData);
  const paymentConfirmed = patientData.payment_confirmed === true;
  const externalUpload = isExternalUploadMode() || isExternalUploadEnabled();
  const awaitingExternalUpload = normalized.validation?.awaiting_prescription_upload === true;

  if (!paymentConfirmed && decision.eligible) {
    decision.eligible = false;
    decision.reason = 'Pagamento não confirmado';
    decision.reasonCode = 'pagamento_pendente';
    decision.riskLevel = 'BLOQUEADO';
    decision.renewalStatus = 'insegura';
  }

  if (normalized.eligibility_status === 'ineligible' && decision.eligible) {
    decision.eligible = false;
    decision.reason = normalized.ineligibility_reason || decision.reason;
    decision.reasonCode = decision.reasonCode || 'consulta_presencial';
    decision.riskLevel = 'BLOQUEADO';
  }

  const clinicalNarrative = buildClinicalNarrative({
    patientName: normalized.patient_name || validation.paciente.nome,
    condition: patientData.condition,
    medication: validation.triagem.medicacao_em_uso || 'medicação em uso contínuo',
    decision
  });

  const plannedAtendimentoId = randomUUID();
  let atendimentoStatus = STATUS.WAITING;

  if (!decision.eligible || normalized.eligibility_status === 'ineligible') {
    atendimentoStatus = STATUS.REJECTED;
  } else if (paymentConfirmed && awaitingExternalUpload && externalUpload) {
    // awaitingExternalUpload agora só reflete prontidão clínica/documental
    // (normalizador não decide pagamento); o pagamento confirmado pela
    // sessão do WhatsApp (paymentConfirmed) é quem autoriza aqui.
    atendimentoStatus = STATUS.AWAITING_PRESCRIPTION_UPLOAD;
  } else if (paymentConfirmed && decision.eligible) {
    atendimentoStatus = STATUS.WAITING;
  }

  const enrichedClinicalData = {
    ...patientData,
    original_payload: originalPayload,
    normalized_payload: normalized,
    clean_payload: patientData.typebot_variables,
    typebot_variables: patientData.typebot_variables,
    triagem_nested: {
      paciente: validation.paciente,
      triagem: validation.triagem
    },
    medications: normalized.medications || [],
    queue_type: 'medical',
    protocol_version: PROTOCOL_VERSION,
    clinical_summary: clinicalNarrative.summary,
    queixa_principal: clinicalNarrative.chiefComplaint,
    historico_clinico: clinicalNarrative.clinicalHistory,
    exame_fisico_telemedicina: clinicalNarrative.teleExam,
    conduta_sugerida: clinicalNarrative.conduct,
    orientacoes_clinicas: clinicalNarrative.guidance,
    decision_meta: {
      reasonCode: decision.reasonCode || null,
      criteriaUsed: decision.criteriaUsed || [],
      riskLevel: decision.riskLevel || null,
      renewalStatus: decision.renewalStatus || null,
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION
    },
    idempotency_key: idempotencyKey || null,
    clinical_audit: {
      correlationId,
      idempotencyKey: idempotencyKey || null,
      mode: 'typebot-triagem',
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION,
      source: ORIGEM
    },
    prescription_upload_pending: atendimentoStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD,
    external_upload_mode: externalUpload,
    ...(sessionPayment
      ? {
          payment_sync_source: 'whatsapp_session',
          stripe_checkout_session_id: sessionPayment.checkout_session_id,
          stripe_paid_at: sessionPayment.paid_at,
          stripe_event_id: sessionPayment.stripe_event_id,
          stripe_amount_cents: sessionPayment.amount_cents,
          stripe_amount_label: sessionPayment.amount_label,
          stripe_currency: sessionPayment.currency
        }
      : {})
  };

  const patient = await findOrCreatePatient({
    ...patientData,
    status: atendimentoStatus === STATUS.REJECTED ? 'rejected' : 'pending'
  });

  const atendimento = await createAtendimento({
    id: plannedAtendimentoId,
    patient_id: patient?.id || null,
    ...patientData,
    origem: ORIGEM,
    paciente_nome: normalized.patient_name || validation.paciente.nome,
    paciente_telefone: normalized.whatsapp || validation.paciente.telefone,
    paciente_cpf: normalized.cpf,
    paciente_email: normalized.email,
    condicao: normalized.chronic_condition_label || normalized.chronic_condition || validation.triagem.doencas,
    pagamento_status: patientData.pagamento_status,
    status: atendimentoStatus,
    risco: decision.eligible ? 'BAIXO' : 'BLOQUEADO',
    elegibilidade: decision,
    dados_clinicos: enrichedClinicalData
  });

  if (patient?.id && atendimento?.id) {
    await linkPatientToAppointment(atendimento.id, patient.id);
    atendimento.patient_id = patient.id;
  }

  try {
    await persistTriagemFlow({
      patient,
      atendimento,
      validation,
      decision,
      correlationId,
      idempotencyKey,
      typebotContext
    });
  } catch (error) {
    logger.warn('clinical_persistence_partial', {
      atendimentoId: atendimento.id,
      error: error.message
    });
  }

  let uploadSession = null;
  if (atendimentoStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD) {
    uploadSession = await ensurePrescriptionUploadSession({
      atendimentoId: atendimento.id,
      correlationId
    });
  }

  await createAuditLog({
    entity_type: 'triagem_webhook',
    entity_id: atendimento.id,
    action: 'triagem_received',
    actor: 'n8n',
    payload: {
      requestId,
      correlationId,
      idempotencyKey: idempotencyKey || null,
      eligible: decision.eligible,
      payment_confirmed: paymentConfirmed,
      panel_visible: isVisibleInMedicalPanel(atendimento),
      atendimento_id: atendimento.id,
      reasonCode: decision.reasonCode || null,
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION,
      upload_url: uploadSession?.uploadUrl || null
    }
  });

  if (idempotencyKey) {
    await rememberWebhookResult(
      idempotencyKey,
      {
        atendimentoId: atendimento.id,
        decision
      },
      { source: ORIGEM }
    );
  }

  logger.info('triagem_webhook_processed', {
    requestId,
    correlationId,
    atendimentoId: atendimento.id,
    status: atendimento.status,
    eligible: decision.eligible
  });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Triagem recebida com sucesso',
      atendimentoId: atendimento.id,
      correlationId,
      upload_url: uploadSession?.uploadUrl || null,
      upload_status_url: uploadSession ? buildUploadStatusUrlByAtendimento(atendimento.id) : null,
      upload_status: uploadSession ? 'pending' : null
    }
  };
}

module.exports = {
  processTriagemWebhook,
  ORIGEM
};
