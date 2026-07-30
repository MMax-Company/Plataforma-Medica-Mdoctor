const {
  STATUS,
  listAtendimentos,
  getAtendimento,
  updateAtendimentoStatus
} = require('../store/atendimentos.store');
const { createAuditLog } = require('../store/audit.store');
const { recordWhatsappMessage } = require('./clinical-persistence.service');
const { isSupportQueue } = require('../constants/whatsapp-queue');
const logger = require('../config/logger');
const { handleSurveyInbound } = require('./post-delivery-survey.service');
const { getActiveSurveySession, getSessionByPhone, clearTypebotSession } = require('../store/whatsapp-sessions.store');
const { SURVEY_OPT_IN_MESSAGE } = require('../constants/patient-outcome-survey');
const { findOrCreatePatient } = require('../store/patients.store');
const {
  ticketPhone,
  ticketSubStatus,
  listSupportTickets,
  getSupportTicket,
  findOpenSupportTicketByPhone,
  findSupportTicketByIdempotencyKey,
  createSupportTicket,
  updateSupportTicket,
  recordSupportMessage
} = require('../store/support-tickets.store');

const SUPPORT_TIMEOUT_MS = Number(process.env.SUPPORT_INACTIVITY_TIMEOUT_MS || 30 * 60 * 1000);

const SUPPORT_WAITING_REPLY =
  'Aguarde, em breve nossa equipe realizará seu atendimento.\n\n*0* - Voltar ao menu inicial\n*ENCERRAR* - Encerrar atendimento';

const SUPPORT_ALREADY_OPEN_REPLY =
  'Você já está na fila de suporte. Aguarde o contato da equipe.';

const SUPPORT_IN_QUEUE_REPLY =
  'Você está na fila de suporte. Nossa equipe entrará em contato em breve.\n\n*0* - Cancelar e voltar ao menu inicial\n*ENCERRAR* - Encerrar atendimento';

const MENU_TEXT =
  'Olá! Sou o assistente virtual do Doctor Prescreve.\n\nDigite uma opção:\n\n1 - Iniciar atendimento\n2 - Suporte';

const SUPPORT_WAITING_TEXT =
  'Seu atendimento foi encaminhado para o suporte.\n\nAguarde. Nossa equipe responderá assim que possível.\n\nPara encerrar o suporte, envie 0 ou ENCERRAR.';

const SUPPORT_CLOSED_TEXT =
  'Atendimento de suporte encerrado.\n\nQuando precisar, envie uma nova mensagem para acessar o menu do Doctor Prescreve.';

const SUPPORT_SUB = {
  WAITING: 'waiting',
  EM_ATENDIMENTO: 'em_atendimento',
  AWAITING_DECISION: 'awaiting_patient_decision',
  CLOSED_PATIENT: 'closed_by_patient',
  CONVERTED: 'converted_to_renewal',
  INACTIVE: 'closed_inactive',
  // Ciclo administrativo → médico → administrativo do próprio ticket de
  // Suporte Geral (nunca cria/usa atendimento clínico — ver
  // forwardSupportTicketToDoctor/answerSupportTicketAsDoctor abaixo).
  FORWARDED_TO_DOCTOR: 'forwarded_to_doctor',
  ANSWERED_BY_DOCTOR: 'answered_by_doctor',
  CLOSED_BY_ADMIN: 'closed_by_admin'
};

function getSupportSubStatus(ticket = {}) {
  return ticketSubStatus(ticket);
}

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').trim();
}

function supportIsOpen(ticket) {
  return String(ticket?.status || '').toLowerCase() === 'open';
}

async function findOpenSupportByPhone(phone) {
  return findOpenSupportTicketByPhone(phone);
}

async function findSupportByCreationIdempotencyKey(idempotencyKey) {
  return findSupportTicketByIdempotencyKey(idempotencyKey);
}

function ticketToQueueItem(ticket = {}) {
  const metadata = ticket.metadata || {};
  return {
    id: ticket.id,
    ticket_id: ticket.id,
    atendimento_id: ticket.appointment_id || null,
    patient_id: ticket.patient_id || null,
    paciente_nome: metadata.patient_name || ticket.subject || 'Paciente',
    paciente_telefone: ticketPhone(ticket),
    criado_em: ticket.created_at,
    atualizado_em: ticket.updated_at,
    status: ticket.status,
    support_sub_status: getSupportSubStatus(ticket),
    medical_forward_reason: metadata.medical_forward_reason || null,
    medical_response: metadata.medical_response || null
  };
}

