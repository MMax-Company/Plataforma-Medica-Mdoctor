// Chat Administrativo de Suporte V1 — ETAPA 2 (serviço).
// Isolado do fluxo clínico: só orquestra o store novo
// (support-chat.store.js) e nunca escreve em appointments, support_tickets,
// support_messages ou whatsapp_messages — com duas exceções, ambas restritas
// e nunca bloqueantes:
//   sendHumanMessage: leitura (nunca escrita) de
//     atendimentos.store.getAtendimento, só para resolver o telefone do
//     paciente a partir do appointment_id já gravado na conversation.
//   close: escrita no ticket legado via
//     whatsapp-support.service.closeSupportEntryByAppointmentId, para
//     sincronizar o encerramento feito aqui com findOpenSupportByPhone()/
//     getPatientSupportContext() (ver comentário da própria função) — nunca
//     lança, nunca impede o fechamento da conversation se falhar.
const logger = require('../config/logger');
const store = require('../store/support-chat.store');
const atendimentosStore = require('../store/atendimentos.store');
const metaProvider = require('./providers/meta.provider');
const {
  SUPPORT_CHAT_ROLES,
  DEFAULT_LOCK_LEASE_MS,
  CONVERSATION_STATUS,
  MESSAGE_DIRECTION,
  CONVERSATION_EVENT_TYPES,
  isSupportChatCaptureEnabled,
  isSupportChatAgentSendEnabled,
  isSupportChatUiEnabled
} = require('../constants/support-chat');

// Três flags independentes (pedido explícito do usuário, 10/10/2026), todas
// desligadas por padrão. Nenhuma liga as outras — cada ponto de integração
// consulta só a sua:
//   captureEnabled -> grava mensagem inbound recebida (recordInboundMessage).
//   agentSendEnabled -> reservado para o endpoint de envio humano real, que
//                        não existe ainda nesta etapa.
//   uiEnabled -> expõe as rotas administrativas (listar fila, abrir
//                conversation, claim/release/close) usadas pelo frontend.
function getFeatureState() {
  return {
    captureEnabled: isSupportChatCaptureEnabled(),
    agentSendEnabled: isSupportChatAgentSendEnabled(),
    uiEnabled: isSupportChatUiEnabled()
  };
}

function isUiAvailable() {
  return isSupportChatUiEnabled();
}

function isCaptureAvailable() {
  return isSupportChatCaptureEnabled();
}

function isAgentSendAvailable() {
  return isSupportChatAgentSendEnabled();
}

async function listQueue() {
  return store.listQueue();
}

// Inclui windowStatus e agentSendEnabled junto do detalhe (não só no envio):
// a UI precisa saber ANTES de tentar enviar se a janela de 24h da Meta já
// fechou OU se o envio humano ainda está desligado nesta etapa
// (SUPPORT_CHAT_AGENT_SEND_ENABLED), para desabilitar o composer com uma
// mensagem clara em vez de deixar o atendente digitar e só descobrir o
// bloqueio depois de uma tentativa que a rota rejeitaria com 503.
async function getConversationWithMessages(conversationId) {
  const conversation = await store.getConversationById(conversationId);
  if (!conversation) return null;
  const messages = await store.listMessages(conversationId);
  const windowStatus = store.getMessagingWindowStatus(conversation);
  return { conversation, messages, windowStatus, agentSendEnabled: isAgentSendAvailable() };
}

async function claim({ conversationId, actorId, leaseMs = DEFAULT_LOCK_LEASE_MS }) {
  return store.claimConversation({ conversationId, actorId, leaseMs });
}

// Renovação do lock (heartbeat): o lease padrão é de 2 minutos
// (DEFAULT_LOCK_LEASE_MS) — sem renovação periódica, qualquer atendimento
// mais longo que isso perderia a posse silenciosamente no meio da digitação.
// Chamado pelo frontend em intervalo bem menor que o lease enquanto a
// conversation está com lockOwnership 'owned'.
async function heartbeat({ conversationId, actorId, leaseMs = DEFAULT_LOCK_LEASE_MS }) {
  return store.heartbeatConversation({ conversationId, actorId, leaseMs });
}

async function release({ conversationId, actorId }) {
  return store.releaseConversation({ conversationId, actorId });
}

