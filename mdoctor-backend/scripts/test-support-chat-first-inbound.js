// Correção de 24/10/2026 — achado real em produção (appointment_id
// 131513b8-235c-422b-babf-e133d5e1e62e): a PRÓPRIA mensagem que dispara a
// abertura de um ticket de suporte ("2", ou qualquer gatilho de
// createWhatsAppSupportEntry) nunca era gravada em support_chat_messages —
// só ensureConversation() rodava, nunca recordInboundMessage(). A
// conversation nascia com 0 mensagens, last_inbound_at nulo, "Nenhuma
// mensagem ainda" no painel, e a janela de 24h aparecia fechada mesmo o
// paciente tendo acabado de escrever.
//
// Causa raiz: createWhatsAppSupportEntry() nunca recebia o texto/
// providerMessageId da mensagem que a disparou — só ensureConversation()
// (que só garante a linha de support_conversations, nunca grava mensagem).
//
// Este arquivo testa a cadeia REAL e completa: whatsapp-support.service.js
// (não mockado) -> support-chat.service.js (não mockado) ->
// support-chat.store.js (não mockado) -> FakeSupabaseClient. Só
// atendimentos.store é um fake em memória (mesmo padrão de
// test-support-chat-inbound-integration.js) — não precisamos de um banco
// real pra appointments aqui, só exercitar a cadeia de suporte de verdade.
const assert = require('assert');
const path = require('path');
const { FakeSupabaseClient } = require('./_fakes/fake-supabase-client');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const supportServicePath = path.join(__dirname, '..', 'src', 'services', 'whatsapp-support.service.js');
const resolveFrom = (p) => path.join(path.dirname(supportServicePath), p);

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

// Chamamos support-chat.service.js de verdade (não mockado) — precisa das
// 3 flags ligadas, mesma técnica de test-support-chat-service.js.
process.env.SUPPORT_CHAT_CAPTURE_ENABLED = 'true';
process.env.SUPPORT_CHAT_AGENT_SEND_ENABLED = 'false';
process.env.SUPPORT_CHAT_UI_ENABLED = 'false';