async function logSupportInboundMessage({ phone, text, ticketId = null, atendimentoId = null }) {
  const digits = normalizePhone(phone);
  if (!digits || !String(text || '').trim()) return;
  logger.info('whatsapp_support_inbound_message', {
    ticket_id: ticketId || null,
    atendimento_id: atendimentoId || null,
    phone: digits.replace(/\d(?=\d{4})/g, '*'),
    body_length: String(text).length
  });
  await recordWhatsappMessage({
    appointmentId: atendimentoId,
    phone: digits,
    body: String(text),
    direction: 'inbound',
    status: 'received',
    metadata: { channel: 'whatsapp_support', support_ticket_id: ticketId || null }
  }).catch(() => {});
  await recordSupportMessage({
    ticketId,
    direction: 'inbound',
    body: String(text),
    metadata: { appointment_id: atendimentoId || null }
  }).catch(() => {});
}

async function createWhatsAppSupportEntry({ phone, appointmentId = null, correlationId, idempotencyKey, requestId }) {
  const digits = normalizePhone(phone);
  if (!digits) {
    const error = new Error('telefone obrigatório');
    error.statusCode = 400;
    throw error;
  }

  const idempotency = String(idempotencyKey || '').trim();
  if (idempotency) {
    const byKey = await findSupportByCreationIdempotencyKey(idempotency);
    if (byKey) {
      return {
        duplicate: true,
        idempotentReplay: true,
        ticket: byKey,
        atendimento: ticketToQueueItem(byKey),
        reply: supportIsOpen(byKey) ? SUPPORT_ALREADY_OPEN_REPLY : 'Solicitação de suporte já registrada.'
      };
    }
  }

  const existing = await findOpenSupportByPhone(digits);
  if (existing) {
    return {
      duplicate: true,
      ticket: existing,
      atendimento: ticketToQueueItem(existing),
      reply: SUPPORT_ALREADY_OPEN_REPLY
    };
  }

  const suffix = digits.slice(-4);
  const requestedAtendimento = appointmentId ? await getAtendimento(appointmentId) : null;
  const relatedAtendimento =
    requestedAtendimento &&
    !isSupportQueue(requestedAtendimento) &&
    normalizePhone(requestedAtendimento.paciente_telefone) === digits
      ? requestedAtendimento
      : null;
  const patient = await findOrCreatePatient({
    phone: digits,
    name: relatedAtendimento?.paciente_nome || `Paciente ${suffix}`,
    source: 'whatsapp_support'
  });
  const openedAt = new Date().toISOString();
  const ticket = await createSupportTicket({
    patientId: patient.id,
    appointmentId: relatedAtendimento?.id || null,
    phone: digits,
    subject: `Suporte via WhatsApp — ${patient.nome || suffix}`,
    metadata: {
      patient_name: patient.nome || relatedAtendimento?.paciente_nome || `Paciente ${suffix}`,
      support_sub_status: SUPPORT_SUB.WAITING,
      correlationId: correlationId || null,
      idempotency_key: idempotencyKey || null,
      opened_at: openedAt
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support',
    entity_id: ticket.id,
    action: 'support_queue_created',
    actor: 'n8n',
    payload: {
      requestId: requestId || null,
      correlationId: correlationId || null,
      phone: digits.replace(/\d(?=\d{4})/g, '*'),
      support_ticket_id: ticket.id,
      patient_id: patient.id,
      atendimento_id: relatedAtendimento?.id || null
    }
  });

  return {
    duplicate: false,
    ticket,
    atendimento: ticketToQueueItem(ticket),
    reply: SUPPORT_WAITING_TEXT
  };
}

async function closeWhatsAppSupportEntry({ phone, correlationId, requestId }) {
  const digits = normalizePhone(phone);
  const existing = await findOpenSupportByPhone(digits);

  if (!existing) {
    return { closed: false, atendimento: null, reply: 'Nenhum atendimento de suporte ativo encontrado.' };
  }

  const updated = await updateSupportTicket(existing.id, {
    status: 'closed',
    metadata: {
      support_sub_status: SUPPORT_SUB.CLOSED_PATIENT,
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
      phone: digits.replace(/\d(?=\d{4})/g, '*'),
      support_ticket_id: existing.id,
      atendimento_id: existing.appointment_id || null
    }
  });

  return {
    closed: true,
    ticket: updated,
    atendimento: ticketToQueueItem(updated),
    reply: SUPPORT_CLOSED_TEXT
  };
}

async function listWhatsAppSupportQueue() {
  const rows = await listSupportTickets({ status: 'open' });
  return (rows || [])
    .map(ticketToQueueItem)
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
}

async function startSupportAttendance(ticketId) {
  const ticket = await getSupportTicket(ticketId);
  if (!ticket) { const e = new Error('Ticket de suporte não encontrado'); e.statusCode = 404; throw e; }
  if (!supportIsOpen(ticket)) { const e = new Error('Ticket de suporte encerrado'); e.statusCode = 409; throw e; }

  const updated = await updateSupportTicket(ticketId, {
    metadata: {
      support_sub_status: SUPPORT_SUB.EM_ATENDIMENTO,
      support_started_at: new Date().toISOString()
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: ticketId,
    action: 'support_attendance_started', actor: 'panel',
    payload: { support_ticket_id: ticketId, atendimento_id: ticket.appointment_id || null }
  });

  return ticketToQueueItem(updated);
}

async function finalizeSupportAttendance(ticketId) {
  const ticket = await getSupportTicket(ticketId);
  if (!ticket) { const e = new Error('Ticket de suporte não encontrado'); e.statusCode = 404; throw e; }
  if (!supportIsOpen(ticket)) { const e = new Error('Ticket de suporte encerrado'); e.statusCode = 409; throw e; }

  const deadline = new Date(Date.now() + SUPPORT_TIMEOUT_MS).toISOString();
  const FINALIZATION_TEXT =
    'Seu atendimento de suporte foi finalizado.\n\nDigite:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita';

  await updateSupportTicket(ticketId, {
    metadata: {
      support_sub_status: SUPPORT_SUB.AWAITING_DECISION,
      support_finalized_at: new Date().toISOString(),
      support_decision_deadline: deadline
    }
  });

  const phone = ticketPhone(ticket);
  if (phone) {
    // Causa raiz do bug de roteamento pós-finalização (2026-07-28): uma
    // sessão presa num choice input antigo do Typebot (ex.: WELCOME_CHOICE_
    // INPUT_ID, de uma tentativa abandonada de "1 - Iniciar atendimento")
    // sequestrava permanentemente o roteamento das respostas 1/2 a esta
    // pergunta — "2" reabria o suporte e "1" reiniciava o Typebot do zero,
    // nunca chegando a respondToFinalization. Limpa qualquer marcador de
    // sessão do Typebot AQUI, antes de perguntar 1/2, para que nenhum
    // artefato de fluxo antigo possa interferir na decisão do paciente.
    try {
      const waSession = await getSessionByPhone(phone);
      if (waSession?.id) {
        await clearTypebotSession({ sessionId: waSession.id });
      }
    } catch (e) {
      logger.warn('support_finalization_session_clear_failed', { ticketId, error: e.message });
    }

    // Best-effort send via provider WhatsApp configurado (meta)
    try {
      const { sendWhatsAppText } = require('../delivery/delivery.service');
      const sent = await sendWhatsAppText({ to: phone, text: FINALIZATION_TEXT });
      await recordSupportMessage({
        ticketId,
        direction: 'outbound',
        body: FINALIZATION_TEXT,
        providerMessageId: sent?.providerMessageId || sent?.messageId || null,
        metadata: { appointment_id: ticket.appointment_id || null }
      }).catch(() => {});
    } catch (e) {
      logger.warn('support_finalization_send_failed', { ticketId, error: e.message });
    }
  }

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: ticketId,
    action: 'support_attendance_finalized', actor: 'panel',
    payload: {
      support_ticket_id: ticketId,
      atendimento_id: ticket.appointment_id || null,
      decision_deadline: deadline
    }
  });

  return { messageText: FINALIZATION_TEXT };
}

