const { STATUS, createAtendimento, listAtendimentos, getAtendimento, updateAtendimentoStatus } = require('../store/atendimentos.store');
const { createAuditLog } = require('../store/audit.store');
const { recordSupportTicket } = require('./clinical-persistence.service');
const { isSupportQueue, QUEUE_TYPE_SUPPORT } = require('../constants/whatsapp-queue');
const logger = require('../config/logger');
const { handleSurveyInbound } = require('./post-delivery-survey.service');
const { getActiveSurveySession, getSessionByPhone } = require('../store/whatsapp-sessions.store');
const { SURVEY_OPT_IN_MESSAGE } = require('../constants/patient-outcome-survey');

const SUPPORT_TIMEOUT_MS = Number(process.env.SUPPORT_INACTIVITY_TIMEOUT_MS || 30 * 60 * 1000);
const TYPEBOT_URL = process.env.TYPEBOT_PUBLIC_URL || 'https://typebot.io/doctor-prescreve-8rmljgu';

const MENU_TEXT =
  'Olá! Sou o assistente virtual do Doctor Prescreve.\n\nDigite:\n*1* - Iniciar atendimento\n*2* - Suporte';

const SUPPORT_WAITING_TEXT =
  'Aguarde, em breve nossa equipe realizará seu atendimento.\n\n*1* - Aguardar atendimento\n*ENCERRAR* - Encerrar atendimento\n*3* - Iniciar chatbot novamente';

const SUPPORT_SUB = {
  WAITING: 'waiting',
  EM_ATENDIMENTO: 'em_atendimento',
  AWAITING_DECISION: 'awaiting_patient_decision',
  CLOSED_PATIENT: 'closed_by_patient',
  CONVERTED: 'converted_to_renewal',
  INACTIVE: 'closed_inactive'
};

function getSupportSubStatus(atendimento = {}) {
  return String(atendimento?.dados_clinicos?.support_sub_status || SUPPORT_SUB.WAITING);
}

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').trim();
}

function supportIsOpen(atendimento) {
  const status = String(atendimento?.status || '').toLowerCase();
  const sub = getSupportSubStatus(atendimento);
  return status === STATUS.WAITING || status === STATUS.EM_ATENDIMENTO || sub === SUPPORT_SUB.AWAITING_DECISION;
}

async function findOpenSupportByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const rows = await listAtendimentos();
  return (
    rows.find((item) => {
      if (!isSupportQueue(item)) return false;
      if (!supportIsOpen(item)) return false;
      return normalizePhone(item.paciente_telefone) === digits;
    }) || null
  );
}