// atendimentos.store: fake em memória real (cria/busca/atualiza de verdade),
// mesma técnica de test-support-chat-inbound-integration.js.
let atendimentos = [];
let nextAtendimentoId = 1;
stub(resolveFrom('../store/atendimentos.store'), {
  STATUS: { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento', REJECTED: 'rejected' },
  createAtendimento: async (row) => {
    const created = { id: `atd-mock-${nextAtendimentoId++}`, ...row };
    atendimentos.push(created);
    return created;
  },
  listAtendimentos: async () => atendimentos,
  getAtendimento: async (id) => atendimentos.find((a) => a.id === id) || null,
  updateAtendimentoStatus: async (id, status, patch = {}) => {
    const existing = atendimentos.find((a) => a.id === id);
    if (!existing) return null;
    Object.assign(existing, patch, { status });
    return existing;
  }
});
stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
stub(resolveFrom('./clinical-persistence.service'), { recordSupportTicket: async () => {} });
stub(resolveFrom('./admin-alert.service'), { notifyAdminAlert: () => {} });

const support = require(supportServicePath);
const supportChatStore = require(resolveFrom('../store/support-chat.store'));

const PHONE = '5511977770040';
const results = {};

async function main() {
  // 1) CENÁRIO CRÍTICO: nenhum ticket/conversation de suporte aberto ainda —
  //    paciente manda "2" — a MESMA mensagem que cria o suporte precisa
  //    ficar persistida como inbound na conversation recém-criada.
  {
    atendimentos = [];
    const providerMessageId = 'wamid-primeiro-inbound-001';
    const result = await support.createWhatsAppSupportEntry({
      phone: PHONE,
      text: 'preciso de ajuda com minha receita',
      messageId: providerMessageId
    });
    assert.equal(result.duplicate, false);
    assert.ok(result.atendimento?.id, 'deveria ter criado um atendimento novo');

    const conversation = await supportChatStore.getConversationByAppointmentId(result.atendimento.id);
    assert.ok(conversation, 'conversation deveria existir pra esse appointment');

    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 1, 'message_count deveria ser 1 — a própria mensagem que abriu o suporte');
    assert.equal(messages[0].direction, 'inbound');
    assert.equal(messages[0].provider_message_id, providerMessageId, 'provider_message_id deve ser preservado');
    assert.equal(messages[0].body, 'preciso de ajuda com minha receita');
    assert.equal(messages[0].sender, 'patient');

    const inboundCount = messages.filter((m) => m.direction === 'inbound').length;
    assert.equal(inboundCount, 1);

    assert.ok(conversation.last_inbound_at, 'last_inbound_at deveria estar preenchido');
    assert.ok(conversation.last_message_at, 'last_message_at deveria estar preenchido');
    assert.equal(conversation.status, 'awaiting_agent', 'conversation deve virar awaiting_agent (última mensagem foi do paciente)');

    results.primeiroInboundQueDisparaOSuporteFicaPersistido = 'ok';
  }

  // 2) JANELA DE 24H: com last_inbound_at preenchido desde a criação, a
  //    janela calculada pelo backend deve estar ABERTA imediatamente — não
  //    "Janela de 24h encerrada" logo após a conversation nascer.
  {
    const conversation = await supportChatStore.getConversationByAppointmentId(atendimentos[0].id);
    const service = require(resolveFrom('./support-chat.service'));
    const windowStatus = service.getMessagingWindowStatus(conversation);
    assert.equal(windowStatus.withinWindow, true, 'janela deve estar aberta logo após o primeiro inbound real');
    assert.equal(windowStatus.requiresTemplate, false);
    results.janelaDe24hAbreImediatamenteAposOPrimeiroInbound = 'ok';
  }

  // 3) INBOUND SUBSEQUENTE: com a conversation já existindo, a mensagem
  //    seguinte continua sendo registrada normalmente, e last_inbound_at/
  //    last_message_at avançam.
  {
    const appointmentId = atendimentos[0].id;
    const conversationBefore = await supportChatStore.getConversationByAppointmentId(appointmentId);
    // FakeSupabaseClient muta a linha em memória (Object.assign) e
    // select()/getConversationByAppointmentId() devolvem a MESMA referência
    // — captura o valor (string, por valor) ANTES do segundo inbound, nunca
    // o objeto, senão "antes" e "depois" acabam sendo o mesmo objeto.
    const lastInboundBefore = conversationBefore.last_inbound_at;
    await new Promise((r) => setTimeout(r, 5));
    const { recordInboundMessage } = require(resolveFrom('./support-chat.service'));
    await recordInboundMessage({
      appointmentId,
      body: 'ainda estou esperando',
      providerMessageId: 'wamid-segundo-inbound-002',
      sender: 'patient'
    });
    const conversationAfter = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const messages = await supportChatStore.listMessages(conversationAfter.id);
    assert.equal(messages.length, 2, 'segunda mensagem real deve somar ao histórico, não substituir');
    assert.notEqual(conversationAfter.last_inbound_at, lastInboundBefore, 'last_inbound_at deve avançar no segundo inbound');
    results.inboundSubsequenteContinuaRegistrandoEAvancandoTimestamps = 'ok';
  }

  // 4) IDEMPOTÊNCIA META: reentrega do MESMO webhook (mesmo
  //    provider_message_id) pro atendimento JÁ criado não pode duplicar
  //    support_chat_messages, nem criar segunda conversation/ticket, nem
  //    alterar timestamps.
  {
    atendimentos = [];
    const providerMessageId = 'wamid-idempotente-003';
    const first = await support.createWhatsAppSupportEntry({ phone: '5511977770041', text: '2', messageId: providerMessageId });
    const conversation1 = await supportChatStore.getConversationByAppointmentId(first.atendimento.id);
    const messagesAfterFirst = await supportChatStore.listMessages(conversation1.id);
    assert.equal(messagesAfterFirst.length, 1);
    const lastInboundAfterFirst = conversation1.last_inbound_at;

    // Reentrega do MESMO webhook: a camada de roteamento real já teria
    // findOpenSupportByPhone encontrando o ticket aberto e retornando
    // duplicate:true ANTES de chegar aqui — mas testamos a chamada direta
    // também, pra garantir que mesmo se reexecutada não duplica nada.
    const retry = await support.createWhatsAppSupportEntry({ phone: '5511977770041', text: '2', messageId: providerMessageId });
    assert.equal(retry.duplicate, true, 'reentrega deve ser reconhecida como duplicate no nível do atendimento');
    assert.equal(atendimentos.length, 1, 'não pode criar um segundo atendimento/ticket');

    const conversation2 = await supportChatStore.getConversationByAppointmentId(first.atendimento.id);
    assert.equal(conversation2.id, conversation1.id, 'não pode criar uma segunda conversation');
    const messagesAfterRetry = await supportChatStore.listMessages(conversation2.id);
    assert.equal(messagesAfterRetry.length, 1, 'message_count deve continuar 1 após a reentrega');
    assert.equal(conversation2.last_inbound_at, lastInboundAfterFirst, 'reentrega não pode alterar last_inbound_at');
    results.reentregaDoMesmoWebhookNuncaDuplicaMensagemConversationOuTicket = 'ok';
  }

  // 5) Mesmo provider_message_id chamando recordMessage diretamente (nível
  //    mais baixo, sem passar pelo guard de findOpenSupportByPhone) também
  //    nunca duplica — segunda camada de proteção já existente, reconfirmada
  //    aqui no caminho do primeiro inbound.
  {
    atendimentos = [];
    const providerMessageId = 'wamid-idempotente-direto-004';
    const result = await support.createWhatsAppSupportEntry({ phone: '5511977770042', text: '2', messageId: providerMessageId });
    const conversation = await supportChatStore.getConversationByAppointmentId(result.atendimento.id);
    const direct = await supportChatStore.recordMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      body: '2',
      sender: 'patient',
      providerMessageId
    });
    assert.equal(direct.duplicate, true, 'recordMessage direto com o mesmo provider_message_id deve ser reconhecido como duplicado');
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 1);
    results.protecaoDeIdempotenciaNoNivelDeRecordMessageTambemFunciona = 'ok';
  }

  // 6) Falha ao gravar o primeiro inbound (ex.: Supabase indisponível) nunca
  //    impede a criação do ticket nem a resposta ao paciente — mesma
  //    garantia best-effort já usada em toda a integração de suporte.
  {
    atendimentos = [];
    const original = fakeDb._execute.bind(fakeDb);
    let callCount = 0;
    fakeDb._execute = (builder) => {
      callCount++;
      // Deixa passar as chamadas de criação do appointment/ticket
      // (atendimentos.store é fake em memória, nunca chama fakeDb) — só
      // quebra quando o support-chat.store tentar gravar.
      throw new Error('falha simulada de Supabase ao gravar o primeiro inbound');
    };
    try {
      const result = await support.createWhatsAppSupportEntry({ phone: '5511977770043', text: '2', messageId: 'wamid-falha-005' });
      assert.equal(result.duplicate, false);
      assert.ok(result.atendimento?.id, 'ticket deve ser criado mesmo se a gravação do inbound falhar');
      assert.equal(result.reply, support.SUPPORT_WAITING_TEXT, 'paciente continua recebendo a resposta normal mesmo com falha na gravação');
      results.falhaAoGravarOPrimeiroInboundNuncaImpedeACriacaoDoTicket = 'ok';
    } finally {
      fakeDb._execute = original;
    }
  }

  // 7) CRIAÇÃO CONCORRENTE: duas chamadas simultâneas pedindo suporte pro
  //    MESMO telefone, sem nenhum ticket aberto ainda. Documenta o
  //    comportamento real (não finge uma proteção atômica que não existe
  //    neste nível — findOpenSupportByPhone não é uma claim atômica): nenhum
  //    dos dois inbounds é perdido, e cada atendimento criado tem seu
  //    próprio inbound persistido corretamente — sem duplicidade DESTRUTIVA
  //    (perda de dado, corrupção, mensagem fantasma).
  {
    atendimentos = [];
    const [r1, r2] = await Promise.all([
      support.createWhatsAppSupportEntry({ phone: '5511977770044', text: '2', messageId: 'wamid-concorrente-a' }),
      support.createWhatsAppSupportEntry({ phone: '5511977770044', text: '2', messageId: 'wamid-concorrente-b' })
    ]);
    // Pelo menos um dos dois registrou normalmente; nenhum dos dois perdeu a
    // própria mensagem que o criou.
    for (const r of [r1, r2]) {
      if (r.duplicate) continue;
      const conv = await supportChatStore.getConversationByAppointmentId(r.atendimento.id);
      const msgs = await supportChatStore.listMessages(conv.id);
      assert.ok(msgs.length >= 1, 'nenhum inbound concorrente pode ser perdido silenciosamente');
    }
    results.criacaoConcorrenteNuncaPerdeNenhumDosDoisInboundsSemCorrupcao = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