// ─── Ciclo administrativo → médico → administrativo (Suporte Geral) ────────
// Opera exclusivamente sobre o próprio support_ticket — nunca cria, usa ou
// substitui atendimento clínico. Distinto e independente do fluxo de
// "Suporte Médico" (medical-support-queue), que escala atendimentos reais.

async function forwardSupportTicketToDoctor(ticketId, { motivo, actor } = {}) {
  const reason = String(motivo || '').trim();
  if (!reason) {
    const e = new Error('Motivo do encaminhamento é obrigatório');
    e.statusCode = 400;
    throw e;
  }

  const ticket = await getSupportTicket(ticketId);
  if (!ticket) { const e = new Error('Ticket de suporte não encontrado'); e.statusCode = 404; throw e; }
  if (!supportIsOpen(ticket)) { const e = new Error('Ticket de suporte encerrado'); e.statusCode = 409; throw e; }

  const updated = await updateSupportTicket(ticketId, {
    metadata: {
      support_sub_status: SUPPORT_SUB.FORWARDED_TO_DOCTOR,
      medical_forward_reason: reason,
      medical_forwarded_at: new Date().toISOString(),
      medical_forwarded_by: actor || null
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: ticketId,
    action: 'support_forwarded_to_doctor', actor: actor || 'admin',
    payload: { support_ticket_id: ticketId, atendimento_id: ticket.appointment_id || null, motivo: reason }
  });

  return ticketToQueueItem(updated);
}

async function answerSupportTicketAsDoctor(ticketId, { resposta, actor } = {}) {
  const answer = String(resposta || '').trim();
  if (!answer) {
    const e = new Error('Resposta médica é obrigatória');
    e.statusCode = 400;
    throw e;
  }

  const ticket = await getSupportTicket(ticketId);
  if (!ticket) { const e = new Error('Ticket de suporte não encontrado'); e.statusCode = 404; throw e; }
  if (!supportIsOpen(ticket)) { const e = new Error('Ticket de suporte encerrado'); e.statusCode = 409; throw e; }
  if (getSupportSubStatus(ticket) !== SUPPORT_SUB.FORWARDED_TO_DOCTOR) {
    const e = new Error('Ticket não está aguardando resposta médica');
    e.statusCode = 409;
    throw e;
  }

  const updated = await updateSupportTicket(ticketId, {
    metadata: {
      support_sub_status: SUPPORT_SUB.ANSWERED_BY_DOCTOR,
      medical_response: answer,
      medical_responded_at: new Date().toISOString(),
      medical_responded_by: actor || null
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: ticketId,
    action: 'support_answered_by_doctor', actor: actor || 'doctor',
    payload: { support_ticket_id: ticketId, atendimento_id: ticket.appointment_id || null }
  });

  return ticketToQueueItem(updated);
}

async function closeSupportTicketByAdmin(ticketId, { actor } = {}) {
  const ticket = await getSupportTicket(ticketId);
  if (!ticket) { const e = new Error('Ticket de suporte não encontrado'); e.statusCode = 404; throw e; }
  if (!supportIsOpen(ticket)) { const e = new Error('Ticket de suporte encerrado'); e.statusCode = 409; throw e; }

  const updated = await updateSupportTicket(ticketId, {
    status: 'closed',
    metadata: {
      support_sub_status: SUPPORT_SUB.CLOSED_BY_ADMIN,
      support_closed_at: new Date().toISOString(),
      support_closed_by: actor || 'admin'
    }
  });

  await createAuditLog({
    entity_type: 'whatsapp_support', entity_id: ticketId,
    action: 'support_closed_by_admin', actor: actor || 'admin',
    payload: { support_ticket_id: ticketId, atendimento_id: ticket.appointment_id || null }
  });

  return ticketToQueueItem(updated);
}

async function listMedicalForwardedTickets() {
  const rows = await listSupportTickets({ status: 'open' });
  return (rows || [])
    .filter((ticket) => ticketSubStatus(ticket) === SUPPORT_SUB.FORWARDED_TO_DOCTOR)
    .map(ticketToQueueItem)
    .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
}

async function getPatientSupportContext(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const match = await findOpenSupportByPhone(digits);
  if (!match) return null;

  return {
    ticket_id: match.id,
    atendimento_id: match.appointment_id || null,
    patient_id: match.patient_id || null,
    status: match.status,
    support_sub_status: getSupportSubStatus(match),
    opened_at: match.metadata?.opened_at || match.created_at
  };
}

async function respondToFinalization(phone, choice, { inlineTypebot = false } = {}) {
  const digits = normalizePhone(phone);
  const match = await findOpenSupportByPhone(digits);

  if (!match || getSupportSubStatus(match) !== SUPPORT_SUB.AWAITING_DECISION) {
    return { handled: false, action: 'reply', reply: 'Nenhum atendimento aguardando decisão. Digite *2* para acessar o suporte.' };
  }

  const choiceStr = String(choice || '').trim();

  // Limpa qualquer marcador de sessão do Typebot antes de aplicar a decisão
  // — nem "encerrar" nem "iniciar nova avaliação" podem herdar um choice
  // input travado de uma sessão antiga (ver finalizeSupportAttendance).
  const waSession = await getSessionByPhone(digits);
  if (waSession?.id) {
    await clearTypebotSession({ sessionId: waSession.id });
  }

  if (choiceStr === '1') {
    await updateSupportTicket(match.id, {
      status: 'closed',
      metadata: {
        support_sub_status: SUPPORT_SUB.CLOSED_PATIENT,
        support_closed_at: new Date().toISOString(),
        support_closed_by: 'patient'
      }
    });
    await createAuditLog({
      entity_type: 'whatsapp_support', entity_id: match.id,
      action: 'support_closed_by_patient', actor: 'n8n',
      payload: {
        phone: digits.replace(/\d(?=\d{4})/g, '*'),
        support_ticket_id: match.id,
        atendimento_id: match.appointment_id || null
      }
    });
    return {
      handled: true, action: 'reply', sub_status: SUPPORT_SUB.CLOSED_PATIENT,
      reply: 'Atendimento encerrado. Obrigado pelo contato com o Doctor Prescreve! Até logo.'
    };
  }

  if (choiceStr === '2') {
    await updateSupportTicket(match.id, {
      status: 'closed',
      metadata: {
        support_sub_status: SUPPORT_SUB.CONVERTED,
        support_converted_at: new Date().toISOString()
      }
    });
    await createAuditLog({
      entity_type: 'whatsapp_support', entity_id: match.id,
      action: 'support_converted_to_renewal', actor: 'n8n',
      payload: {
        phone: digits.replace(/\d(?=\d{4})/g, '*'),
        support_ticket_id: match.id,
        atendimento_id: match.appointment_id || null
      }
    });
    if (inlineTypebot) {
      return { handled: true, sub_status: SUPPORT_SUB.CONVERTED, startTypebot: true };
    }
    // Legado sem inline: não envia link público — atendimento só via WhatsApp.
    return {
      handled: true,
      sub_status: SUPPORT_SUB.CONVERTED,
      startTypebot: true,
      reply: 'Digite *1* para iniciar o atendimento médico pelo WhatsApp.'
    };
  }

  return {
    handled: false, action: 'reply',
    reply: 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita'
  };
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
    const supportResult = await createWhatsAppSupportEntry({ phone: digits, appointmentId: match.id });
    return { handled: true, reply: supportResult.reply, enteredSupport: true };
  }

  return { handled: true, reply: REJECTION_OPTIONS };
}

function normalizeMenuText(value = '') {
  return String(value || '').trim().toUpperCase();
}

const DIACRITICS_RANGE = String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f);
const DIACRITICS_REGEX = new RegExp('[' + DIACRITICS_RANGE + ']', 'g');

