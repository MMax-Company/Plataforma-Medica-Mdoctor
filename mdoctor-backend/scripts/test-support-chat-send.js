// ETAPA 2 (envio humano) — testes offline de support-chat.service.sendHumanMessage:
// idempotência por client_message_id, janela de 24h, posse do lock (claim),
// sucesso e falha de envio. O provider Meta é stubado via require.cache
// (mesma técnica usada para config/supabase em ETAPA 1/2) — NENHUMA chamada
// de rede real à Graph API da Meta acontece nestes testes, mesmo que
// WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID estejam configurados no
// ambiente onde o script roda.
const assert = require('assert');
const path = require('path');
const { FakeSupabaseClient } = require('./_fakes/fake-supabase-client');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const servicePath = path.join(__dirname, '..', 'src', 'services', 'support-chat.service.js');
const storePath = path.join(__dirname, '..', 'src', 'store', 'support-chat.store.js');
const resolveFromStore = (p) => path.join(path.dirname(storePath), p);
const resolveFromService = (p) => path.join(path.dirname(servicePath), p);

const fakeDb = new FakeSupabaseClient({
  uniqueConstraints: {
    support_conversations: [['appointment_id']],
    support_chat_messages: [['conversation_id', 'provider_message_id'], ['conversation_id', 'client_message_id']]
  }
});

stub(resolveFromStore('../config/supabase'), {
  isSupabaseConfigured: () => true,
  getSupabase: () => fakeDb
});

// Stub de atendimentos.store: resolve telefone do paciente sem tocar na
// lógica real de resolução de tabela (fora do escopo desta etapa; aqui só
// precisamos de um retorno determinístico de paciente_telefone por appointment_id).
const atendimentosFixture = {
  'appt-send-1': { id: 'appt-send-1', paciente_telefone: '5511999990001', paciente_nome: 'Paciente Um' },
  'appt-send-no-phone': { id: 'appt-send-no-phone', paciente_telefone: null, paciente_nome: 'Paciente Sem Telefone' }
};
stub(resolveFromService('../store/atendimentos.store'), {
  getAtendimento: async (id) => atendimentosFixture[id] || null
});

// Stub do provider Meta: nunca faz fetch real. Controlável via
// metaProviderState para simular sucesso/falha por teste.
const metaProviderState = { mode: 'success', calls: [] };
stub(resolveFromService('./providers/meta.provider'), {
  sendTextMessage: async ({ to, text, correlationId, idempotencyKey }) => {
    metaProviderState.calls.push({ to, text, correlationId, idempotencyKey });
    if (metaProviderState.mode === 'fail') {
      const error = new Error('Falha simulada da Graph API (sem rede real)');
      error.code = 'PROVIDER_ERROR_SIMULATED';
      throw error;
    }
    return { provider: 'meta', providerMessageId: `wamid-sim-${metaProviderState.calls.length}`, providerStatus: 'sent', raw: {} };
  }
});

const service = require(servicePath);
const store = require(storePath);

const results = {};

