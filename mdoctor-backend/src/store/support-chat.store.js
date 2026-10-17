// Fundação do Chat Administrativo de Suporte V1 (ETAPA 1).
// Persistência isolada nas 3 tabelas novas (support_conversations,
// support_chat_messages, support_conversation_events). Não lê nem escreve em
// support_tickets, support_messages, whatsapp_messages ou em qualquer tabela
// do fluxo clínico.
const T = require('../db/tables');
const { dbQuery, PersistenceError } = require('../db/persistence');
const logger = require('../config/logger');
const {
  CONVERSATION_STATUS,
  MESSAGE_DIRECTION,
  CONVERSATION_EVENT_TYPES,
  DEFAULT_LOCK_LEASE_MS,
  MESSAGING_WINDOW_MS
} = require('../constants/support-chat');

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error) {
  return error instanceof PersistenceError && error.cause?.code === UNIQUE_VIOLATION;
}

async function getConversationById(conversationId) {
  if (!conversationId) return null;
  const data = await dbQuery('buscar support_conversation por id', async (supabase) =>
    supabase.from(T.SUPPORT_CONVERSATIONS).select('*').eq('id', conversationId).maybeSingle()
  );
  return data || null;
}

async function getConversationByAppointmentId(appointmentId) {
  if (!appointmentId) return null;
  const data = await dbQuery('buscar support_conversation por appointment', async (supabase) =>
    supabase.from(T.SUPPORT_CONVERSATIONS).select('*').eq('appointment_id', appointmentId).maybeSingle()
  );
  return data || null;
}

// Fila do Painel Administrativo (ETAPA 2, leitura): conversations ainda não
// encerradas, ordenadas pela atividade mais recente — usa o índice
// (status, last_message_at desc) da migração.
async function listQueue({ limit = 100 } = {}) {
  const data = await dbQuery('listar fila support_conversations', async (supabase) =>
    supabase
      .from(T.SUPPORT_CONVERSATIONS)
      .select('*')
      .neq('status', CONVERSATION_STATUS.CLOSED)
      .order('last_message_at', { ascending: false })
      .limit(limit)
  );
  return data || [];
}

// Para o indicador de tempo "Suporte Administrativo" (admin.routes.js,
// computeTempos): diferente de listQueue (só fila ATIVA, usada pela UI), a
// métrica precisa de TODAS as conversations, inclusive já encerradas —
// senão o indicador ficaria enviesado só pelas ainda abertas.
async function listAllConversations({ limit = 500 } = {}) {
  const data = await dbQuery('listar todas support_conversations (métricas)', async (supabase) =>
    supabase.from(T.SUPPORT_CONVERSATIONS).select('*').limit(limit)
  );
  return data || [];
}

// Regra determinística (unique(appointment_id) garante a idempotência no
// banco): se já existe conversation para o appointment, retorna a existente
// sem alterar seu estado de lock/status; só cria quando realmente não existe.
async function ensureConversationForAppointment({ appointmentId, patientId = null, metadata = {} }) {
  if (!appointmentId) {
    const error = new Error('appointmentId obrigatório');
    error.statusCode = 400;
    throw error;
  }

  const existing = await getConversationByAppointmentId(appointmentId);
  if (existing) {
    return { created: false, conversation: existing };
  }

  try {
    const conversation = await dbQuery('criar support_conversation', async (supabase) =>
      supabase
        .from(T.SUPPORT_CONVERSATIONS)
        .insert({
          appointment_id: appointmentId,
          patient_id: patientId,
          status: CONVERSATION_STATUS.OPEN,
          metadata
        })
        .select('*')
        .single()
    );

    await recordEventSafe({
      conversationId: conversation.id,
      eventType: CONVERSATION_EVENT_TYPES.CONVERSATION_CREATED,
      actor: 'system',
      payload: { appointment_id: appointmentId }
    });

    return { created: true, conversation };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Corrida: outra chamada criou a conversation entre o select e o
      // insert. unique(appointment_id) garantiu que só uma sobreviveu.
      const resolved = await getConversationByAppointmentId(appointmentId);
      if (resolved) return { created: false, conversation: resolved };
    }
    throw error;
  }
}

