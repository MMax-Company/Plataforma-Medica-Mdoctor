// ETAPA 2 (serviço) — testes offline do support-chat.service.js: gravação
// de inbound atrás das feature flags, idempotência, criação/obtenção
// determinística da conversation e "falha nunca bloqueia o chamador".
// Mesma técnica de stub por require.cache de ETAPA 1
// (scripts/test-support-chat-foundation.js), sem rede/banco real.
const assert = require('assert');
const path = require('path');
const { FakeSupabaseClient } = require('./_fakes/fake-supabase-client');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const servicePath = path.join(__dirname, '..', 'src', 'services', 'support-chat.service.js');
const storePath = path.join(__dirname, '..', 'src', 'store', 'support-chat.store.js');
const resolveFrom = (p) => path.join(path.dirname(storePath), p);

const fakeDb = new FakeSupabaseClient({
  uniqueConstraints: {
    support_conversations: [['appointment_id']],
    support_chat_messages: [['conversation_id', 'provider_message_id'], ['conversation_id', 'client_message_id']]
  }
});

let executeCalls = 0;
const originalExecute = fakeDb._execute.bind(fakeDb);
fakeDb._execute = (builder) => {
  executeCalls += 1;
  return originalExecute(builder);
};

stub(resolveFrom('../config/supabase'), {
  isSupabaseConfigured: () => true,
  getSupabase: () => fakeDb
});

const service = require(servicePath);

function setFlags({ enabled = false, read = false, send = false } = {}) {
  process.env.SUPPORT_CHAT_ENABLED = enabled ? 'true' : 'false';
  process.env.SUPPORT_CHAT_READ_ENABLED = read ? 'true' : 'false';
  process.env.SUPPORT_CHAT_SEND_ENABLED = send ? 'true' : 'false';
}

const results = {};

async function main() {
  // 1) Flags desligadas por padrão: recordInboundMessage é um no-op total —
  //    nenhuma chamada ao "banco" acontece, comportamento idêntico a nunca
  //    ter sido chamado.
  {
    setFlags({ enabled: false, read: false });
    const before = executeCalls;
    const result = await service.recordInboundMessage({ appointmentId: 'appt-flag-off', body: 'oi' });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'disabled');
    assert.equal(executeCalls, before);
    results.flagsDesligadasNaoTocamNoBanco = 'ok';
  }

  // 1b) Só SUPPORT_CHAT_ENABLED ligado (sem READ_ENABLED) ainda é no-op —
  //     confirma que a captura exige as duas flags, não só a master switch.
  {
    setFlags({ enabled: true, read: false });
    const before = executeCalls;
    const result = await service.recordInboundMessage({ appointmentId: 'appt-flag-partial', body: 'oi' });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'disabled');
    assert.equal(executeCalls, before);
    results.somenteMasterSwitchAindaBloqueiaInbound = 'ok';
  }

  // 2) Com as duas flags ligadas: grava, cria a conversation
  //    deterministicamente (uma por appointment) e não duplica.
  {
    setFlags({ enabled: true, read: true });
    const r1 = await service.recordInboundMessage({
      appointmentId: 'appt-inbound-1',
      patientId: 'pat-1',
      body: 'primeira mensagem',
      providerMessageId: 'wamid-inbound-1'
    });
    assert.equal(r1.recorded, true);
    assert.equal(r1.duplicate, false);

    const r2 = await service.recordInboundMessage({
      appointmentId: 'appt-inbound-1',
      patientId: 'pat-1',
      body: 'segunda mensagem, outro provider id',
      providerMessageId: 'wamid-inbound-2'
    });
    assert.equal(r2.recorded, true);
    assert.equal(r2.conversationId, r1.conversationId);

    assert.equal(fakeDb.rows('support_conversations').filter((c) => c.appointment_id === 'appt-inbound-1').length, 1);
    results.capturaCriaConversationDeterministicaSemDuplicar = 'ok';
  }

  // 3) Reentrega do mesmo provider_message_id (retry/reenvio do webhook) é
  //    idempotente: recorded:true, duplicate:true, nenhuma linha nova.
  {
    const before = fakeDb.rows('support_chat_messages').length;
    const result = await service.recordInboundMessage({
      appointmentId: 'appt-inbound-1',
      patientId: 'pat-1',
      body: 'reentrega da primeira mensagem',
      providerMessageId: 'wamid-inbound-1'
    });
    assert.equal(result.recorded, true);
    assert.equal(result.duplicate, true);
    assert.equal(fakeDb.rows('support_chat_messages').length, before);
    results.reentregaDoMesmoProviderMessageIdEhIdempotente = 'ok';
  }

  // 4) Falha de persistência nunca propaga para quem chamou — fica só no
  //    log estruturado (ver stdout desta execução, mensagem
  //    support_chat_inbound_record_failed).
  {
    fakeDb.failNextInsert('support_chat_messages');
    const result = await service.recordInboundMessage({
      appointmentId: 'appt-inbound-1',
      patientId: 'pat-1',
      body: 'mensagem que vai falhar ao inserir',
      providerMessageId: 'wamid-inbound-falha'
    });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'error');
    results.falhaDePersistenciaNuncaPropagaParaOChamador = 'ok';
  }

  // 5) appointmentId ausente é tratado sem lançar (entrada inválida nunca
  //    derruba o chamador).
  {
    setFlags({ enabled: true, read: true });
    const result = await service.recordInboundMessage({ body: 'sem appointmentId' });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'invalid_input');
    results.appointmentIdAusenteNuncaLanca = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
