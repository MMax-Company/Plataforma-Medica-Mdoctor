const logger = require('../config/logger');
const { isDryRunMode, resolveWhatsAppProvider, sendWhatsAppText } = require('../delivery/delivery.service');
const {
  SURVEY_VERSION,
  SURVEY_OPT_IN_MESSAGE,
  SURVEY_OPT_IN_DECLINED_MESSAGE,
  Q1_MESSAGE,
  Q2_MESSAGE,
  Q3_MESSAGE,
  THANK_YOU_MESSAGE,
  parseQ1Answer,
  parseYesNoAnswer
} = require('../constants/patient-outcome-survey');
const {
  createPendingOutcome,
  getOutcomeByAttendance,
  getOutcomeById,
  updateOutcomeFields
} = require('../store/patient-outcomes.store');
const {
  clearSurveySession,
  clearTypebotSession,
  getActiveSurveySession,
  getSessionByPhone,
  normalizePhone,
  upsertSessionMetadata
} = require('../store/whatsapp-sessions.store');
const { createAuditLog } = require('../store/audit.store');

const INVALID_ANSWER_MESSAGE = 'Não entendi sua resposta. Responda apenas com o número da opção indicada.';

function isSurveySkipText(raw = '') {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return ['encerrar', 'pular', 'skip', 'sair', 'cancelar'].includes(normalized);
}

// "3" e o atalho de suporte anunciado na mensagem de entrega da receita
// ("digite 3 para falar com o suporte"). Nao intercepta no passo q1: la o "3"
// e uma resposta legitima do questionario ("Consultorio particular").
function isSurveySupportRequestText(raw = '') {
  return String(raw || '').trim() === '3';
}

function isSurveyEnabled() {
  const flag = String(process.env.POST_DELIVERY_SURVEY_ENABLED || '').trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  const envName = String(process.env.ENVIRONMENT_NAME || process.env.NODE_ENV || '').toLowerCase();
  return envName === 'staging';
}

function isSurveyComplete(outcome = {}) {
  return Boolean(
    outcome.final_question_access_alternative &&
      outcome.final_question_avoided_interruption &&
      outcome.final_question_use_again
  );
}

async function sendSurveyWhatsApp({ phone, text, correlationId, idempotencyKey }) {
  const digits = normalizePhone(phone);
  if (!digits || !text) return { skipped: true, reason: 'missing_phone_or_text' };

  if (isDryRunMode()) {
    logger.info('post_delivery_survey_dry_run', {
      phone: digits.replace(/\d(?=\d{4})/g, '*'),
      textPreview: String(text).slice(0, 80),
      correlationId
    });
    return { provider: 'dry-run', providerStatus: 'simulated' };
  }

  if (resolveWhatsAppProvider() === 'mock') {
    logger.warn('post_delivery_survey_provider_not_configured', { correlationId });
    return { skipped: true, reason: 'whatsapp_provider_not_configured' };
  }

  return sendWhatsAppText({
    to: digits,
    text,
    correlationId,
    idempotencyKey
  });
}

async function setSurveySession({ phone, patientId, outcomeId, attendanceId, step }) {
  const digits = normalizePhone(phone);
  await upsertSessionMetadata({
    phone: digits,
    patientId,
    metadataPatch: {
      post_delivery_survey: {
        outcome_id: outcomeId,
        attendance_id: attendanceId,
        step,
        survey_version: SURVEY_VERSION,
        updated_at: new Date().toISOString()
      }
    }
  });

  // Sempre limpa os marcadores de fluxo do Typebot (typebot_session_id e as
  // TYPEBOT_METADATA_KEYS, incluindo typebot_prescription_upload) ao entrar
  // no survey — mesmo quando typebot_session_id já está null, essas outras
  // chaves podem ter sobrado de uma etapa anterior (ex.: link de upload já
  // usado) e ficariam presas na sessão indefinidamente, sem outro ponto do
  // código que as limpe. clearTypebotSession já é seguro/idempotente quando
  // não há nada para limpar.
  const waSession = await getSessionByPhone(digits);
  if (waSession?.id) {
    await clearTypebotSession({ sessionId: waSession.id });
  }
}