// Encerra a conversation E sincroniza o ticket legado do WhatsApp
// (appointments/support_tickets) associado ao mesmo appointment_id — sem
// isso, o ticket legado continuava "aberto" para
// findOpenSupportByPhone()/getPatientSupportContext(), e a próxima mensagem
// do paciente era roteada de volta para o atendimento já encerrado em vez de
// cair no menu normal (achado de revisão, 17/10/2026). A sincronização do
// legado é best-effort: se falhar (ou o store estiver indisponível), o
// encerramento da conversation já aconteceu e NUNCA é desfeito por causa
// disso — só fica registrado em log.
async function close({ conversationId, actorId }) {
  const result = await store.closeConversation({ conversationId, actorId });
  if (result.closed && result.conversation?.appointment_id) {
    try {
      // eslint-disable-next-line global-require
      const { closeSupportEntryByAppointmentId } = require('./whatsapp-support.service');
      await closeSupportEntryByAppointmentId({ appointmentId: result.conversation.appointment_id, actorId });
    } catch (error) {
      logger.error('support_chat_legacy_ticket_close_sync_failed', {
        conversationId,
        appointmentId: result.conversation.appointment_id,
        error: error?.message || String(error)
      });
    }
  }
  return result;
}

// Direção OPOSTA de close() acima: o ticket legado já fechou por um caminho
// que não passa pelo botão "Encerrar atendimento" (inatividade via
// closeInactiveSessions, ou o próprio paciente encerrando pelo WhatsApp com
// "0"/"ENCERRAR" — ver whatsapp-support.service.js) e a support_conversation
// correspondente precisa acompanhar, senão fica uma conversa "fantasma"
// mostrando status aberto na fila do painel mesmo com o ticket legado já
// encerrado (achado de auditoria em produção, 24/10/2026 — uma conversation
// real ficou presa em "awaiting_patient" depois do ticket legado fechar por
// inatividade). Nunca lança: best-effort, chamado de dentro de
// whatsapp-support.service.js logo após o próprio fechamento do ticket
// legado, e uma falha aqui não pode desfazer esse fechamento nem impedir o
// restante do fluxo. Idempotente — ver closeConversationByAppointmentId.
async function syncLegacyClosedConversation({ appointmentId, closedBy, reason }) {
  try {
    return await store.closeConversationByAppointmentId({ appointmentId, closedBy, reason });
  } catch (error) {
    logger.warn('support_chat_legacy_inactivity_close_sync_failed', {
      appointmentId,
      closedBy,
      reason,
      error: error?.message || String(error)
    });
    return { closed: false, reason: 'sync_error' };
  }
}

// Estado da janela de mensagem livre da Meta (24h desde a última mensagem
// do PACIENTE) — leitura pura, não envia nada. Usado pela UI para mostrar o
// prazo/bloquear o campo de texto, e reservado para o futuro endpoint de
// envio humano real validar no servidor antes de aceitar qualquer envio de
// texto livre. Não cria nem publica nenhum template Meta.
function getMessagingWindowStatus(conversation) {
  return store.getMessagingWindowStatus(conversation);
}

// Ponto de integração para gravação de inbound — chamado pelo bridge real
// do WhatsApp (whatsapp-support.service.js, dentro do ramo que já trata a
// mensagem como suporte em andamento) a cada mensagem recebida de um
// paciente com ticket de suporte aberto.
//
// Com SUPPORT_CHAT_CAPTURE_ENABLED desligada (padrão de fábrica), retorna
// imediatamente sem nenhuma chamada ao banco — garante que o comportamento
// do caminho que um dia chamar esta função seja idêntico a não tê-la
// chamado. Uma falha de gravação nunca deve propagar para quem chamou (ela
// não pode interromper o fluxo existente de WhatsApp) — é sempre capturada
// aqui e registrada em log estruturado.
async function recordInboundMessage({
  appointmentId,
  patientId = null,
  body = '',
  providerMessageId = null,
  sender = 'patient',
  media = null,
  metadata = {}
}) {
  if (!isCaptureAvailable()) {
    return { recorded: false, reason: 'disabled' };
  }

  if (!appointmentId) {
    logger.error('support_chat_inbound_missing_appointment_id', { providerMessageId: providerMessageId || null });
    return { recorded: false, reason: 'invalid_input' };
  }

  try {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId, patientId });
    const result = await store.recordMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      body,
      sender,
      providerMessageId,
      media,
      metadata
    });
    return { recorded: true, duplicate: result.duplicate, conversationId: conversation.id, message: result.message };
  } catch (error) {
    logger.error('support_chat_inbound_record_failed', {
      appointmentId,
      providerMessageId: providerMessageId || null,
      error: error?.message || String(error)
    });
    return { recorded: false, reason: 'error', error: error?.message || String(error) };
  }
}

