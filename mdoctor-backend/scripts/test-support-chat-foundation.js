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
  let conversationId;
  {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-2' });
    conversationId = conversation.id;
    const claim = await store.claimConversation({ conversationId, actorId: 'admin-1', leaseMs: 60000 });
    assert.equal(claim.claimed, true);
    assert.equal(claim.conversation.locked_by, 'admin-1');
    assert.equal(claim.conversation.status, CONVERSATION_STATUS.CLAIMED);
    results.claimAtomicoPrimeiroAtorReivindica = 'ok';
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

  // 5) Release só funciona para o próprio dono; depois do release o
  //    ticket volta a 'open' e outro ator consegue reivindicar.
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
  //    release explícito.
  {
    const expired = fakeDb.rows('support_conversations').find((r) => r.id === conversationId);
    expired.lock_expires_at = new Date(Date.now() - 1000).toISOString();

    const claimAfterExpiry = await store.claimConversation({ conversationId, actorId: 'admin-3', leaseMs: 60000 });
    assert.equal(claimAfterExpiry.claimed, true);
    assert.equal(claimAfterExpiry.conversation.locked_by, 'admin-3');
    results.lockExpiradoPermiteNovoClaim = 'ok';
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
  //    (retry da Meta) nunca duplica linha.
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
    results.idempotenciaMensagemPorProviderMessageId = 'ok';
  }

  // 9) Mensagens sem provider_message_id (ex.: envio humano manual) nunca
  //    colidem entre si — só a combinação (conversation_id, provider_id) é única.
  //    Cada inserção também atualiza last_message_at da conversation (índice
  //    de ordenação da fila por atividade recente).
  {
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-4' });
    assert.equal(conversation.last_message_at, undefined);
    const m1 = await store.recordMessage({ conversationId: conversation.id, direction: 'outbound', body: 'primeira' });
    const m2 = await store.recordMessage({ conversationId: conversation.id, direction: 'outbound', body: 'segunda' });
    assert.equal(m1.duplicate, false);
    assert.equal(m2.duplicate, false);
    assert.notEqual(m1.message.id, m2.message.id);
    const listed = await store.listMessages(conversation.id);
    assert.equal(listed.length, 2);
    const refreshed = await store.getConversationById(conversation.id);
    assert.equal(refreshed.last_message_at, m2.message.created_at);
    results.mensagensSemProviderIdNuncaColidemEListaFunciona = 'ok';
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

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