function isGreetingText(value = '') {
  const norm = String(value || '')
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .trim()
    .toUpperCase();
  return norm === 'OI' || norm === 'OLA';
}

// DIAGNÓSTICO TEMPORÁRIO — mostra o texto só quando curto (comando de menu,
// rótulo de botão, saudação); respostas longas (dados pessoais/clínicos) são
// substituídas por um indicador de tamanho para não vazar PII no log.
function maskDiagnosticText(value = '') {
  const str = String(value || '');
  if (str.length <= 40) return str;
  return `[REDACTED ${str.length} chars]`;
}

function isActiveTypebotFlow(session = {}) {
  const expectedInputId = session?.metadata?.typebot_expected_input_id;
  if (!session?.typebot_session_id || !expectedInputId) return false;
  // Enquanto aguarda a confirmação real de upload (blk_upload_check /
  // blk_upload_pending_choice), a sessão não conta como "fluxo ativo" para
  // roteamento de menu — evita que texto comum (ex.: "1") fique preso
  // encaminhado para esse input em vez de reiniciar a triagem via menu.
  // eslint-disable-next-line global-require
  const { isUploadChoiceInput } = require('./typebot-prescription-upload.service');
  if (isUploadChoiceInput(expectedInputId)) return false;
  return true;
}

// Blocos do Typebot (grupo "42 — Atendimento concluído" e "Suporte (fora do
// fluxo)") que, apesar de já existirem no fluxo do bot, não acionavam nenhuma
// ação real no backend — o paciente escolhia "Falar com o suporte" e ninguém
// via o pedido no painel. Ver docs/typebot backup 20260718-1404.
const POST_ATTENDANCE_CHOICE_INPUT_ID = 'blk_pos_atend_choice';
const SUPPORT_SUBFLOW_CHOICE_INPUT_ID = 'blk_suporte_choice';