// Claim atômico: a autoridade sobre a posse é o UPDATE condicional no
// servidor (WHERE locked_by is null OR lock_expires_at expirado OU já é o
// próprio ator), não a UI. Postgres resolve a corrida a nível de linha — de
// duas chamadas concorrentes só uma casa com o WHERE e atualiza a linha.
// A 3ª condição (locked_by = actorId) torna o claim do PRÓPRIO dono sempre
// idempotente — renova o lease em vez de falhar com locked_by_other — para
// um reload de página ou reconexão (beforeunload não é confiável) nunca
// deixar o próprio atendente trancado para fora da conversation que ele
// mesmo está respondendo. O claim NUNCA escreve em `status` — posse
// (locked_by/locked_at/lock_expires_at) e estado da conversa
// (open/awaiting_agent/awaiting_patient/closed) são campos independentes
// por desenho (ver constants/support-chat.js).
async function claimConversation({ conversationId, actorId, leaseMs = DEFAULT_LOCK_LEASE_MS }) {
  if (!conversationId || !actorId) {
    const error = new Error('conversationId e actorId são obrigatórios');
    error.statusCode = 400;
    throw error;
  }

  // Leitura prévia só para decidir se o lock que está sendo tomado estava
  // expirado (para auditar LOCK_EXPIRED) — nunca é a fonte de verdade da
  // posse. Best-effort: se falhar, o claim segue normalmente, só sem esse
  // evento extra de auditoria. Extrai os valores em primitivos imediatamente
  // — nunca guarda a referência ao objeto, porque o UPDATE abaixo (ou, em
  // teste, o cliente fake que muta linhas em memória) pode alterar o mesmo
  // objeto antes desta leitura prévia ser usada.
  const before = await getConversationById(conversationId).catch(() => null);
  const prevLockedBy = before?.locked_by || null;
  const prevLockExpiresAt = before?.lock_expires_at || null;

  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + leaseMs).toISOString();

  const rows = await dbQuery('reivindicar support_conversation', async (supabase) =>
    supabase
      .from(T.SUPPORT_CONVERSATIONS)
      .update({
        locked_by: actorId,
        locked_at: nowIso,
        lock_expires_at: expiresIso,
        updated_at: nowIso
      })
      .eq('id', conversationId)
      .neq('status', CONVERSATION_STATUS.CLOSED)
      .or(`locked_by.is.null,lock_expires_at.lt.${nowIso},locked_by.eq.${actorId}`)
      .select('*')
  );

  if (Array.isArray(rows) && rows.length === 1) {
    const tookOverExpiredLock = Boolean(
      prevLockedBy &&
      prevLockedBy !== actorId &&
      prevLockExpiresAt &&
      new Date(prevLockExpiresAt).getTime() < Date.now()
    );
    if (tookOverExpiredLock) {
      await recordEventSafe({
        conversationId,
        eventType: CONVERSATION_EVENT_TYPES.LOCK_EXPIRED,
        actor: prevLockedBy,
        payload: { expired_lock_expires_at: prevLockExpiresAt, reclaimed_by: actorId }
      });
    }
    await recordEventSafe({
      conversationId,
      eventType: CONVERSATION_EVENT_TYPES.CLAIMED,
      actor: actorId,
      payload: { lock_expires_at: expiresIso }
    });
    return { claimed: true, conversation: rows[0] };
  }

  const current = await getConversationById(conversationId);
  if (!current) {
    return { claimed: false, reason: 'not_found', conversation: null };
  }
  if (current.status === CONVERSATION_STATUS.CLOSED) {
    return { claimed: false, reason: 'closed', conversation: current };
  }
  return { claimed: false, reason: 'locked_by_other', conversation: current };
}

// Libera o lock apenas se o chamador for o dono atual — nunca libera lock de
// outro ator. Não toca em `status`: o estado da conversa (quem deve agir em
// seguida) não muda só porque o atendente liberou a posse.
async function releaseConversation({ conversationId, actorId }) {
  if (!conversationId || !actorId) {
    const error = new Error('conversationId e actorId são obrigatórios');
    error.statusCode = 400;
    throw error;
  }

  const nowIso = new Date().toISOString();
  const rows = await dbQuery('liberar support_conversation', async (supabase) =>
    supabase
      .from(T.SUPPORT_CONVERSATIONS)
      .update({
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        updated_at: nowIso
      })
      .eq('id', conversationId)
      .eq('locked_by', actorId)
      .select('*')
  );

  if (Array.isArray(rows) && rows.length === 1) {
    await recordEventSafe({
      conversationId,
      eventType: CONVERSATION_EVENT_TYPES.RELEASED,
      actor: actorId,
      payload: {}
    });
    return { released: true, conversation: rows[0] };
  }

  return { released: false, conversation: await getConversationById(conversationId) };
}

