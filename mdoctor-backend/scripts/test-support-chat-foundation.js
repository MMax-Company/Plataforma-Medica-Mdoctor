// ETAPA 1 (fundação do Chat Administrativo de Suporte V1) — testes offline,
// sem Supabase/rede real. Stuba ../config/supabase com um cliente fake
// (scripts/_fakes/fake-supabase-client.js) na mesma técnica de
// require.cache usada em test-clinical-decision-approve-reject.js, para
// exercitar o store real (support-chat.store.js) com semântica de filtro e
// unique constraint de verdade.
const assert = require('assert');
const path = require('path');
const { FakeSupabaseClient } = require('./_fakes/fake-supabase-client');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const storePath = path.join(__dirname, '..', 'src', 'store', 'support-chat.store.js');
const resolveFrom = (p) => path.join(path.dirname(storePath), p);

const fakeDb = new FakeSupabaseClient({
  uniqueConstraints: {
    support_conversations: [['appointment_id']],
    support_chat_messages: [['conversation_id', 'provider_message_id'], ['conversation_id', 'client_message_id']]
  }
});

stub(resolveFrom('../config/supabase'), {
  isSupabaseConfigured: () => true,
  getSupabase: () => fakeDb
});

const store = require(storePath);
const { CONVERSATION_STATUS, CONVERSATION_EVENT_TYPES } = require('../src/constants/support-chat');

const results = {};