async function createWhatsAppSupportEntry({ phone, correlationId, idempotencyKey, requestId }) {
  const digits = normalizePhone(phone);
  if (!digits) {
    const error = new Error('telefone obrigatório');
    error.statusCode = 400;
    throw error;
  }

  const existing = await findOpenSupportByPhone(digits);
  if (existing) {
    return { duplicate: true, atendimento: existing, reply: 'Você já está na fila de suporte. Aguarde o contato da equipe.' };
  }

  const suffix = digits.slice(-4);
  const atendimento = await createAtendimento({
    paciente_nome: `Suporte WhatsApp ${suffix}`,
    paciente_telefone: digits,
    paciente_cpf: '',
    paciente_email: '',
    condicao: 'suporte_whatsapp',
    medicacao_em_uso: '',
    origem: 'whatsapp',
    status: STATUS.WAITING,
    pagamento_status: 'CONFIRMADO',
    risco: 'BAIXO',
    elegibilidade: {
      eligible: false,
      reason: 'Aguardando atendimento humano via WhatsApp',
      reasonCode: 'human_support',
      riskLevel: 'BAIXO',
      protocolVersion: 'whatsapp-support-v1'
    },
    dados_clinicos: {
      queue_type: QUEUE_TYPE_SUPPORT,
      whatsapp_support: true,
      correlationId: correlationId || null,
      idempotency_key: idempotencyKey || null,
      opened_at: new Date().toISOString()
    }
  });

  await recordSupportTicket({
    appointmentId: atendimento.id,
    phone: digits,
    subject: `Suporte WhatsApp ${suffix}`,
    metadata: {
      correlationId: correlationId || null,
      idempotency_key: idempotencyKey || null
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support',
    entity_id: atendimento.id,
    action: 'support_queue_created',
    actor: 'n8n',
    payload: {
      requestId: requestId || null,
      correlationId: correlationId || null,
      phone: digits.replace(/\d(?=\d{4})/g, '*'),
      atendimento_id: atendimento.id
    }
  });

  return {
    duplicate: false,
    atendimento,
    reply: SUPPORT_WAITING_TEXT
  };
}

async function closeWhatsAppSupportEntry({ phone, correlationId, requestId }) {
  const digits = normalizePhone(phone);
  const existing = await findOpenSupportByPhone(digits);

  if (!existing) {
    return { closed: false, atendimento: null, reply: 'Nenhum atendimento de suporte ativo encontrado.' };
  }

  const updated = await updateAtendimentoStatus(existing.id, STATUS.REJECTED, {
    motivo: 'Encerrado pelo paciente via WhatsApp',
    dados_clinicos: {
      ...(existing.dados_clinicos || {}),
      support_closed_at: new Date().toISOString(),
      support_closed_by: 'patient'
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support',
    entity_id: existing.id,
    action: 'support_queue_closed',
    actor: 'n8n',
    payload: {
      requestId: requestId || null,
      correlationId: correlationId || null,
      phone: digits.replace(/\d(?=\d{4})/g, '*')
    }
  });

  return {
    closed: true,
    atendimento: updated,
    reply: 'Atendimento de suporte encerrado. Obrigado pelo contato.'
  };
}

async function listWhatsAppSupportQueue() {
  const rows = await listAtendimentos();
  return rows
    .filter((item) => isSupportQueue(item) && supportIsOpen(item))
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
}

async function startSupportAttendance(atendimentoId) {
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) { const e = new Error('Atendimento não encontrado'); e.statusCode = 404; throw e; }
  if (!isSupportQueue(atendimento)) { const e = new Error('Atendimento não é de suporte'); e.statusCode = 400; throw e; }

  const updated = await updateAtendimentoStatus(atendimentoId, STATUS.EM_ATENDIMENTO, {
    dados_clinicos: {
      ...(atendimento.dados_clinicos || {}),
      support_sub_status: SUPPORT_SUB.EM_ATENDIMENTO,
      support_started_at: new Date().toISOString()
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: atendimentoId,
    action: 'support_attendance_started', actor: 'panel',
    payload: { atendimento_id: atendimentoId }
  });

  return updated;
}

async function finalizeSupportAttendance(atendimentoId) {
  const atendimento = await getAtendimento(atendimentoId);
  if (!atendimento) { const e = new Error('Atendimento não encontrado'); e.statusCode = 404; throw e; }
  if (!isSupportQueue(atendimento)) { const e = new Error('Atendimento não é de suporte'); e.statusCode = 400; throw e; }

  const deadline = new Date(Date.now() + SUPPORT_TIMEOUT_MS).toISOString();
  const FINALIZATION_TEXT =
    'Seu atendimento de suporte foi finalizado.\n\nDigite:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita';

  await updateAtendimentoStatus(atendimentoId, STATUS.WAITING, {
    dados_clinicos: {
      ...(atendimento.dados_clinicos || {}),
      support_sub_status: SUPPORT_SUB.AWAITING_DECISION,
      support_finalized_at: new Date().toISOString(),
      support_decision_deadline: deadline
    }
  });

  // Best-effort send via provider WhatsApp configurado (meta)
  const phone = atendimento.paciente_telefone;
  if (phone) {
    try {
      const { sendWhatsAppText } = require('../delivery/delivery.service');
      await sendWhatsAppText({ to: phone, text: FINALIZATION_TEXT });
    } catch (e) {
      logger.warn('support_finalization_send_failed', { atendimentoId, error: e.message });
    }
  }

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: atendimentoId,
    action: 'support_attendance_finalized', actor: 'panel',
    payload: { atendimento_id: atendimentoId, decision_deadline: deadline }
  });

  return { messageText: FINALIZATION_TEXT };
}

