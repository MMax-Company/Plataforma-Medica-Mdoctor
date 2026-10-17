// ETAPA 2 (serviço) — testes offline do support-chat.service.js: gravação
// de inbound atrás da flag de captura, idempotência, criação/obtenção
// determinística da conversation, independência entre as 3 feature flags e
// "falha nunca bloqueia o chamador". Mesma técnica de stub por require.cache
// de ETAPA 1 (scripts/test-support-chat-foundation.js), sem rede/banco real.
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

// As 3 flags são independentes entre si (pedido explícito do usuário,
// 10/10/2026) — nenhuma delas liga/afeta o comportamento das outras duas.
function setFlags({ capture = false, agentSend = false, ui = false } = {}) {
  process.env.SUPPORT_CHAT_CAPTURE_ENABLED = capture ? 'true' : 'false';
  process.env.SUPPORT_CHAT_AGENT_SEND_ENABLED = agentSend ? 'true' : 'false';
  process.env.SUPPORT_CHAT_UI_ENABLED = ui ? 'true' : 'false';
}

const results = {};

async function main() {
  // 1) Flag de captura desligada por padrão: recordInboundMessage é um
  //    no-op total — nenhuma chamada ao "banco" acontece, comportamento
  //    idêntico a nunca ter sido chamado.
  {
    setFlags({ capture: false });
    const before = executeCalls;
    const result = await service.recordInboundMessage({ appointmentId: 'appt-flag-off', body: 'oi' });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'disabled');
    assert.equal(executeCalls, before);
    results.flagDeCapturaDesligadaNaoTocaNoBanco = 'ok';
  }

  // 1b) UI_ENABLED e AGENT_SEND_ENABLED ligadas, mas CAPTURE_ENABLED
  //     desligada: inbound continua bloqueado — prova que as 3 flags são
  //     independentes, nenhuma "libera" a captura por tabela.
  {
    setFlags({ capture: false, agentSend: true, ui: true });
    const before = executeCalls;
    const result = await service.recordInboundMessage({ appointmentId: 'appt-flag-partial', body: 'oi' });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'disabled');
    assert.equal(executeCalls, before);
    assert.equal(service.isUiAvailable(), true);
    results.flagsSaoIndependentesUiLigadaNaoLiberaCaptura = 'ok';
  }

  // 2) Com CAPTURE_ENABLED ligada: grava, cria a conversation
  //    deterministicamente (uma por appointment) e não duplica.
  {
    setFlags({ capture: true });
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
    setFlags({ capture: true });
    const result = await service.recordInboundMessage({ body: 'sem appointmentId' });
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'invalid_input');
    results.appointmentIdAusenteNuncaLanca = 'ok';
  }

  // 6) getMessagingWindowStatus do serviço é um passthrough puro do store —
  //    nenhuma chamada ao "banco" para calcular o estado da janela.
  {
    setFlags({ capture: true });
    const before = executeCalls;
    const status = service.getMessagingWindowStatus({ last_inbound_at: null });
    assert.equal(status.withinWindow, false);
    assert.equal(executeCalls, before);
    results.getMessagingWindowStatusEhPassthroughSemTocarBanco = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