// Choice input "Vamos começar" do grupo "Bem-Vindo" (primeiro input de toda
// conversa do Typebot). Uma sessão parada exatamente aqui é, por definição,
// uma sessão obsoleta: o paciente nunca respondeu ao início do fluxo. Ver
// incidente 2026-07-21 ("Invalid message. Please, try again." ao enviar "1"
// com sessão presa neste input) — isActiveTypebotFlow via a sessão como
// "ativa" e encaminhava "1"/"2" via continueChat para este choice input, que
// só aceita "Vamos começar".
const WELCOME_CHOICE_INPUT_ID = 'sbjZWLJGVkHAkDqS4JQeGow';

function matchesTypebotChoice(text, ...labels) {
  const norm = String(text || '').trim().toLowerCase();
  return labels.some((label) => norm === String(label).toLowerCase());
}

async function handleTypebotSupportChoice({ phone, expectedInputId, text, correlationId }) {
  if (expectedInputId === POST_ATTENDANCE_CHOICE_INPUT_ID) {
    if (matchesTypebotChoice(text, 'Falar com o suporte', 'item_pos_suporte')) {
      const result = await createWhatsAppSupportEntry({ phone, correlationId });
      return { action: 'support_created', duplicate: result.duplicate };
    }
    if (matchesTypebotChoice(text, 'Encerrar atendimento', 'item_pos_encerrar')) {
      return { action: 'clear_session' };
    }
    return null;
  }

  if (expectedInputId === SUPPORT_SUBFLOW_CHOICE_INPUT_ID) {
    if (matchesTypebotChoice(text, 'Encerrar', 'item_suporte_encerrar')) {
      const result = await closeWhatsAppSupportEntry({ phone, correlationId });
      return { action: 'clear_session', closed: result.closed };
    }
    return null;
  }

  return null;
}