async function getPatientSupportContext(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const rows = await listAtendimentos();
  const match = rows.find((item) => {
    if (!isSupportQueue(item)) return false;
    if (!supportIsOpen(item)) return false;
    return normalizePhone(item.paciente_telefone) === digits;
  });

  if (!match) return null;

  return {
    atendimento_id: match.id,
    status: match.status,
    support_sub_status: getSupportSubStatus(match),
    opened_at: match.dados_clinicos?.opened_at || match.criado_em
  };
}

async function respondToFinalization(phone, choice) {
  const digits = normalizePhone(phone);
  const rows = await listAtendimentos();
  const match = rows.find((item) => {
    if (!isSupportQueue(item)) return false;
    return getSupportSubStatus(item) === SUPPORT_SUB.AWAITING_DECISION
      && normalizePhone(item.paciente_telefone) === digits;
  });

  if (!match) {
    return { handled: false, reply: 'Nenhum atendimento aguardando decisão. Digite *2* para acessar o suporte.' };
  }

  const choiceStr = String(choice || '').trim();

  if (choiceStr === '1') {
    await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
      dados_clinicos: {
        ...(match.dados_clinicos || {}),
        support_sub_status: SUPPORT_SUB.CLOSED_PATIENT,
        support_closed_at: new Date().toISOString(),
        support_closed_by: 'patient'
      }
    });
    await createAuditLog({
      entity_type: 'whatsapp_support', entity_id: match.id,
      action: 'support_closed_by_patient', actor: 'n8n',
      payload: { phone: digits.replace(/\d(?=\d{4})/g, '*') }
    });
    return { handled: true, sub_status: SUPPORT_SUB.CLOSED_PATIENT, reply: 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.' };
  }

  if (choiceStr === '2') {
    await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
      dados_clinicos: {
        ...(match.dados_clinicos || {}),
        support_sub_status: SUPPORT_SUB.CONVERTED,
        support_converted_at: new Date().toISOString()
      }
    });
    await createAuditLog({
      entity_type: 'whatsapp_support', entity_id: match.id,
      action: 'support_converted_to_renewal', actor: 'n8n',
      payload: { phone: digits.replace(/\d(?=\d{4})/g, '*') }
    });
    return {
      handled: true, sub_status: SUPPORT_SUB.CONVERTED,
      reply: `Ótimo! Para iniciar sua avaliação de renovação de receita, acesse:\n\n${TYPEBOT_URL}\n\nSiga as instruções. Um médico irá analisar e emitir sua receita em breve.`
    };
  }

  return { handled: false, reply: 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita' };
}

async function handleRejectionResponse({ phone, text }) {
  const digits = normalizePhone(phone);
  if (!digits) return { handled: false };

  const rows = await listAtendimentos();
  const match = rows.find((item) => {
    if (String(item.status || '').toLowerCase() !== STATUS.REJECTED) return false;
    if (item.dados_clinicos?.rejection_sub_status !== 'awaiting_response') return false;
    return normalizePhone(item.paciente_telefone) === digits;
  });

  if (!match) return { handled: false };

  const choiceStr = String(text || '').trim();
  const REJECTION_OPTIONS = 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Falar com o suporte';

  if (choiceStr === '1') {
    await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
      dados_clinicos: {
        ...(match.dados_clinicos || {}),
        rejection_sub_status: 'closed_by_patient',
        rejection_closed_at: new Date().toISOString()
      }
    });
    await createAuditLog({
      entity_type: 'atendimento', entity_id: match.id,
      action: 'rejection_closed_by_patient', actor: 'n8n',
      payload: { phone: digits.replace(/\d(?=\d{4})/g, '*') }
    });
    try {
      const { sendWhatsAppText } = require('../delivery/delivery.service');
      await sendWhatsAppText({ to: digits, text: 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.' });
    } catch (e) {
      logger.warn('rejection_close_send_failed', { id: match.id, error: e.message });
    }
    return { handled: true, reply: 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.' };
  }

  if (choiceStr === '2') {
    await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
      dados_clinicos: {
        ...(match.dados_clinicos || {}),
        rejection_sub_status: 'converted_to_support',
        rejection_converted_at: new Date().toISOString()
      }
    });
    await createAuditLog({
      entity_type: 'atendimento', entity_id: match.id,
      action: 'rejection_converted_to_support', actor: 'n8n',
      payload: { phone: digits.replace(/\d(?=\d{4})/g, '*') }
    });
    const supportResult = await createWhatsAppSupportEntry({ phone: digits });
    return { handled: true, reply: supportResult.reply };
  }

  return { handled: true, reply: REJECTION_OPTIONS };
}