async function main() {
  // Seed: conversation 1 — base para idempotência/sucesso.
  const seed1 = await store.ensureConversationForAppointment({ appointmentId: 'appt-send-1', patientId: 'pat-1' });
  const conversationId = seed1.conversation.id;

  // 1) Sem lock algum (locked_by null) -> not_locked, provider NUNCA chamado.
  {
    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId,
      actorId: 'agente-A',
      text: 'Olá, tudo bem?',
      clientMessageId: 'client-msg-no-lock'
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'not_locked');
    assert.equal(metaProviderState.calls.length, before);
    results.semLockNuncaChamaProvider = 'ok';
  }

  // Dá o lock para agente-A antes dos próximos testes.
  await store.claimConversation({ conversationId, actorId: 'agente-A' });

  // 2) Lock de outro ator (agente-B) -> not_locked, provider NUNCA chamado.
  {
    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId,
      actorId: 'agente-B',
      text: 'Tentando enviar sem posse',
      clientMessageId: 'client-msg-wrong-owner'
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'not_locked');
    assert.equal(metaProviderState.calls.length, before);
    results.lockDeOutroAtorNuncaChamaProvider = 'ok';
  }

  // 3) Fora da janela de 24h (conversation nunca recebeu inbound) ->
  //    window_expired, provider NUNCA chamado.
  {
    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId,
      actorId: 'agente-A',
      text: 'Fora da janela',
      clientMessageId: 'client-msg-fora-janela'
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'window_expired');
    assert.equal(result.windowStatus.withinWindow, false);
    assert.equal(metaProviderState.calls.length, before);
    results.foraDaJanela24hNuncaChamaProvider = 'ok';
  }

  // Simula inbound recente do paciente -> abre a janela de 24h.
  await store.recordMessage({ conversationId, direction: 'inbound', body: 'oi', sender: 'patient' });

  // 4) Sucesso: dentro da janela, lock correto -> provider chamado uma vez,
  //    mensagem persistida como outbound com provider_message_id, evento
  //    MESSAGE_SENT gravado, last_message_at/status atualizados.
  {
    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId,
      actorId: 'agente-A',
      text: 'Olá! Como posso ajudar?',
      clientMessageId: 'client-msg-sucesso-1'
    });
    assert.equal(result.sent, true);
    assert.equal(result.duplicate, false);
    assert.equal(metaProviderState.calls.length, before + 1);
    assert.equal(result.message.direction, 'outbound');
    assert.ok(result.message.provider_message_id);
    assert.equal(result.message.client_message_id, 'client-msg-sucesso-1');

    const conversation = await store.getConversationById(conversationId);
    assert.equal(conversation.status, 'awaiting_patient');
    assert.equal(conversation.last_message_at, result.message.created_at);

    const events = fakeDb.rows('support_conversation_events').filter(
      (e) => e.conversation_id === conversationId && e.event_type === 'message_sent'
    );
    assert.ok(events.some((e) => e.payload.client_message_id === 'client-msg-sucesso-1'));
    results.envioComSucessoPersisteGravaEventoEAtualizaConversation = 'ok';
  }

  // 5) Replay idempotente: mesmo client_message_id de novo -> sent:true,
  //    duplicate:true, provider NUNCA chamado de novo (nunca duplica envio).
  {
    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId,
      actorId: 'agente-A',
      text: 'Olá! Como posso ajudar?',
      clientMessageId: 'client-msg-sucesso-1'
    });
    assert.equal(result.sent, true);
    assert.equal(result.duplicate, true);
    assert.equal(metaProviderState.calls.length, before);
    results.replayComMesmoClientMessageIdNuncaChamaProviderDeNovo = 'ok';
  }

  // 6) Replay idempotente mesmo sem o lock mais (ex.: lock expirou/foi
  //    liberado entre o envio original e o retry de rede do cliente) ainda
  //    devolve o resultado já persistido, sem exigir posse de novo.
  {
    await store.releaseConversation({ conversationId, actorId: 'agente-A' });
    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId,
      actorId: 'agente-A',
      text: 'Olá! Como posso ajudar?',
      clientMessageId: 'client-msg-sucesso-1'
    });
    assert.equal(result.sent, true);
    assert.equal(result.duplicate, true);
    assert.equal(metaProviderState.calls.length, before);
    results.replayIdempotenteFuncionaMesmoSemLockAtual = 'ok';
  }

  // Retoma o lock para os próximos testes.
  await store.claimConversation({ conversationId, actorId: 'agente-A' });

  // 7) Falha do provider: NÃO cria mensagem em support_chat_messages, NÃO
  //    altera last_message_at/status da conversation, grava MESSAGE_FAILED,
  //    e propaga erro com statusCode 502 para a rota tratar.
  {
    metaProviderState.mode = 'fail';
    const messagesBefore = fakeDb.rows('support_chat_messages').length;
    const conversationBefore = await store.getConversationById(conversationId);

    let threw = null;
    try {
      await service.sendHumanMessage({
        conversationId,
        actorId: 'agente-A',
        text: 'Essa vai falhar',
        clientMessageId: 'client-msg-falha-1'
      });
    } catch (error) {
      threw = error;
    }

    assert.ok(threw, 'deveria ter lançado erro de provider');
    assert.equal(threw.statusCode, 502);
    assert.equal(fakeDb.rows('support_chat_messages').length, messagesBefore);

    const conversationAfter = await store.getConversationById(conversationId);
    assert.equal(conversationAfter.last_message_at, conversationBefore.last_message_at);
    assert.equal(conversationAfter.status, conversationBefore.status);

    const failedEvents = fakeDb.rows('support_conversation_events').filter(
      (e) => e.conversation_id === conversationId && e.event_type === 'message_failed'
    );
    assert.ok(failedEvents.some((e) => e.payload.client_message_id === 'client-msg-falha-1'));
    results.falhaDoProviderNuncaCriaMensagemNemAlteraConversationSoGravaEventoDeFalha = 'ok';

    metaProviderState.mode = 'success';
  }

  // 8) conversationId inexistente -> not_found, provider NUNCA chamado.
  {
    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId: 'conversation-inexistente',
      actorId: 'agente-A',
      text: 'oi',
      clientMessageId: 'client-msg-not-found'
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'not_found');
    assert.equal(metaProviderState.calls.length, before);
    results.conversationInexistenteNuncaChamaProvider = 'ok';
  }

  // 9) Conversation encerrada -> closed, provider NUNCA chamado.
  {
    const seedClosed = await store.ensureConversationForAppointment({ appointmentId: 'appt-send-closed', patientId: 'pat-2' });
    await store.claimConversation({ conversationId: seedClosed.conversation.id, actorId: 'agente-A' });
    await store.closeConversation({ conversationId: seedClosed.conversation.id, actorId: 'agente-A' });

    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId: seedClosed.conversation.id,
      actorId: 'agente-A',
      text: 'oi',
      clientMessageId: 'client-msg-closed'
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'closed');
    assert.equal(metaProviderState.calls.length, before);
    results.conversationEncerradaNuncaChamaProvider = 'ok';
  }

  // 10) Telefone do paciente ausente -> missing_patient_phone, provider
  //     NUNCA chamado.
  {
    const seedNoPhone = await store.ensureConversationForAppointment({ appointmentId: 'appt-send-no-phone', patientId: 'pat-3' });
    await store.claimConversation({ conversationId: seedNoPhone.conversation.id, actorId: 'agente-A' });
    await store.recordMessage({ conversationId: seedNoPhone.conversation.id, direction: 'inbound', body: 'oi', sender: 'patient' });

    const before = metaProviderState.calls.length;
    const result = await service.sendHumanMessage({
      conversationId: seedNoPhone.conversation.id,
      actorId: 'agente-A',
      text: 'oi',
      clientMessageId: 'client-msg-sem-telefone'
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'missing_patient_phone');
    assert.equal(metaProviderState.calls.length, before);
    results.telefoneAusenteNuncaChamaProvider = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
