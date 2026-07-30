const {
  createWhatsAppSupportEntry,
  closeWhatsAppSupportEntry,
  getPatientSupportContext,
  respondToFinalization,
  handleRejectionResponse,
  logSupportInboundMessage,
  SUPPORT_IN_QUEUE_REPLY,
  SUPPORT_SUB
} = require('./whatsapp-support.service');
const { handleSurveyInbound } = require('./post-delivery-survey.service');
const logger = require('../config/logger');

// Menu 1/2 é exclusivo do backend (porta de entrada Meta). Não duplicar no Typebot.
const MAIN_MENU_TEXT = '1 - Iniciar atendimento\n2 - Suporte';

function isMainMenuTrigger(text) {
  const normalized = String(text || '').trim().toUpperCase();
  return ['OI', 'OLÁ', 'OLA', 'MENU', '0', 'ENCERRAR'].includes(normalized);
}

/** Sessão clínica Typebot em andamento — menu 1/2 não deve interceptar respostas numéricas. */
function hasActiveTypebotClinicalSession(whatsappSession) {
  const sessionId = String(whatsappSession?.typebot_session_id || '').trim();
  const expectedInputId = String(whatsappSession?.metadata?.typebot_expected_input_id || '').trim();
  return Boolean(sessionId && expectedInputId);
}

function isAwaitingMainMenu(whatsappSession) {
  return whatsappSession?.metadata?.awaiting_main_menu === true;
}

async function routeMetaWhatsAppInbound({ phone, text, whatsappSession, messageId = null }) {
  const idempotencyKey = messageId ? `meta:${String(messageId).trim()}` : null;

  try {
    const surveyResult = await handleSurveyInbound({ phone, text });
    if (surveyResult.handled) {
      return { action: 'reply', reply: surveyResult.reply };
    }
  } catch (error) {
    logger.warn('meta_inbound_survey_check_failed', { error: error.message });
  }

  try {
    const rejectionResult = await handleRejectionResponse({ phone, text });
    if (rejectionResult.handled) {
      return {
        action: 'reply',
        reply: rejectionResult.reply,
        clearClinicalMetadata: Boolean(rejectionResult.enteredSupport)
      };
    }
  } catch (error) {
    logger.warn('meta_inbound_rejection_check_failed', { error: error.message });
  }

  const textNorm = String(text || '').trim().toUpperCase();
  const ctx = await getPatientSupportContext(phone);
  const sub = ctx?.support_sub_status || null;

  if (sub === SUPPORT_SUB.AWAITING_DECISION) {
    if (textNorm === '1' || textNorm === '2') {
      const result = await respondToFinalization(phone, textNorm, { inlineTypebot: true });
      if (result.startTypebot) return { action: 'typebot_bootstrap' };
      return { action: 'reply', reply: result.reply };
    }
    return {
      action: 'reply',
      reply: 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita'
    };
  }

  if (sub === SUPPORT_SUB.WAITING || sub === SUPPORT_SUB.EM_ATENDIMENTO) {
    if (textNorm === 'ENCERRAR' || textNorm === '0') {
      const result = await closeWhatsAppSupportEntry({ phone });
      return { action: 'reply', reply: result.reply };
    }
    await logSupportInboundMessage({
      phone,
      text,
      ticketId: ctx?.ticket_id || null,
      atendimentoId: ctx?.atendimento_id || null
    });
    return {
      action: 'reply',
      reply: SUPPORT_IN_QUEUE_REPLY
    };
  }

  const activeClinicalSession = hasActiveTypebotClinicalSession(whatsappSession);

  if (isMainMenuTrigger(text)) {
    return {
      action: 'reply',
      reply: MAIN_MENU_TEXT,
      clearTypebotSession: Boolean(whatsappSession?.typebot_session_id),
      clearClinicalMetadata: Boolean(activeClinicalSession)
    };
  }

  if (activeClinicalSession) {
    return { action: 'typebot', text };
  }

  if (isAwaitingMainMenu(whatsappSession)) {
    if (textNorm === '1') {
      return { action: 'typebot_bootstrap', clearTypebotSession: true, clearClinicalMetadata: true };
    }
    if (textNorm === '2') {
      const result = await createWhatsAppSupportEntry({
        phone,
        idempotencyKey
      });
      return {
        action: 'reply',
        reply: result.reply,
        clearTypebotSession: true,
        clearClinicalMetadata: true
      };
    }
    return { action: 'reply', reply: MAIN_MENU_TEXT };
  }

  if (textNorm === '1') {
    return { action: 'typebot_bootstrap', clearTypebotSession: true, clearClinicalMetadata: true };
  }

  if (textNorm === '2') {
    const result = await createWhatsAppSupportEntry({
      phone,
      idempotencyKey
    });
    return {
      action: 'reply',
      reply: result.reply,
      clearTypebotSession: true,
      clearClinicalMetadata: true
    };
  }

  if (!whatsappSession?.typebot_session_id) {
    return { action: 'reply', reply: MAIN_MENU_TEXT };
  }

  return { action: 'typebot', text };
}

module.exports = {
  MAIN_MENU_TEXT,
  hasActiveTypebotClinicalSession,
  isMainMenuTrigger,
  routeMetaWhatsAppInbound
};