// Fase 3 pedido 3: só "0" ou "ENCERRAR" encerram o suporte, sempre com a
// mesma mensagem única (SUPPORT_CLOSED_TEXT) e sem anexar o menu na mesma
// resposta — o menu volta a aparecer sozinho na PRÓXIMA mensagem do
// paciente, já que o atendimento deixa de estar "aberto" (supportIsOpen).
async function handleSupportQueueInput({ phone, textNorm }) {
  if (textNorm === 'ENCERRAR' || textNorm === '0') {
    const result = await closeWhatsAppSupportEntry({ phone });
    return { handled: true, action: 'reply', reply: result.reply };
  }
  if (textNorm === '3' || textNorm === 'CHATBOT' || textNorm === 'INICIAR CHATBOT NOVAMENTE') {
    await closeWhatsAppSupportEntry({ phone });
    return { handled: true, action: 'typebot_clean' };
  }
  if (textNorm === '1' || textNorm === 'AGUARDAR' || textNorm === 'AGUARDAR ATENDIMENTO') {
    return { handled: true, action: 'reply', reply: SUPPORT_WAITING_TEXT };
  }
  // Qualquer outra mensagem (incluindo números como "2", "5"...) apenas
  // reapresenta o aviso de espera — nunca inicia triagem/Typebot.
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

  // Estado do ticket de suporte (se houver) tem prioridade ABSOLUTA sobre
  // qualquer atalho/artefato de sessão do Typebot (stuckAtWelcomeChoice e
  // isActiveTypebotFlow, mais abaixo). Causa raiz do bug de roteamento
  // pós-finalização (2026-07-28): uma sessão presa em
  // typebot_expected_input_id = WELCOME_CHOICE_INPUT_ID (de uma tentativa
  // antiga e abandonada de "1 - Iniciar atendimento") sequestrava
  // permanentemente o roteamento de QUALQUER "1"/"2" seguinte — inclusive a
  // pergunta pós-finalização de suporte — porque esse artefato era checado
  // ANTES do estado do ticket. "2" reabria o suporte
  // (createWhatsAppSupportEntry, via o bloco stuckAtWelcomeChoice) e "1"
  // reiniciava o Typebot do zero, nunca chegando a respondToFinalization.
  // Ver finalizeSupportAttendance/respondToFinalization, que agora também
  // limpam esse marcador — esta reordenação é a segunda camada de defesa,
  // cobrindo qualquer ticket que já estivesse aguardando decisão antes
  // desta correção.
  const textNorm = normalizeMenuText(text);
  const ctx = await getPatientSupportContext(phone);
  const sub = ctx?.support_sub_status || null;
  logger.info('typebot_routing_support_context_diagnostic', {
    phone: digits ? digits.replace(/\d(?=\d{4})/g, '*') : null,
    textNorm,
    supportSubStatus: sub
  });

  if (sub === SUPPORT_SUB.AWAITING_DECISION) {
    if (textNorm === '1' || textNorm === '2') {
      const result = await respondToFinalization(phone, textNorm);
      if (result.action === 'typebot_clean') {
        return { handled: true, action: 'typebot_clean' };
      }
      return { handled: true, action: 'reply', reply: result.reply };
    }
    return {
      handled: true,
      action: 'reply',
      reply: 'Por favor, responda:\n*1* - Encerrar atendimento\n*2* - Iniciar avaliação para renovação de receita'
    };
  }

  // FORWARDED_TO_DOCTOR/ANSWERED_BY_DOCTOR também contam como "ticket aberto,
  // equipe trabalhando" — o ciclo médico interno não fecha o ticket, então
  // sem isso uma mensagem do paciente durante esse intervalo cairia (por
  // ausência de outro match) no roteamento de Typebot/menu abaixo, saindo do
  // contexto de suporte no meio do encaminhamento ao médico.
  if (
    sub === SUPPORT_SUB.WAITING ||
    sub === SUPPORT_SUB.EM_ATENDIMENTO ||
    sub === SUPPORT_SUB.FORWARDED_TO_DOCTOR ||
    sub === SUPPORT_SUB.ANSWERED_BY_DOCTOR
  ) {
    return handleSupportQueueInput({ phone, textNorm });
  }

  // DIAGNÓSTICO TEMPORÁRIO (pedido: investigar travamento pós-saudação) —
  // remover após confirmar a causa. Não altera nenhuma decisão de roteamento,
  // só registra os componentes que a alimentam.
  const diagSession = resolvedSession || session;
  const diagActiveFlow = isActiveTypebotFlow(diagSession);
  const diagGreeting = isGreetingText(text);
  logger.info('typebot_routing_diagnostic', {
    phone: digits ? digits.replace(/\d(?=\d{4})/g, '*') : null,
    hasTypebotSessionId: Boolean(diagSession?.typebot_session_id),
    expectedInputId: diagSession?.metadata?.typebot_expected_input_id || null,
    isGreeting: diagGreeting,
    activeFlow: diagActiveFlow,
    textMasked: maskDiagnosticText(text)
  });

  // Sessão obsoleta parada exatamente no início do fluxo ("Vamos começar"):
  // "1"/"2" aqui não podem virar resposta ao choice input via continueChat
  // (isso gera "Invalid message..." do próprio Typebot — ver comentário de
  // WELCOME_CHOICE_INPUT_ID). Restrito a este input específico — não vira
  // comando global em nenhuma outra etapa do fluxo. Só é avaliado quando NÃO
  // há ticket de suporte ativo (checado acima) — do contrário sequestraria o
  // roteamento pós-suporte de novo.
  const stuckAtWelcomeChoice = diagSession?.metadata?.typebot_expected_input_id === WELCOME_CHOICE_INPUT_ID;
  if (stuckAtWelcomeChoice) {
    if (textNorm === '1') {
      return { handled: true, action: 'typebot_clean' };
    }
    if (textNorm === '2') {
      const result = await createWhatsAppSupportEntry({ phone });
      return { handled: true, action: 'reply', reply: result.reply };
    }
  }

  if (diagActiveFlow && !diagGreeting) {
    return { handled: false, action: 'typebot' };
  }

  if (textNorm === '1') {
    return { handled: true, action: 'typebot_clean' };
  }
  if (textNorm === '2') {
    const result = await createWhatsAppSupportEntry({ phone });
    return { handled: true, action: 'reply', reply: result.reply };
  }

  // Sem sessão clínica nem suporte ativo: mostra o menu oficial e NÃO inicia
  // o Typebot sozinho. Só "1" (tratado acima) inicia o Typebot; qualquer
  // outra entrada aqui apenas reapresenta o menu, sem tocar em sessão.
  return { handled: true, action: 'reply', reply: MENU_TEXT };
}