async function triggerPostDeliverySurvey({ attendanceId, patientId, phone, correlationId = 'post-delivery-survey' }) {
  if (!isSurveyEnabled()) {
    return { skipped: true, reason: 'survey_disabled' };
  }

  const digits = normalizePhone(phone);
  if (!attendanceId || !digits) {
    return { skipped: true, reason: 'missing_attendance_or_phone' };
  }

  // Fase 3 pedido 3: evento repetido (retry, novo webhook de entrega) nunca
  // reinicia o survey — uma vez que a linha existe (completa ou em
  // andamento), as mensagens de abertura já foram enviadas uma vez.
  const existing = await getOutcomeByAttendance(attendanceId, SURVEY_VERSION);
  if (existing) {
    return {
      skipped: true,
      reason: isSurveyComplete(existing) ? 'already_completed' : 'already_in_progress',
      outcome: existing
    };
  }

  const outcome = await createPendingOutcome({
    attendanceId,
    patientId: patientId || null,
    surveyVersion: SURVEY_VERSION
  });

  await setSurveySession({
    phone: digits,
    patientId: patientId || outcome.patient_id || null,
    outcomeId: outcome.id,
    attendanceId,
    step: 'opt_in'
  });

  const sendResult = await sendSurveyWhatsApp({
    phone: digits,
    text: SURVEY_OPT_IN_MESSAGE,
    correlationId,
    idempotencyKey: `survey-opt-in:${attendanceId}:${outcome.id}`
  });

  await createAuditLog({
    entity_type: 'patient_outcome_survey',
    entity_id: outcome.id,
    action: 'survey_triggered',
    actor: 'backend',
    payload: {
      correlationId,
      attendance_id: attendanceId,
      patient_id: patientId || null,
      phone: digits.replace(/\d(?=\d{4})/g, '*'),
      provider: sendResult?.provider || sendResult?.reason || null
    }
  });

  return { triggered: true, outcome, sendResult };
}