// Renova o lock apenas se o chamador ainda for o dono e a conversation não
// tiver sido encerrada — mesma validação de posse no servidor que o claim.
async function heartbeatConversation({ conversationId, actorId, leaseMs = DEFAULT_LOCK_LEASE_MS }) {
  if (!conversationId || !actorId) {
    const error = new Error('conversationId e actorId são obrigatórios');
    error.statusCode = 400;
    throw error;
  }

  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + leaseMs).toISOString();

  const rows = await dbQuery('renovar lock support_conversation', async (supabase) =>
    supabase
      .from(T.SUPPORT_CONVERSATIONS)
      .update({ lock_expires_at: expiresIso, updated_at: nowIso })
      .eq('id', conversationId)
      .eq('locked_by', actorId)
      .neq('status', CONVERSATION_STATUS.CLOSED)
      .select('*')
  );

  if (Array.isArray(rows) && rows.length === 1) {
    return { renewed: true, conversation: rows[0] };
  }
  return { renewed: false, conversation: await getConversationById(conversationId) };
}

// Encerramento exige posse (mesma regra do claim/release) — a interface não
// pode encerrar sem o lock validado no servidor.
async function closeConversation({ conversationId, actorId }) {
  if (!conversationId || !actorId) {
    const error = new Error('conversationId e actorId são obrigatórios');
    error.statusCode = 400;
    throw error;
  }

  const nowIso = new Date().toISOString();
  const rows = await dbQuery('encerrar support_conversation', async (supabase) =>
    supabase
      .from(T.SUPPORT_CONVERSATIONS)
      .update({
        status: CONVERSATION_STATUS.CLOSED,
        closed_at: nowIso,
        closed_by: actorId,
        locked_by: null,
        locked_at: null,
        lock_expires_at: null,
        updated_at: nowIso
      })
      .eq('id', conversationId)
      .eq('locked_by', actorId)
      .select('*')
  );

  if (Array.isArray(rows) && rows.length === 1) {
    await recordEventSafe({
      conversationId,
      eventType: CONVERSATION_EVENT_TYPES.CLOSED,
      actor: actorId,
      payload: {}
    });
    return { closed: true, conversation: rows[0] };
  }

  return { closed: false, conversation: await getConversationById(conversationId) };
}

async function findMessageByProviderId({ conversationId, providerMessageId }) {
  if (!conversationId || !providerMessageId) return null;
  const data = await dbQuery('buscar support_chat_message por provider_message_id', async (supabase) =>
    supabase
      .from(T.SUPPORT_CHAT_MESSAGES)
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('provider_message_id', providerMessageId)
      .maybeSingle()
  );
  return data || null;
}

async function findMessageByClientId({ conversationId, clientMessageId }) {
  if (!conversationId || !clientMessageId) return null;
  const data = await dbQuery('buscar support_chat_message por client_message_id', async (supabase) =>
    supabase
      .from(T.SUPPORT_CHAT_MESSAGES)
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('client_message_id', clientMessageId)
      .maybeSingle()
  );
  return data || null;
}

// Best-effort: atualiza o marcador de atividade da fila e o ESTADO da
// conversa (quem deve agir em seguida) após uma mensagem nova. Nunca
// bloqueia o registro da mensagem (que já aconteceu) se isso falhar — mesma
// postura de recordEventSafe. `.neq('status', CLOSED)` — uma mensagem
// (ex.: webhook atrasado) nunca reabre sozinha uma conversa já encerrada.
async function touchAfterMessage(conversationId, { whenIso, direction }) {
  try {
    const nextStatus = direction === MESSAGE_DIRECTION.INBOUND
      ? CONVERSATION_STATUS.AWAITING_AGENT
      : CONVERSATION_STATUS.AWAITING_PATIENT;
    const patch = { last_message_at: whenIso, status: nextStatus, updated_at: whenIso };
    if (direction === MESSAGE_DIRECTION.INBOUND) patch.last_inbound_at = whenIso;

    await dbQuery('atualizar support_conversation após mensagem', async (supabase) =>
      supabase
        .from(T.SUPPORT_CONVERSATIONS)
        .update(patch)
        .eq('id', conversationId)
        .neq('status', CONVERSATION_STATUS.CLOSED)
        .select('*')
    );
  } catch (error) {
    logger.error('support_chat_touch_after_message_failed', {
      conversationId: conversationId || null,
      error: error?.message || String(error)
    });
  }
}

