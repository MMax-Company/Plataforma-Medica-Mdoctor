const {
  createWhatsAppSupportEntry,
  closeWhatsAppSupportEntry,
  getPatientSupportContext,
  respondToFinalization,
  handleRejectionResponse,
  SUPPORT_SUB
} = require('./whatsapp-support.service');
const { handleSurveyInbound } = require('./post-delivery-survey.service');
const logger = require('../config/logger');

const MAIN_MENU_TEXT =
  'Olá, sou o assistente virtual do Doctor Prescreve.\n\nDigite:\n*1* - Iniciar sua avaliação para renovação de receita.\n*2* - Falar com o suporte.';

async function routeMetaWhatsAppInbound({ phone, text, whatsappSession }) {
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
      return { action: 'reply', reply: rejectionResult.reply };
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
    return {
      action: 'reply',
      reply:
        'Você está na fila de suporte. Nossa equipe entrará em contato em breve.\n\n*0* - Cancelar e voltar ao menu inicial\n*ENCERRAR* - Encerrar atendimento'
    };
  }

  if (whatsappSession?.typebot_session_id) {
    return { action: 'typebot', text };
  }

  if (textNorm === '1') {
    return { action: 'typebot_bootstrap' };
  }

  if (textNorm === '2') {
    const result = await createWhatsAppSupportEntry({ phone });
    return { action: 'reply', reply: result.reply };
  }

  return { action: 'reply', reply: MAIN_MENU_TEXT };
}

module.exports = {
  MAIN_MENU_TEXT,
  routeMetaWhatsAppInbound
};