function normalizeMenuText(value = '') {
  return String(value || '').trim().toUpperCase();
}

function isActiveTypebotFlow(session = {}) {
  return Boolean(session?.typebot_session_id && session?.metadata?.typebot_expected_input_id);
}

async function handleSupportQueueInput({ phone, textNorm }) {
  if (textNorm === 'ENCERRAR' || textNorm === '2') {
    const result = await closeWhatsAppSupportEntry({ phone });
    return { handled: true, action: 'reply', reply: result.reply };
  }
  if (textNorm === '3' || textNorm === 'CHATBOT' || textNorm === 'INICIAR CHATBOT NOVAMENTE') {
    await closeWhatsAppSupportEntry({ phone });
    return { handled: true, action: 'typebot_clean' };
  }
  if (textNorm === '0') {
    const result = await closeWhatsAppSupportEntry({ phone });
    return { handled: true, action: 'reply', reply: `${result.reply}\n\n${MENU_TEXT}` };
  }
  if (textNorm === '1' || textNorm === 'AGUARDAR' || textNorm === 'AGUARDAR ATENDIMENTO') {
    return { handled: true, action: 'reply', reply: SUPPORT_WAITING_TEXT };
  }
  return { handled: true, action: 'reply', reply: SUPPORT_WAITING_TEXT };
}

async function resolveMetaInboundRouting({ phone, text, session = null }) {
  const digits = normalizePhone(phone);
  let resolvedSession = session;
  if (!resolvedSession && digits) {
    resolvedSession = await getSessionByPhone(digits);
  }

  try {
    const surveyResult = await handleSurveyInbound({ phone, text, sendOutbound: false });
    if (surveyResult.handled) {
      return { handled: true, action: 'reply', reply: surveyResult.reply };
    }
    if (getActiveSurveySession(resolvedSession)?.step) {
      return {
        handled: true,
        action: 'reply',
        reply: surveyResult.reply || SURVEY_OPT_IN_MESSAGE
      };
    }
  } catch (e) {
    logger.warn('meta_inbound_survey_check_failed', { error: e.message });
  }

  try {
    const rejResult = await handleRejectionResponse({ phone, text });
    if (rejResult.handled) {
      return { handled: true, action: 'reply', reply: rejResult.reply };
    }
  } catch (e) {
    logger.warn('meta_inbound_rejection_check_failed', { error: e.message });
  }

  if (isActiveTypebotFlow(resolvedSession || session)) {
    return { handled: false, action: 'typebot' };
  }

  const textNorm = normalizeMenuText(text);
  const ctx = await getPatientSupportContext(phone);
  const sub = ctx?.support_sub_status || null;

  if (sub === SUPPORT_SUB.AWAITING_DECISION) {
    if (textNorm === '1' || textNorm === '2') {
      const result = await respondToFinalization(phone, textNorm);
      return { handled: true, action: 'reply', reply: result.reply };
    }
    return {
      handled: true,
      action: 'reply',
      reply: 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita'
    };
  }

  if (sub === SUPPORT_SUB.WAITING || sub === SUPPORT_SUB.EM_ATENDIMENTO) {
    return handleSupportQueueInput({ phone, textNorm });
  }

  if (textNorm === '1') {
    return { handled: true, action: 'typebot_clean' };
  }
  if (textNorm === '2') {
    const result = await createWhatsAppSupportEntry({ phone });
    return { handled: true, action: 'reply', reply: result.reply };
  }

  return { handled: true, action: 'reply', reply: MENU_TEXT };
}