// Idempotente por (conversation_id, provider_message_id) — mesma mensagem de
// provider entregue duas vezes (retry da Meta, reentrega de webhook) nunca
// duplica linha — e por (conversation_id, client_message_id) — mesma
// solicitação de envio humano (duplo clique, retry HTTP) também nunca
// duplica, mesmo antes de existir provider_message_id. Toda inserção nova
// (nunca as reentregas idempotentes) grava MESSAGE_SENT em
// support_conversation_events — trilha de auditoria exigida desde a V1.
async function recordMessage({
  conversationId,
  direction,
  body = '',
  sender = null,
  providerMessageId = null,
  clientMessageId = null,
  media = null,
  metadata = {}
}) {
  if (!conversationId || !direction) {
    const error = new Error('conversationId e direction são obrigatórios');
    error.statusCode = 400;
    throw error;
  }

  if (providerMessageId) {
    const existing = await findMessageByProviderId({ conversationId, providerMessageId });
    if (existing) return { duplicate: true, message: existing };
  }
  if (clientMessageId) {
    const existing = await findMessageByClientId({ conversationId, clientMessageId });
    if (existing) return { duplicate: true, message: existing };
  }

  try {
    const message = await dbQuery('criar support_chat_message', async (supabase) =>
      supabase
        .from(T.SUPPORT_CHAT_MESSAGES)
        .insert({
          conversation_id: conversationId,
          direction,
          body,
          sender,
          provider_message_id: providerMessageId,
          client_message_id: clientMessageId,
          media,
          metadata
        })
        .select('*')
        .single()
    );
    await touchAfterMessage(conversationId, { whenIso: message.created_at, direction });
    await recordEventSafe({
      conversationId,
      eventType: CONVERSATION_EVENT_TYPES.MESSAGE_SENT,
      actor: sender || direction,
      payload: { direction, message_id: message.id, provider_message_id: providerMessageId, client_message_id: clientMessageId }
    });
    return { duplicate: false, message };
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (providerMessageId) {
        const existing = await findMessageByProviderId({ conversationId, providerMessageId });
        if (existing) return { duplicate: true, message: existing };
      }
      if (clientMessageId) {
        const existing = await findMessageByClientId({ conversationId, clientMessageId });
        if (existing) return { duplicate: true, message: existing };
      }
    }
    await recordEventSafe({
      conversationId,
      eventType: CONVERSATION_EVENT_TYPES.MESSAGE_FAILED,
      actor: sender || direction,
      payload: { direction, provider_message_id: providerMessageId, client_message_id: clientMessageId, error: error?.message || String(error) }
    });
    throw error;
  }
}

// Reserva atômica de client_message_id ANTES de chamar o provider externo
// (ver sendHumanMessage no service): o índice único de
// (conversation_id, client_message_id) vira um lock de concorrência real —
// de duas chamadas simultâneas com o MESMO client_message_id novo, só uma
// consegue inserir; a outra recebe 23505, relê a linha vencedora e nunca
// chega a chamar a Meta. Sem isso, as duas passariam pelo
// findMessageByClientId (nenhuma ainda inserida) e enviariam a mesma
// mensagem duas vezes ao paciente antes do unique constraint entrar em jogo.
async function reserveOutboundMessage({ conversationId, body, sender, clientMessageId }) {
  if (!conversationId || !clientMessageId) {
    const error = new Error('conversationId e clientMessageId são obrigatórios');
    error.statusCode = 400;
    throw error;
  }

  try {
    const message = await dbQuery('reservar support_chat_message outbound', async (supabase) =>
      supabase
        .from(T.SUPPORT_CHAT_MESSAGES)
        .insert({
          conversation_id: conversationId,
          direction: MESSAGE_DIRECTION.OUTBOUND,
          body,
          sender,
          provider_message_id: null,
          client_message_id: clientMessageId,
          media: null,
          metadata: {}
        })
        .select('*')
        .single()
    );
    return { duplicate: false, message };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await findMessageByClientId({ conversationId, clientMessageId });
      if (existing) return { duplicate: true, message: existing };
    }
    throw error;
  }
}