// Garante a existência da conversation assim que o ticket de suporte é
// ABERTO (createWhatsAppSupportEntry), não só quando chega uma segunda
// mensagem de texto do paciente. Sem isso, um paciente que acabou de entrar
// na fila (menu "2", opção pós-entrega, conversão de rejeição, endpoint
// direto) ficava invisível para o administrador até enviar uma mensagem
// adicional — a própria abertura do ticket nunca passava por
// recordInboundMessage. Mesma postura defensiva: nunca lança, nunca
// interrompe o fluxo de WhatsApp que chamou, respeita a mesma flag de
// captura.
async function ensureConversation({ appointmentId, patientId = null }) {
  if (!isCaptureAvailable()) {
    return { recorded: false, reason: 'disabled' };
  }
  if (!appointmentId) {
    return { recorded: false, reason: 'invalid_input' };
  }
  try {
    const { conversation, created } = await store.ensureConversationForAppointment({ appointmentId, patientId });
    return { recorded: true, created, conversationId: conversation.id };
  } catch (error) {
    logger.error('support_chat_ensure_conversation_failed', {
      appointmentId,
      error: error?.message || String(error)
    });
    return { recorded: false, reason: 'error', error: error?.message || String(error) };
  }
}

// Espera a reserva CONCORRENTE (perdida por outra chamada com o mesmo
// client_message_id) chegar a um desfecho definitivo antes de responder —
// nunca devolve sent:true otimisticamente enquanto a chamada vencedora
// ainda está em voo com a Meta. Três desfechos possíveis:
//   'sent'    -> a linha ganhou provider_message_id (vencedora confirmou).
//   'failed'  -> a linha sumiu (vencedora apagou a reserva após falha real
//                do provider — ver deleteReservedMessage).
//   'pending' -> esgotou maxWaitMs sem desfecho (vencedora ainda em voo,
//                ex.: Meta lenta); nunca inventa sucesso nem falha aqui.
async function waitForReservationOutcome({
  conversationId,
  clientMessageId,
  initialMessage,
  maxWaitMs = 13000,
  pollIntervalMs = 250
}) {
  const deadline = Date.now() + maxWaitMs;
  let current = initialMessage;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (current?.provider_message_id) {
      return { outcome: 'sent', message: current };
    }
    if (Date.now() >= deadline) {
      return { outcome: 'pending', message: current };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    current = await store.findMessageByClientId({ conversationId, clientMessageId });
    if (!current) {
      return { outcome: 'failed' };
    }
  }
}

async function resolvePatientPhone(conversation) {
  if (!conversation?.appointment_id) return null;
  const atendimento = await atendimentosStore.getAtendimento(conversation.appointment_id);
  return atendimento?.paciente_telefone || null;
}