async function main() {
  // 1) unique(appointment_id) impede duplicidade — segunda chamada para o
  //    mesmo appointment retorna a conversation já existente, sem criar outra.
  {
    const first = await store.ensureConversationForAppointment({ appointmentId: 'appt-1', patientId: 'pat-1' });
    const second = await store.ensureConversationForAppointment({ appointmentId: 'appt-1', patientId: 'pat-1' });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.conversation.id, second.conversation.id);
    assert.equal(fakeDb.rows('support_conversations').filter((r) => r.appointment_id === 'appt-1').length, 1);
    assert.equal(first.conversation.status, CONVERSATION_STATUS.OPEN);
    const events = fakeDb.rows('support_conversation_events').filter((e) => e.conversation_id === first.conversation.id);
    assert.ok(events.some((e) => e.event_type === CONVERSATION_EVENT_TYPES.CONVERSATION_CREATED));
    results.uniqueAppointmentImpedeDuplicidade = 'ok';
  }

  // 2) Claim atômico: backend é a autoridade — primeiro ator reivindica.
  //    Claim NUNCA escreve em `status` — posse e estado da conversa são
  //    campos independentes (pedido explícito do usuário, 10/10/2026).
  let conversationId;
  {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-2' });
    conversationId = conversation.id;
    const claim = await store.claimConversation({ conversationId, actorId: 'admin-1', leaseMs: 60000 });
    assert.equal(claim.claimed, true);
    assert.equal(claim.conversation.locked_by, 'admin-1');
    assert.equal(claim.conversation.status, CONVERSATION_STATUS.OPEN);
    const events = fakeDb.rows('support_conversation_events').filter((e) => e.conversation_id === conversationId);
    assert.ok(events.some((e) => e.event_type === CONVERSATION_EVENT_TYPES.CLAIMED && e.actor === 'admin-1'));
    results.claimAtomicoPrimeiroAtorReivindicaSemAlterarStatus = 'ok';
  }

  // 2b) O PRÓPRIO dono consegue reivindicar de novo (idempotente) enquanto
  //     o lock ainda está válido — renova o lease em vez de ser rejeitado
  //     como locked_by_other. Necessário para reload de página/reconexão
  //     (beforeunload não é confiável) nunca trancar o atendente para fora
  //     da própria conversation que ele está respondendo (achado de revisão,
  //     17/10/2026).
  {
    const before = await store.getConversationById(conversationId);
    const beforeExpiresAt = before.lock_expires_at; // extrai o primitivo — o update abaixo muta o mesmo objeto em memória no fake client
    const selfReclaim = await store.claimConversation({ conversationId, actorId: 'admin-1', leaseMs: 90000 });
    assert.equal(selfReclaim.claimed, true);
    assert.equal(selfReclaim.conversation.locked_by, 'admin-1');
    assert.ok(
      new Date(selfReclaim.conversation.lock_expires_at).getTime() > new Date(beforeExpiresAt).getTime(),
      'reclaim do próprio dono deveria renovar (estender) o lease'
    );
    results.proprioDonoReivindicaDeNovoComLockAindaValidoRenovaOLease = 'ok';
  }

  // 3) Segundo ator não consegue reivindicar enquanto o lock estiver ativo —
  //    posse validada no servidor, não na interface.
  {
    const claim2 = await store.claimConversation({ conversationId, actorId: 'admin-2', leaseMs: 60000 });
    assert.equal(claim2.claimed, false);
    assert.equal(claim2.reason, 'locked_by_other');
    assert.equal(claim2.conversation.locked_by, 'admin-1');
    results.segundoAtorNaoReivindicaLockAtivo = 'ok';
  }

  // 4) Heartbeat só renova o lock do próprio dono; outro ator não consegue.
  {
    const hbOther = await store.heartbeatConversation({ conversationId, actorId: 'admin-2', leaseMs: 60000 });
    assert.equal(hbOther.renewed, false);

    const hbOwner = await store.heartbeatConversation({ conversationId, actorId: 'admin-1', leaseMs: 120000 });
    assert.equal(hbOwner.renewed, true);
    results.heartbeatSoRenovaLockDoProprioDono = 'ok';
  }

  // 5) Release só funciona para o próprio dono; libera o lock sem alterar o
  //    `status` da conversa (que permanece 'open', pois nenhuma mensagem
  //    foi registrada ainda neste cenário).
  {
    const releaseOther = await store.releaseConversation({ conversationId, actorId: 'admin-2' });
    assert.equal(releaseOther.released, false);

    const releaseOwner = await store.releaseConversation({ conversationId, actorId: 'admin-1' });
    assert.equal(releaseOwner.released, true);
    assert.equal(releaseOwner.conversation.status, CONVERSATION_STATUS.OPEN);
    assert.equal(releaseOwner.conversation.locked_by, null);

    const claimNext = await store.claimConversation({ conversationId, actorId: 'admin-2', leaseMs: 60000 });
    assert.equal(claimNext.claimed, true);
    assert.equal(claimNext.conversation.locked_by, 'admin-2');
    results.releaseSoProprioDonoDepoisLiberaParaOutro = 'ok';
  }

  // 6) Lock expirado permite que outro ator reivindique sem precisar de
  //    release explícito — e isso é auditado como LOCK_EXPIRED (trilha
  //    obrigatória de timeout), atribuído ao dono anterior, além do CLAIMED
  //    do novo dono.
  {
    const expired = fakeDb.rows('support_conversations').find((r) => r.id === conversationId);
    expired.lock_expires_at = new Date(Date.now() - 1000).toISOString();

    const claimAfterExpiry = await store.claimConversation({ conversationId, actorId: 'admin-3', leaseMs: 60000 });
    assert.equal(claimAfterExpiry.claimed, true);
    assert.equal(claimAfterExpiry.conversation.locked_by, 'admin-3');

    const events = fakeDb.rows('support_conversation_events').filter((e) => e.conversation_id === conversationId);
    const lockExpiredEvent = events.find((e) => e.event_type === CONVERSATION_EVENT_TYPES.LOCK_EXPIRED);
    assert.ok(lockExpiredEvent, 'esperava evento lock_expired auditado');
    assert.equal(lockExpiredEvent.actor, 'admin-2');
    assert.equal(lockExpiredEvent.payload.reclaimed_by, 'admin-3');
    assert.ok(events.some((e) => e.event_type === CONVERSATION_EVENT_TYPES.CLAIMED && e.actor === 'admin-3'));
    results.lockExpiradoPermiteNovoClaimEAuditaTimeout = 'ok';
  }

  // 7) Encerramento exige posse; depois de encerrado, nenhum claim é aceito.
  {
    const closeWrongOwner = await store.closeConversation({ conversationId, actorId: 'admin-1' });
    assert.equal(closeWrongOwner.closed, false);

    const closeOwner = await store.closeConversation({ conversationId, actorId: 'admin-3' });
    assert.equal(closeOwner.closed, true);
    assert.equal(closeOwner.conversation.status, CONVERSATION_STATUS.CLOSED);

    const claimAfterClose = await store.claimConversation({ conversationId, actorId: 'admin-1', leaseMs: 60000 });
    assert.equal(claimAfterClose.claimed, false);
    assert.equal(claimAfterClose.reason, 'closed');
    results.encerramentoExigePosseEBloqueiaNovoClaim = 'ok';
  }

  // 8) Idempotência de mensagem por provider_message_id — mesma entrega
  //    (retry da Meta) nunca duplica linha. Só a primeira grava MESSAGE_SENT
  //    (reentrega idempotente não duplica o evento de auditoria).
  {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-3' });
    const r1 = await store.recordMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'oi',
      providerMessageId: 'wamid-123'
    });
    const r2 = await store.recordMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'oi (reentrega)',
      providerMessageId: 'wamid-123'
    });
    assert.equal(r1.duplicate, false);
    assert.equal(r2.duplicate, true);
    assert.equal(r1.message.id, r2.message.id);
    assert.equal(
      fakeDb.rows('support_chat_messages').filter((m) => m.conversation_id === conversation.id && m.provider_message_id === 'wamid-123').length,
      1
    );
    const sentEvents = fakeDb
      .rows('support_conversation_events')
      .filter((e) => e.conversation_id === conversation.id && e.event_type === CONVERSATION_EVENT_TYPES.MESSAGE_SENT);
    assert.equal(sentEvents.length, 1);
    results.idempotenciaMensagemPorProviderMessageId = 'ok';
  }

  // 9) Mensagens sem provider_message_id (ex.: envio humano manual) nunca
  //    colidem entre si — só a combinação (conversation_id, provider_id) é
  //    única. Cada inserção também atualiza last_message_at (fila por
  //    atividade recente) e avança o `status` para quem deve agir a seguir:
  //    inbound -> awaiting_agent (e grava last_inbound_at), outbound ->
  //    awaiting_patient (last_inbound_at não muda).
  {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-4' });
    assert.equal(conversation.last_message_at, undefined);
    assert.equal(conversation.status, CONVERSATION_STATUS.OPEN);

    const inbound = await store.recordMessage({ conversationId: conversation.id, direction: 'inbound', body: 'paciente escreveu' });
    const afterInbound = await store.getConversationById(conversation.id);
    assert.equal(afterInbound.status, CONVERSATION_STATUS.AWAITING_AGENT);
    assert.equal(afterInbound.last_inbound_at, inbound.message.created_at);

    const m1 = await store.recordMessage({ conversationId: conversation.id, direction: 'outbound', body: 'primeira' });
    const m2 = await store.recordMessage({ conversationId: conversation.id, direction: 'outbound', body: 'segunda' });
    assert.equal(m1.duplicate, false);
    assert.equal(m2.duplicate, false);
    assert.notEqual(m1.message.id, m2.message.id);
    const listed = await store.listMessages(conversation.id);
    assert.equal(listed.length, 3);
    const refreshed = await store.getConversationById(conversation.id);
    assert.equal(refreshed.last_message_at, m2.message.created_at);
    assert.equal(refreshed.status, CONVERSATION_STATUS.AWAITING_PATIENT);
    // last_inbound_at não avança com mensagens outbound — continua sendo a
    // da única mensagem inbound registrada.
    assert.equal(refreshed.last_inbound_at, inbound.message.created_at);
    results.statusAlternaEntreAwaitingAgentEAwaitingPatientPorDirection = 'ok';
  }

  // 9b) Idempotência de envio humano por client_message_id — duplo clique ou
  //     retry HTTP do frontend (ETAPA 4) nunca duplica, mesmo sem
  //     provider_message_id ainda (Meta não confirmou o envio).
  {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-5' });
    const c1 = await store.recordMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      body: 'resposta humana',
      clientMessageId: 'client-abc'
    });
    const c2 = await store.recordMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      body: 'resposta humana (duplo clique)',
      clientMessageId: 'client-abc'
    });
    assert.equal(c1.duplicate, false);
    assert.equal(c2.duplicate, true);
    assert.equal(c1.message.id, c2.message.id);
    assert.equal(
      fakeDb.rows('support_chat_messages').filter((m) => m.conversation_id === conversation.id && m.client_message_id === 'client-abc').length,
      1
    );
    results.idempotenciaEnvioHumanoPorClientMessageId = 'ok';
  }

  // 9c) Campo `media` (preparado para fase futura, não usado na V1) é
  //     persistido quando informado e permanece null quando omitido — o
  //     schema está pronto sem exigir outra migration.
  {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-6' });
    const withMedia = await store.recordMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      body: '',
      media: { type: 'image', placeholder: true }
    });
    const withoutMedia = await store.recordMessage({ conversationId: conversation.id, direction: 'outbound', body: 'sem mídia' });
    assert.deepEqual(withMedia.message.media, { type: 'image', placeholder: true });
    assert.equal(withoutMedia.message.media, null);
    results.campoMediaPreparadoSemUsoNaV1 = 'ok';
  }

  // 9d) Mensagem atrasada (ex.: webhook fora de ordem) nunca reabre uma
  //     conversa já encerrada — touchAfterMessage respeita `.neq('status',
  //     'closed')`; o insert da mensagem em si acontece (histórico
  //     completo), só o `status`/`last_message_at` da conversa não regride.
  {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-7' });
    const closed = await store.closeConversation({ conversationId: conversation.id, actorId: 'admin-x' });
    assert.equal(closed.closed, false); // sem posse ainda — closeConversation exige locked_by
    await store.claimConversation({ conversationId: conversation.id, actorId: 'admin-x', leaseMs: 60000 });
    const closedForReal = await store.closeConversation({ conversationId: conversation.id, actorId: 'admin-x' });
    assert.equal(closedForReal.closed, true);

    const strayMessage = await store.recordMessage({ conversationId: conversation.id, direction: 'inbound', body: 'mensagem atrasada' });
    assert.equal(strayMessage.duplicate, false);
    const afterStray = await store.getConversationById(conversation.id);
    assert.equal(afterStray.status, CONVERSATION_STATUS.CLOSED);
    results.mensagemAtrasadaNuncaReabreConversaEncerrada = 'ok';
  }

  // 10) Falha de auditoria (support_conversation_events) nunca interrompe o
  //     fluxo principal — recordEventSafe engole o erro e loga, sem lançar.
  {
    fakeDb.failNextInsert('support_conversation_events');
    const result = await store.recordEventSafe({
      conversationId: 'conversation-inexistente-para-teste',
      eventType: CONVERSATION_EVENT_TYPES.MESSAGE_FAILED,
      actor: 'system',
      payload: {}
    });
    assert.equal(result, null);
    results.falhaDeAuditoriaNuncaInterrompeFluxoPrincipal = 'ok';
  }

  // 11) Janela de mensagem livre da Meta (24h desde a última mensagem do
  //     PACIENTE) — função pura, sem rede/banco. Dentro, no limite e fora da
  //     janela, e o caso sem nenhuma mensagem inbound ainda (nunca assume
  //     "dentro da janela" por falta de dado).
  {
    const windowMs = 24 * 60 * 60 * 1000;
    const base = new Date('2026-01-01T00:00:00.000Z');

    const noInbound = store.getMessagingWindowStatus({ last_inbound_at: null }, { now: base });
    assert.equal(noInbound.withinWindow, false);
    assert.equal(noInbound.requiresTemplate, true);

    const within = store.getMessagingWindowStatus(
      { last_inbound_at: base.toISOString() },
      { now: new Date(base.getTime() + windowMs - 1000), windowMs }
    );
    assert.equal(within.withinWindow, true);
    assert.equal(within.requiresTemplate, false);

    const exactlyAtBoundary = store.getMessagingWindowStatus(
      { last_inbound_at: base.toISOString() },
      { now: new Date(base.getTime() + windowMs), windowMs }
    );
    assert.equal(exactlyAtBoundary.withinWindow, false);

    const outside = store.getMessagingWindowStatus(
      { last_inbound_at: base.toISOString() },
      { now: new Date(base.getTime() + windowMs + 1000), windowMs }
    );
    assert.equal(outside.withinWindow, false);
    assert.equal(outside.requiresTemplate, true);
    results.janelaDe24hDentroNoLimiteEForaSemAssumirDadoAusente = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