async function handleSurveyInbound({ phone, text, correlationId = 'survey-inbound', sendOutbound = true }) {
  if (!isSurveyEnabled()) {
    return { handled: false, reason: 'survey_disabled' };
  }

  const digits = normalizePhone(phone);
  const rawText = String(text || '').trim();
  if (!digits || !rawText) {
    return { handled: false, reason: 'missing_phone_or_text' };
  }

  const session = await getSessionByPhone(digits);
  const surveySession = getActiveSurveySession(session);
  if (!surveySession?.outcome_id || !surveySession?.step) {
    return { handled: false, reason: 'no_active_survey' };
  }

  const outcome = await getOutcomeById(surveySession.outcome_id);
  if (!outcome) {
    await clearSurveySession(digits);
    return { handled: false, reason: 'outcome_not_found' };
  }

  if (isSurveyComplete(outcome)) {
    await clearSurveySession(digits);
    return { handled: false, reason: 'already_completed' };
  }

  const step = surveySession.step;
  let nextStep = null;
  let reply = null;
  let patch = {};

  if (isSurveySkipText(rawText)) {
    await clearSurveySession(digits);
    if (sendOutbound) {
      await sendSurveyWhatsApp({
        phone: digits,
        text: SURVEY_OPT_IN_DECLINED_MESSAGE,
        correlationId,
        idempotencyKey: `survey-skipped:${outcome.id}:${Date.now()}`
      });
    }
    await createAuditLog({
      entity_type: 'patient_outcome_survey',
      entity_id: outcome.id,
      action: 'survey_skipped',
      actor: 'patient',
      payload: { correlationId, attendance_id: outcome.attendance_id, step }
    });
    return {
      handled: true,
      step: 'skipped',
      completed: false,
      outcome,
      reply: SURVEY_OPT_IN_DECLINED_MESSAGE
    };
  }

  if (step !== 'q1' && isSurveySupportRequestText(rawText)) {
    await clearSurveySession(digits);
    // eslint-disable-next-line global-require
    const { createWhatsAppSupportEntry } = require('./whatsapp-support.service');
    const supportResult = await createWhatsAppSupportEntry({ phone: digits, correlationId });
    if (sendOutbound) {
      await sendSurveyWhatsApp({
        phone: digits,
        text: supportResult.reply,
        correlationId,
        idempotencyKey: `survey-support:${outcome.id}:${Date.now()}`
      });
    }
    await createAuditLog({
      entity_type: 'patient_outcome_survey',
      entity_id: outcome.id,
      action: 'survey_interrupted_support',
      actor: 'patient',
      payload: { correlationId, attendance_id: outcome.attendance_id, step }
    });
    return {
      handled: true,
      step: 'support_requested',
      completed: false,
      outcome,
      reply: supportResult.reply
    };
  }

  if (step === 'opt_in') {
    const answer = parseYesNoAnswer(rawText);
    if (answer === 'nao') {
      await clearSurveySession(digits);
      await sendSurveyWhatsApp({
        phone: digits,
        text: SURVEY_OPT_IN_DECLINED_MESSAGE,
        correlationId,
        idempotencyKey: `survey-declined:${outcome.id}:${Date.now()}`
      });
      await createAuditLog({
        entity_type: 'patient_outcome_survey',
        entity_id: outcome.id,
        action: 'survey_declined',
        actor: 'patient',
        payload: { correlationId, attendance_id: outcome.attendance_id }
      });
      return { handled: true, step: 'declined', completed: false, outcome, reply: SURVEY_OPT_IN_DECLINED_MESSAGE };
    }
    if (answer === 'sim') {
      nextStep = 'q1';
      reply = Q1_MESSAGE;
    } else {
      reply = SURVEY_OPT_IN_MESSAGE;
    }
  } else if (step === 'q1') {
    const answer = parseQ1Answer(rawText);
    if (!answer) {
      reply = `${INVALID_ANSWER_MESSAGE}\n\n${Q1_MESSAGE}`;
    } else {
      patch.final_question_access_alternative = answer;
      nextStep = 'q2';
      reply = Q2_MESSAGE;
    }
  } else if (step === 'q2') {
    const answer = parseYesNoAnswer(rawText);
    if (!answer) {
      reply = `${INVALID_ANSWER_MESSAGE}\n\n${Q2_MESSAGE}`;
    } else {
      patch.final_question_avoided_interruption = answer;
      nextStep = 'q3';
      reply = Q3_MESSAGE;
    }
  } else if (step === 'q3') {
    const answer = parseYesNoAnswer(rawText);
    if (!answer) {
      reply = `${INVALID_ANSWER_MESSAGE}\n\n${Q3_MESSAGE}`;
    } else {
      patch.final_question_use_again = answer;
      nextStep = 'done';
      reply = THANK_YOU_MESSAGE;
    }
  } else {
    await clearSurveySession(digits);
    return { handled: false, reason: 'unknown_step' };
  }

  const updated = Object.keys(patch).length ? await updateOutcomeFields(outcome.id, patch) : outcome;

  if (nextStep === 'done') {
    await clearSurveySession(digits);
    await createAuditLog({
      entity_type: 'patient_outcome_survey',
      entity_id: updated.id,
      action: 'survey_completed',
      actor: 'patient',
      payload: {
        correlationId,
        attendance_id: updated.attendance_id,
        survey_version: updated.survey_version
      }
    });
  } else if (nextStep) {
    await setSurveySession({
      phone: digits,
      patientId: updated.patient_id,
      outcomeId: updated.id,
      attendanceId: updated.attendance_id,
      step: nextStep
    });
  }

  if (reply && sendOutbound) {
    await sendSurveyWhatsApp({
      phone: digits,
      text: reply,
      correlationId,
      idempotencyKey: `survey-${nextStep || step}:${updated.id}:${Date.now()}`
    });
  }

  return {
    handled: true,
    step: nextStep || step,
    completed: nextStep === 'done',
    outcome: updated,
    reply
  };
}

module.exports = {
  handleSurveyInbound,
  isSurveyComplete,
  isSurveyEnabled,
  triggerPostDeliverySurvey
};