// Confirma a reserva depois que o provider aceitou o envio: só agora grava
// provider_message_id, atualiza last_message_at/status (touchAfterMessage) e
// registra o evento MESSAGE_SENT — nenhum desses efeitos acontece no momento
// da reserva, exatamente para não marcar "enviado" antes de ter certeza.
async function finalizeOutboundMessage({ messageId, conversationId, providerMessageId }) {
  const message = await dbQuery('confirmar support_chat_message outbound', async (supabase) =>
    supabase
      .from(T.SUPPORT_CHAT_MESSAGES)
      .update({ provider_message_id: providerMessageId })
      .eq('id', messageId)
      .select('*')
      .single()
  );
  await touchAfterMessage(conversationId, { whenIso: message.created_at, direction: MESSAGE_DIRECTION.OUTBOUND });
  await recordEventSafe({
    conversationId,
    eventType: CONVERSATION_EVENT_TYPES.MESSAGE_SENT,
    actor: message.sender,
    payload: {
      direction: MESSAGE_DIRECTION.OUTBOUND,
      message_id: message.id,
      provider_message_id: providerMessageId,
      client_message_id: message.client_message_id
    }
  });
  return message;
}

// Remove a reserva quando o provider falha de verdade: como a mensagem NUNCA
// chegou ao paciente, a linha não representa histórico real — mantê-la
// pareceria, para o atendente, com um envio bem-sucedido (sem
// provider_message_id o item some no card de distinção visual). O evento
// MESSAGE_FAILED (gravado por quem chama) continua sendo o registro de
// auditoria da tentativa.
async function deleteReservedMessage(messageId) {
  if (!messageId) return;
  await dbQuery('remover reserva support_chat_message não confirmada', async (supabase) =>
    supabase.from(T.SUPPORT_CHAT_MESSAGES).delete().eq('id', messageId)
  );
}

// Janela de mensagem livre da Meta (24h desde a última mensagem do
// PACIENTE). Pura função de leitura — não envia nada, não bloqueia nada por
// si só; quem um dia implementar o envio humano real (fora desta etapa)
// consulta isto antes de tentar mandar texto livre. Sem last_inbound_at
// (conversa nunca recebeu mensagem do paciente) é tratado como fora da
// janela — nunca assume que está dentro por falta de dado.
function getMessagingWindowStatus(conversation, { now = new Date(), windowMs = MESSAGING_WINDOW_MS } = {}) {
  const lastInboundAt = conversation?.last_inbound_at ? new Date(conversation.last_inbound_at) : null;
  if (!lastInboundAt || Number.isNaN(lastInboundAt.getTime())) {
    return { withinWindow: false, lastInboundAt: null, expiresAt: null, requiresTemplate: true };
  }
  const expiresAt = new Date(lastInboundAt.getTime() + windowMs);
  const withinWindow = now.getTime() < expiresAt.getTime();
  return { withinWindow, lastInboundAt: lastInboundAt.toISOString(), expiresAt: expiresAt.toISOString(), requiresTemplate: !withinWindow };
}

async function listMessages(conversationId, { limit = 200 } = {}) {
  if (!conversationId) return [];
  const data = await dbQuery('listar support_chat_messages', async (supabase) =>
    supabase
      .from(T.SUPPORT_CHAT_MESSAGES)
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(limit)
  );
  return data || [];
}

async function recordEvent({ conversationId, eventType, actor = null, payload = {} }) {
  if (!conversationId || !eventType) {
    const error = new Error('conversationId e eventType são obrigatórios');
    error.statusCode = 400;
    throw error;
  }

  const event = await dbQuery('criar support_conversation_event', async (supabase) =>
    supabase
      .from(T.SUPPORT_CONVERSATION_EVENTS)
      .insert({ conversation_id: conversationId, event_type: eventType, actor, payload })
      .select('*')
      .single()
  );
  return event;
}

// Wrapper nunca lançante: uma falha de auditoria não pode interromper o fluxo
// que a chamou (ex.: recordInbound em cima desta fundação, na ETAPA 2) — mas
// a falha é logada de forma estruturada, nunca silenciosa, com os
// identificadores disponíveis para diagnóstico.
async function recordEventSafe({ conversationId, eventType, actor = null, payload = {} }) {
  try {
    return await recordEvent({ conversationId, eventType, actor, payload });
  } catch (error) {
    logger.error('support_chat_event_record_failed', {
      conversationId: conversationId || null,
      eventType: eventType || null,
      actor: actor || null,
      error: error?.message || String(error)
    });
    return null;
  }
}

module.exports = {
  getConversationById,
  getConversationByAppointmentId,
  listQueue,
  listAllConversations,
  ensureConversationForAppointment,
  claimConversation,
  releaseConversation,
  heartbeatConversation,
  closeConversation,
  findMessageByProviderId,
  findMessageByClientId,
  recordMessage,
  reserveOutboundMessage,
  finalizeOutboundMessage,
  deleteReservedMessage,
  listMessages,
  recordEvent,
  recordEventSafe,
  getMessagingWindowStatus
};
