// Fundação do Chat Administrativo de Suporte V1 (ETAPA 1).
// Módulo isolado: não participa do fluxo clínico, da fila médica, do bridge
// do Typebot nem do suporte via WhatsApp já existente (whatsapp-support.service.js).
// Tabelas próprias: support_conversations, support_chat_messages,
// support_conversation_events — nunca support_tickets/support_messages/whatsapp_messages.

// Estado da CONVERSA — independente da posse (locked_by/locked_at/
// lock_expires_at, ver support-chat.store.js). Reflete de quem é a vez de
// agir, não quem está com o ticket: duas coisas diferentes por desenho
// (pedido explícito do usuário, 10/10/2026) — um atendente pode estar com o
// lock e a conversa ainda estar 'awaiting_patient' porque já respondeu.
const CONVERSATION_STATUS = {
  OPEN: 'open', // criada, ainda sem nenhuma mensagem
  AWAITING_AGENT: 'awaiting_agent', // última mensagem foi do paciente (inbound)
  AWAITING_PATIENT: 'awaiting_patient', // última mensagem foi do atendente (outbound)
  CLOSED: 'closed'
};

const MESSAGE_DIRECTION = {
  INBOUND: 'inbound',
  OUTBOUND: 'outbound'
};

// Eventos de auditoria exigidos desde a V1 (support_conversation_events):
// claim, release, timeout (lock expirado e retomado por outro ator),
// mensagens (capturadas ou enviadas), falhas de envio e fechamento.
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
// expirar).
const DEFAULT_LOCK_LEASE_MS = Number(process.env.SUPPORT_CHAT_LOCK_LEASE_MS || 2 * 60 * 1000);

// Janela de mensagem livre da Meta (WhatsApp Business Platform): texto fora
// de template só é aceito até 24h depois da ÚLTIMA mensagem do paciente
// (last_inbound_at da conversation, nunca last_message_at, que mistura as
// duas direções). Preparado aqui para ser consultado por quem um dia enviar
// de verdade (ETAPA de envio humano) — nenhum envio real existe ainda nesta
// etapa. Nenhum template de reengajamento é criado/publicado por este
// módulo; isUtilityTemplateRequired() só sinaliza a condição.
const MESSAGING_WINDOW_MS = Number(process.env.SUPPORT_CHAT_MESSAGING_WINDOW_MS || 24 * 60 * 60 * 1000);

// Três flags independentes pedidas explicitamente pelo usuário (10/10/2026),
// todas desligadas por padrão. Nenhuma delas liga as outras — cada ponto de
// integração consulta só a flag que o protege:
//   CAPTURE  -> grava mensagem inbound recebida (ligação futura com o
//               webhook/bridge do WhatsApp, ainda não feita nesta etapa).
//   AGENT_SEND -> autoriza o atendente a enviar mensagem real ao paciente
//               (endpoint de envio humano, ainda não implementado nesta
//               etapa — reservado para quando existir).
//   UI       -> expõe as rotas administrativas de leitura/gestão (listar
//               fila, abrir conversation, claim/release/close) usadas pelo
//               frontend.
function isFlagEnabled(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function isSupportChatCaptureEnabled() {
  return isFlagEnabled('SUPPORT_CHAT_CAPTURE_ENABLED');
}

function isSupportChatAgentSendEnabled() {
  return isFlagEnabled('SUPPORT_CHAT_AGENT_SEND_ENABLED');
}

function isSupportChatUiEnabled() {
  return isFlagEnabled('SUPPORT_CHAT_UI_ENABLED');
}

module.exports = {
  CONVERSATION_STATUS,
  MESSAGE_DIRECTION,
  CONVERSATION_EVENT_TYPES,
  SUPPORT_CHAT_ROLES,
  DEFAULT_LOCK_LEASE_MS,
  MESSAGING_WINDOW_MS,
  isSupportChatCaptureEnabled,
  isSupportChatAgentSendEnabled,
  isSupportChatUiEnabled
};