async function processIncomingMessage({ phone, text }) {
  const digits = normalizePhone(phone);

  // 1. Survey responses take priority — "1"/"2" would otherwise be misrouted to menu logic
  try {
    const surveyResult = await handleSurveyInbound({ phone, text, sendOutbound: false });
    if (surveyResult.handled) {
      return { reply: surveyResult.reply };
    }
    const session = digits ? await getSessionByPhone(digits) : null;
    if (getActiveSurveySession(session)?.step) {
      return { reply: surveyResult.reply || SURVEY_OPT_IN_MESSAGE };
    }
  } catch (e) {
    logger.warn('process_message_survey_check_failed', { error: e.message });
  }

  // 2. Pending rejection response — patient must choose to close or start support
  try {
    const rejResult = await handleRejectionResponse({ phone, text });
    if (rejResult.handled) {
      return { reply: rejResult.reply };
    }
  } catch (e) {
    logger.warn('process_message_rejection_check_failed', { error: e.message });
  }

  const textNorm = normalizeMenuText(text);

  const ctx = await getPatientSupportContext(phone);
  const sub = ctx?.support_sub_status || null;

  if (sub === SUPPORT_SUB.AWAITING_DECISION) {
    if (textNorm === '1' || textNorm === '2') {
      const result = await respondToFinalization(phone, textNorm);
      return { reply: result.reply };
    }
    return { reply: 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita' };
  }

  if (sub === SUPPORT_SUB.WAITING || sub === SUPPORT_SUB.EM_ATENDIMENTO) {
    const queueResult = await handleSupportQueueInput({ phone, textNorm });
    return { reply: queueResult.reply };
  }

  // No active support — main menu (n8n/Evolution path keeps Typebot URL on option 1)
  if (textNorm === '1') {
    return { reply: `✅ Para iniciar sua avaliação de renovação de receita, acesse:\n\n${TYPEBOT_URL}\n\nSiga as instruções e preencha suas informações. Um médico irá analisar e emitir sua receita em breve.` };
  }
  if (textNorm === '2') {
    const result = await createWhatsAppSupportEntry({ phone });
    return { reply: result.reply };
  }
  return { reply: MENU_TEXT };
}

async function closeInactiveSessions() {
  const now = Date.now();
  const rows = await listAtendimentos();
  let closed = 0;

  for (const item of rows) {
    if (!isSupportQueue(item)) continue;
    if (getSupportSubStatus(item) !== SUPPORT_SUB.AWAITING_DECISION) continue;

    const deadline = item.dados_clinicos?.support_decision_deadline;
    const finalizedAt = item.dados_clinicos?.support_finalized_at;
    const isExpired = deadline
      ? now > new Date(deadline).getTime()
      : finalizedAt && (now - new Date(finalizedAt).getTime()) > SUPPORT_TIMEOUT_MS;

    if (!isExpired) continue;

    try {
      await updateAtendimentoStatus(item.id, STATUS.REJECTED, {
        dados_clinicos: {
          ...(item.dados_clinicos || {}),
          support_sub_status: SUPPORT_SUB.INACTIVE,
          support_closed_at: new Date().toISOString(),
          support_closed_by: 'inactivity'
        }
      });
      await createAuditLog({
        entity_type: 'whatsapp_support', entity_id: item.id,
        action: 'support_closed_inactive', actor: 'system',
        payload: { atendimento_id: item.id }
      });
      closed++;
    } catch (e) {
      logger.warn('support_inactivity_close_failed', { id: item.id, error: e.message });
    }
  }

  return closed;
}

module.exports = {
  SUPPORT_SUB,
  MENU_TEXT,
  SUPPORT_WAITING_TEXT,
  normalizePhone,
  normalizeMenuText,
  isActiveTypebotFlow,
  getSupportSubStatus,
  findOpenSupportByPhone,
  createWhatsAppSupportEntry,
  closeWhatsAppSupportEntry,
  listWhatsAppSupportQueue,
  supportIsOpen,
  startSupportAttendance,
  finalizeSupportAttendance,
  getPatientSupportContext,
  respondToFinalization,
  resolveMetaInboundRouting,
  processIncomingMessage,
  closeInactiveSessions
};