// Envio humano real (ETAPA 2 — envio): único caminho de outbound deste
// módulo. Reutiliza exclusivamente metaProvider.sendTextMessage — nenhum
// segundo provider/caminho paralelo de WhatsApp é criado aqui. Protegido por
// SUPPORT_CHAT_AGENT_SEND_ENABLED na rota (não aqui, para manter esta função
// testável sem depender de env var). Validações, nesta ordem:
//   1) conversation existe;
//   2) clientMessageId já processado -> devolve o resultado já persistido
//      sem chamar o provider de novo (replay idempotente, nunca duplica
//      envio por retry/duplo clique, mesmo que o lock tenha mudado depois);
//   3) conversation não está closed;
//   4) actorId é o dono atual do lock e o lock não expirou;
//   5) dentro da janela de 24h da Meta (texto livre fora da janela é
//      rejeitado aqui, nunca chega a tentar a chamada ao provider);
//   6) telefone do paciente resolvido a partir do appointment;
//   7) RESERVA o client_message_id (insere a linha antes de chamar o
//      provider) — de duas chamadas concorrentes com o mesmo
//      client_message_id novo, só uma consegue reservar; a outra nunca
//      chega a chamar a Meta (ver reserveOutboundMessage no store).
// Falha do provider some com a reserva (deleteReservedMessage) — nenhuma
// linha fica em support_chat_messages representando uma mensagem que nunca
// chegou ao paciente — e NUNCA toca em last_message_at/status da
// conversation; só registra o evento MESSAGE_FAILED para auditoria.
async function sendHumanMessage({
  conversationId,
  actorId,
  text,
  clientMessageId,
  reservationWaitMs,
  reservationPollMs
}) {
  if (!conversationId || !actorId) {
    const error = new Error('conversationId e actorId são obrigatórios');
    error.statusCode = 400;
    throw error;
  }
  const trimmedText = String(text || '').trim();
  if (!trimmedText) {
    const error = new Error('Texto da mensagem é obrigatório');
    error.statusCode = 400;
    throw error;
  }
  if (!clientMessageId) {
    const error = new Error('clientMessageId é obrigatório para idempotência do envio');
    error.statusCode = 400;
    throw error;
  }

  const conversation = await store.getConversationById(conversationId);
  if (!conversation) {
    return { sent: false, reason: 'not_found' };
  }

  const existing = await store.findMessageByClientId({ conversationId, clientMessageId });
  if (existing) {
    return { sent: true, duplicate: true, message: existing, conversation };
  }

  if (conversation.status === CONVERSATION_STATUS.CLOSED) {
    return { sent: false, reason: 'closed', conversation };
  }

  const lockExpired = Boolean(
    conversation.lock_expires_at && new Date(conversation.lock_expires_at).getTime() < Date.now()
  );
  if (conversation.locked_by !== actorId || lockExpired) {
    return { sent: false, reason: lockExpired ? 'lock_expired' : 'not_locked', conversation };
  }

  const windowStatus = store.getMessagingWindowStatus(conversation);
  if (!windowStatus.withinWindow) {
    return { sent: false, reason: 'window_expired', windowStatus, conversation };
  }

  const phone = await resolvePatientPhone(conversation);
  if (!phone) {
    return { sent: false, reason: 'missing_patient_phone', conversation };
  }

  const reservation = await store.reserveOutboundMessage({
    conversationId,
    body: trimmedText,
    sender: actorId,
    clientMessageId
  });
  if (reservation.duplicate) {
    // Perdeu a corrida de reserva para outra chamada concorrente com o
    // mesmo client_message_id — a vencedora já cuida (ou já cuidou) do
    // envio; esta chamada nunca chama o provider. Mas nunca devolve
    // sent:true otimisticamente: espera o desfecho real da vencedora antes
    // de responder, para não reportar sucesso enquanto a Meta ainda está em
    // voo (ou quando a vencedora acaba de falhar e apagou a reserva).
    const outcome = await waitForReservationOutcome({
      conversationId,
      clientMessageId,
      initialMessage: reservation.message,
      ...(reservationWaitMs !== undefined ? { maxWaitMs: reservationWaitMs } : {}),
      ...(reservationPollMs !== undefined ? { pollIntervalMs: reservationPollMs } : {})
    });
    if (outcome.outcome === 'sent') {
      return { sent: true, duplicate: true, message: outcome.message, conversation };
    }
    if (outcome.outcome === 'failed') {
      const sendError = new Error('Falha ao enviar mensagem via Meta WhatsApp Cloud API (tentativa concorrente)');
      sendError.statusCode = 502;
      sendError.code = 'PROVIDER_ERROR';
      throw sendError;
    }
    // 'pending': a vencedora ainda não terminou — nunca finge sucesso nem
    // falha; o chamador pode tentar de novo com o mesmo client_message_id.
    return { sent: false, reason: 'send_in_progress', conversation };
  }

  let providerResult;
  try {
    providerResult = await metaProvider.sendTextMessage({
      to: phone,
      text: trimmedText,
      correlationId: `support-chat-${conversationId}`,
      idempotencyKey: clientMessageId
    });
  } catch (error) {
    await store.deleteReservedMessage(reservation.message.id);
    await store.recordEventSafe({
      conversationId,
      eventType: CONVERSATION_EVENT_TYPES.MESSAGE_FAILED,
      actor: actorId,
      payload: {
        client_message_id: clientMessageId,
        error: error?.message || String(error),
        code: error?.code || null
      }
    });
    const sendError = new Error(error?.message || 'Falha ao enviar mensagem via Meta WhatsApp Cloud API');
    sendError.statusCode = 502;
    sendError.code = error?.code || 'PROVIDER_ERROR';
    throw sendError;
  }

  const message = await store.finalizeOutboundMessage({
    messageId: reservation.message.id,
    conversationId,
    providerMessageId: providerResult.providerMessageId
  });

  return { sent: true, duplicate: false, message, conversation };
}

module.exports = {
  SUPPORT_CHAT_ROLES,
  getFeatureState,
  isUiAvailable,
  isCaptureAvailable,
  isAgentSendAvailable,
  listQueue,
  getConversationWithMessages,
  claim,
  release,
  close,
  syncLegacyClosedConversation,
  heartbeat,
  getMessagingWindowStatus,
  recordInboundMessage,
  ensureConversation,
  sendHumanMessage
};
