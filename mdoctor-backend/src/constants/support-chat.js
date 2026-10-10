// Fundação do Chat Administrativo de Suporte V1 (ETAPA 1).
// Módulo isolado: não participa do fluxo clínico, da fila médica, do bridge
// do Typebot nem do suporte via WhatsApp já existente (whatsapp-support.service.js).
// Tabelas próprias: support_conversations, support_chat_messages,
// support_conversation_events — nunca support_tickets/support_messages/whatsapp_messages.

const CONVERSATION_STATUS = {
  OPEN: 'open',
  CLAIMED: 'claimed',
  CLOSED: 'closed'
};

const MESSAGE_DIRECTION = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound'
};

// Eventos de auditoria exigidos desde a V1 (support_conversation_events).
const CONVERSATION_EVENT_TYPES = {
  CONVERSATION_CREATED: 'conversation_created',
  CLAIMED: 'claimed',
  RELEASED: 'released',
  LOCK_EXPIRED: 'lock_expired',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_FAILED: 'message_failed',
  MARKED_READ: 'marked_read',
  CLOSED: 'closed',
  FORCE_TRANSFERRED: 'force_transferred'
};

// Mesmos papéis de ADMIN_ROLES em admin.routes.js — mantido como constante
// própria deste módulo para não alterar o arquivo de rotas administrativas
// existente. Ajustar os dois lugares juntos se a lista de papéis mudar.
const SUPPORT_CHAT_ROLES = ['admin', 'administrativo'];

// Lease padrão do lock de posse do ticket (heartbeat deve renovar antes de
// expirar). Progressão de flags (todas nascem desligadas por padrão):
// desligado -> SUPPORT_CHAT_ENABLED (captura/leitura) -> SUPPORT_CHAT_SEND_ENABLED (envio humano).
const DEFAULT_LOCK_LEASE_MS = Number(process.env.SUPPORT_CHAT_LOCK_LEASE_MS || 2 * 60 * 1000);

function isFlagEnabled(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function isSupportChatEnabled() {
  return isFlagEnabled('SUPPORT_CHAT_ENABLED');
}

function isSupportChatReadEnabled() {
  return isFlagEnabled('SUPPORT_CHAT_READ_ENABLED');
}

function isSupportChatSendEnabled() {
  return isFlagEnabled('SUPPORT_CHAT_SEND_ENABLED');
}

module.exports = {
  CONVERSATION_STATUS,
  MESSAGE_DIRECTION,
  CONVERSATION_EVENT_TYPES,
  SUPPORT_CHAT_ROLES,
  DEFAULT_LOCK_LEASE_MS,
  isSupportChatEnabled,
  isSupportChatReadEnabled,
  isSupportChatSendEnabled
};
