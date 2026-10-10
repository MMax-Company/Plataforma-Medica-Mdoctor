// Chat Administrativo de Suporte V1 — ETAPA 2 (serviço).
// Isolado do fluxo clínico: só orquestra o store novo
// (support-chat.store.js). Nenhuma função aqui lê/escreve em appointments,
// support_tickets, support_messages, whatsapp_messages ou dispara envio real
// de WhatsApp — isso é fora do escopo desta etapa (sem resposta real ao
// paciente pelo painel ainda).
const logger = require('../config/logger');
const store = require('../store/support-chat.store');
const {
  SUPPORT_CHAT_ROLES,
  DEFAULT_LOCK_LEASE_MS,
  isSupportChatEnabled,
  isSupportChatReadEnabled,
  isSupportChatSendEnabled
} = require('../constants/support-chat');

// Mapa explícito do comportamento de cada flag nesta etapa — usado pelas
// rotas para decidir se um pedido deve ou não ser aceito.
function getFeatureState() {
  return {
    enabled: isSupportChatEnabled(),
    readEnabled: isSupportChatReadEnabled(),
    sendEnabled: isSupportChatSendEnabled()
  };
}

// Leitura/gestão do ticket (listar fila, abrir conversation, claim/release/
// close) exige o módulo ligado (master switch) E a etapa de captura/leitura
// ligada — SUPPORT_CHAT_SEND_ENABLED não é consultado aqui porque esta
// etapa não envia nada ao paciente.
function isReadAvailable() {
  const state = getFeatureState();
  return state.enabled && state.readEnabled;
}

async function listQueue() {
  return store.listQueue();
}

async function getConversationWithMessages(conversationId) {
  const conversation = await store.getConversationById(conversationId);
  if (!conversation) return null;
  const messages = await store.listMessages(conversationId);
  return { conversation, messages };
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

// Ponto de integração para gravação de inbound (chamado hoje só pelos
// testes desta etapa — a ligação com o webhook real do WhatsApp/Meta está
// fora do escopo da ETAPA 2 por instrução explícita do usuário: nenhum
// arquivo de webhook, provider Meta, bridge do Typebot ou fluxo clínico foi
// alterado nesta etapa).
//
// Com SUPPORT_CHAT_ENABLED e/ou SUPPORT_CHAT_READ_ENABLED desligados (padrão
// de fábrica), retorna imediatamente sem nenhuma chamada ao banco — garante
// que o comportamento do caminho que um dia chamar esta função seja idêntico
// a não tê-la chamado. Uma falha de gravação nunca deve propagar para quem
// chamou (ela não pode interromper o fluxo existente de WhatsApp) — é
// sempre capturada aqui e registrada em log estruturado.
async function recordInboundMessage({
  appointmentId,
  patientId = null,
  body = '',
  providerMessageId = null,
  sender = 'patient',
  metadata = {}
}) {
  if (!isReadAvailable()) {
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

module.exports = {
  SUPPORT_CHAT_ROLES,
  getFeatureState,
  isReadAvailable,
  listQueue,
  getConversationWithMessages,
  claim,
  release,
  close,
  recordInboundMessage
};