async function processIncomingMessage({ phone, text }) {
  // Rota legada (n8n/Evolution) desativada: a lógica equivalente — prioridade
  // de survey, resposta de rejeição pendente, sub-status de suporte — já foi
  // migrada e está ativa para o canal Meta em
  // whatsapp-meta-inbound.service.js::routeMetaWhatsAppInbound (chamada por
  // whatsapp.routes.js). Nenhuma funcionalidade foi perdida na consolidação.
  const err = new Error(
    'processIncomingMessage desativado: use POST /api/whatsapp/webhook (Meta Cloud API) como entrada oficial.'
  );
  err.code = 'LEGACY_SUPPORT_ROUTE_DISABLED';
  err.statusCode = 410;
  throw err;
}

async function closeInactiveSessions() {
  const now = Date.now();
  const rows = await listSupportTickets({ status: 'open' });
  let closed = 0;

  for (const item of rows) {
    if (getSupportSubStatus(item) !== SUPPORT_SUB.AWAITING_DECISION) continue;

    const deadline = item.metadata?.support_decision_deadline;
    const finalizedAt = item.metadata?.support_finalized_at;
    const isExpired = deadline
      ? now > new Date(deadline).getTime()
      : finalizedAt && (now - new Date(finalizedAt).getTime()) > SUPPORT_TIMEOUT_MS;

    if (!isExpired) continue;

    try {
      await updateSupportTicket(item.id, {
        status: 'closed',
        metadata: {
          support_sub_status: SUPPORT_SUB.INACTIVE,
          support_closed_at: new Date().toISOString(),
          support_closed_by: 'inactivity'
        }
      });
      await createAuditLog({
        entity_type: 'whatsapp_support', entity_id: item.id,
        action: 'support_closed_inactive', actor: 'system',
        payload: {
          support_ticket_id: item.id,
          atendimento_id: item.appointment_id || null
        }
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
  SUPPORT_ALREADY_OPEN_REPLY,
  SUPPORT_IN_QUEUE_REPLY,
  SUPPORT_WAITING_REPLY,
  MENU_TEXT,
  SUPPORT_WAITING_TEXT,
  SUPPORT_CLOSED_TEXT,
  POST_ATTENDANCE_CHOICE_INPUT_ID,
  SUPPORT_SUBFLOW_CHOICE_INPUT_ID,
  WELCOME_CHOICE_INPUT_ID,
  normalizePhone,
  normalizeMenuText,
  isActiveTypebotFlow,
  getSupportSubStatus,
  findOpenSupportByPhone,
  findSupportByCreationIdempotencyKey,
  createWhatsAppSupportEntry,
  closeWhatsAppSupportEntry,
  listWhatsAppSupportQueue,
  supportIsOpen,
  startSupportAttendance,
  finalizeSupportAttendance,
  forwardSupportTicketToDoctor,
  answerSupportTicketAsDoctor,
  closeSupportTicketByAdmin,
  listMedicalForwardedTickets,
  getPatientSupportContext,
  respondToFinalization,
  handleRejectionResponse,
  logSupportInboundMessage,
  resolveMetaInboundRouting,
  handleTypebotSupportChoice,
  processIncomingMessage,
  closeInactiveSessions
};
