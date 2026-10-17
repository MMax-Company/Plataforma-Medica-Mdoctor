// Chat Administrativo de Suporte V1 — ETAPA 2 (serviço).
// Isolado do fluxo clínico: só orquestra o store novo
// (support-chat.store.js) e nunca escreve em appointments, support_tickets,
// support_messages ou whatsapp_messages. Única exceção, restrita a
// sendHumanMessage: leitura (nunca escrita) de atendimentos.store.getAtendimento
// só para resolver o telefone do paciente a partir do appointment_id já
// gravado na conversation — necessário para endereçar o envio real via Meta.
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

// Inclui windowStatus junto do detalhe (não só no envio): a UI precisa saber
// ANTES de tentar enviar se a janela de 24h da Meta já fechou, para
// desabilitar o composer com uma mensagem clara em vez de deixar o
// atendente digitar e só descobrir o bloqueio depois de uma tentativa falha.
async function getConversationWithMessages(conversationId) {
  const conversation = await store.getConversationById(conversationId);
  if (!conversation) return null;
  const messages = await store.listMessages(conversationId);
  const windowStatus = store.getMessagingWindowStatus(conversation);
  return { conversation, messages, windowStatus };
}

async function claim({ conversationId, actorId, leaseMs = DEFAULT_LOCK_LEASE_MS }) {
  return store.claimConversation({ conversationId, actorId, leaseMs });
}

async function release({ conversationId, actorId }) {
  return store.releaseConversation({ conversationId, actorId });
}

async function close({ conversationId, actorId }) {
  return store.closeConversation({ conversationId, actorId });
}

// Estado da janela de mensagem livre da Meta (24h desde a última mensagem
// do PACIENTE) — leitura pura, não envia nada. Usado pela UI para mostrar o
// prazo/bloquear o campo de texto, e reservado para o futuro endpoint de
// envio humano real validar no servidor antes de aceitar qualquer envio de
// texto livre. Não cria nem publica nenhum template Meta.
function getMessagingWindowStatus(conversation) {
  return store.getMessagingWindowStatus(conversation);
}

// Ponto de integração para gravação de inbound (chamado hoje só pelos
// testes desta etapa — a ligação com o webhook real do WhatsApp/Meta está
// fora do escopo da ETAPA 2 por instrução explícita do usuário: nenhum
// arquivo de webhook, provider Meta, bridge do Typebot ou fluxo clínico foi
// alterado nesta etapa).
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
//   6) telefone do paciente resolvido a partir do appointment.
// Falha do provider NUNCA cria linha em support_chat_messages (não existe
// mensagem para persistir) e NUNCA toca em last_message_at/status da
// conversation — só registra o evento MESSAGE_FAILED para auditoria,
// preservando o histórico e o estado exatamente como estavam antes da
// tentativa.
async function sendHumanMessage({ conversationId, actorId, text, clientMessageId }) {
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

  let providerResult;
  try {
    providerResult = await metaProvider.sendTextMessage({
      to: phone,
      text: trimmedText,
      correlationId: `support-chat-${conversationId}`,
      idempotencyKey: clientMessageId
    });
  } catch (error) {
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

  const { duplicate, message } = await store.recordMessage({
    conversationId,
    direction: MESSAGE_DIRECTION.OUTBOUND,
    body: trimmedText,
    sender: actorId,
    providerMessageId: providerResult.providerMessageId,
    clientMessageId
  });

  return { sent: true, duplicate, message, conversation };
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
  getMessagingWindowStatus,
  recordInboundMessage,
  sendHumanMessage
};
