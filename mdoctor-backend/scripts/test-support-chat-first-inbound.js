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

// whatsapp-sessions.store: fake mínimo (mesmo padrão de
// test-support-chat-inbound-integration.js) — necessário pra exercitar
// resolveMetaInboundRouting() de verdade (opções "2"/"3" reais, não só
// createWhatsAppSupportEntry isolado). post-delivery-survey.service NÃO é
// mockado aqui (handleSurveyInbound é real) — isSurveyEnabled() sem
// POST_DELIVERY_SURVEY_ENABLED retorna false e curto-circuita antes de
// tocar qualquer store, então é seguro deixar real sem stub adicional.
const sessionsByPhone = new Map();
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  getActiveSurveySession: () => null,
  getSessionByPhone: async (phone) => sessionsByPhone.get(phone) || null,
  upsertSessionMetadata: async ({ phone, metadataPatch = {} }) => {
    const existing = sessionsByPhone.get(phone) || { id: `sess-${phone}`, typebot_session_id: null, metadata: {} };
    const merged = { ...existing, metadata: { ...(existing.metadata || {}), ...metadataPatch } };
    sessionsByPhone.set(phone, merged);
    return merged;
  },
  clearTypebotSession: async () => {},
  clearSurveySession: async () => {}
});

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
    // findOpenSupportByPhone() NÃO é uma claim atômica — não há lock/
    // constraint única em appointments.paciente_telefone impedindo duas
    // criações concorrentes pro mesmo telefone quando nenhuma delas ainda
    // commitou no momento em que a outra checou. Documentamos o
    // comportamento real, sem fingir uma garantia que não existe: pode
    // nascer 1 OU 2 atendimentos (risco pré-existente, não introduzido nem
    // corrigido por este PR — ver relatório). O que ESTE fix garante,
    // independente de 1 ou 2 terem nascido, é que nenhum dos inbounds reais
    // se perde nem corrompe silenciosamente.
    const createdCount = [r1, r2].filter((r) => !r.duplicate).length;
    assert.ok(createdCount === 1 || createdCount === 2, `esperado 1 ou 2 atendimentos criados na corrida, obteve ${createdCount}`);
    for (const r of [r1, r2]) {
      if (r.duplicate) continue;
      const conv = await supportChatStore.getConversationByAppointmentId(r.atendimento.id);
      const msgs = await supportChatStore.listMessages(conv.id);
      assert.equal(msgs.length, 1, 'nenhum inbound concorrente pode ser perdido nem duplicado dentro do seu próprio atendimento');
      assert.equal(msgs[0].direction, 'inbound');
    }
    results[`criacaoConcorrentePreservaTodosOsInboundsReais_${createdCount}AtendimentoCriados`] = 'ok (comportamento real documentado, não uma garantia de deduplicação atômica)';
  }

  // =====================================================================
  // CENÁRIOS A-G — pedido explícito de 24/10/2026: validar separadamente
  // os DOIS caminhos reais de abertura (opção "2" no início do chatbot, e
  // opção "3" pós-entrega da receita), através do ponto de entrada público
  // real (resolveMetaInboundRouting), não só da função interna
  // createWhatsAppSupportEntry — mesma garantia, mas testada a partir de
  // onde o webhook da Meta realmente entra.
  // =====================================================================

  // A) Opção "2" no início do chatbot: paciente sem sessão prévia, sem
  //    Typebot ativo, sem ticket de suporte aberto, sem pendência de
  //    rejeição — envia "2" e cai no menu inicial de fato (branch final de
  //    resolveMetaInboundRouting, textNorm === '2', sem nenhum estado
  //    especial de sessão). A PRÓPRIA mensagem "2" deve ficar persistida.
  {
    atendimentos = [];
    sessionsByPhone.clear();
    const phone = '5511977770050';
    const providerMessageId = 'wamid-opcao2-inicial-A';
    const result = await support.resolveMetaInboundRouting({ phone, text: '2', messageId: providerMessageId });
    assert.equal(result.action, 'reply');
    assert.equal(atendimentos.length, 1, 'opção 2 inicial deve criar exatamente 1 atendimento de suporte');

    const conversation = await supportChatStore.getConversationByAppointmentId(atendimentos[0].id);
    assert.ok(conversation, 'conversation deveria existir');
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 1, 'message_count deve ser 1');
    assert.equal(messages.filter((m) => m.direction === 'inbound').length, 1, 'inbound_count deve ser 1');
    assert.equal(messages[0].body, '2');
    assert.equal(messages[0].direction, 'inbound');
    assert.equal(messages[0].sender, 'patient');
    assert.equal(messages[0].provider_message_id, providerMessageId, 'provider_message_id deve ser preservado');
    assert.ok(conversation.last_inbound_at, 'last_inbound_at deve estar preenchido');
    assert.ok(conversation.last_message_at, 'last_message_at deve estar preenchido');

    const { getMessagingWindowStatus } = require(resolveFrom('./support-chat.service'));
    const windowStatus = getMessagingWindowStatus(conversation);
    assert.equal(windowStatus.withinWindow, true, 'janela de 24h deve estar aberta imediatamente após a opção 2');

    results.A_opcao2InicialPersisteOPrimeiroInboundComJanelaAberta = 'ok';
  }

  // C) Retry da opção "2" com o MESMO provider_message_id: NO-OP INTEGRAL —
  //    não pode duplicar mensagem, nem criar segundo ticket/conversation,
  //    nem alterar timestamps, nem executar handleSupportQueueInput (a
  //    resposta nem pode ser recalculada; o retorno precisa se identificar
  //    como duplicate).
  {
    const phone = '5511977770050'; // mesmo telefone do cenário A — ticket já aberto
    const providerMessageId = 'wamid-opcao2-inicial-A'; // mesmo provider_message_id
    const conversationBefore = await supportChatStore.getConversationByAppointmentId(atendimentos[0].id);
    const atendimentoBefore = atendimentos.find((a) => a.id === atendimentos[0].id);
    const lastInboundBefore = conversationBefore.last_inbound_at;
    const subStatusBefore = atendimentoBefore.dados_clinicos?.support_sub_status;

    const retry = await support.resolveMetaInboundRouting({ phone, text: '2', messageId: providerMessageId });
    assert.equal(retry.duplicate, true, 'retry precisa se identificar como duplicate');
    assert.equal(retry.action, 'noop', 'retry não pode executar handleSupportQueueInput nem recalcular resposta');
    assert.equal(atendimentos.length, 1, 'retry não pode criar um segundo atendimento/ticket');

    const conversationAfter = await supportChatStore.getConversationByAppointmentId(atendimentos[0].id);
    assert.equal(conversationAfter.id, conversationBefore.id, 'retry não pode criar uma segunda conversation');
    assert.equal(conversationAfter.status, conversationBefore.status, 'retry não pode avançar status da conversation');
    const messages = await supportChatStore.listMessages(conversationAfter.id);
    assert.equal(messages.length, 1, 'retry não pode duplicar a mensagem');
    assert.equal(conversationAfter.last_inbound_at, lastInboundBefore, 'retry não pode alterar last_inbound_at');
    assert.equal(conversationAfter.last_message_at, conversationBefore.last_message_at, 'retry não pode alterar last_message_at');
    const atendimentoAfter = atendimentos.find((a) => a.id === atendimentoBefore.id);
    assert.equal(atendimentoAfter.dados_clinicos?.support_sub_status, subStatusBefore, 'retry não pode mudar support_sub_status nem fechar o ticket');

    results.C_retryDaOpcao2ComMesmoProviderMessageIdEhNoOpIntegral = 'ok';
  }

  // Appointment da opção 2 (telefone 050) precisa sobreviver aos próximos
  // `atendimentos = []` (cada bloco B/F reseta o fake pra isolar seu próprio
  // telefone) — capturado aqui, antes do reset, pra reuso em G.
  const appointmentIdOpcao2 = atendimentos[0].id;

  // B) Opção "3" pós-entrega da receita: diagSession.metadata.
  //    post_delivery_support_available = true (gravado por
  //    triggerPostDeliverySurvey quando uma receita é entregue via
  //    WhatsApp — ver comentário original em whatsapp-support.service.js).
  //    Esse foi o caminho que falhou no teste real de produção
  //    (appointment_id 131513b8...).
  let appointmentIdOpcao3;
  {
    atendimentos = [];
    const phone = '5511977770051';
    const providerMessageId = 'wamid-opcao3-posentrega-B';
    const sessionWithPostDelivery = {
      id: 'sess-pos-entrega-B',
      typebot_session_id: null,
      metadata: { post_delivery_support_available: true }
    };

    const result = await support.resolveMetaInboundRouting({
      phone,
      text: '3',
      session: sessionWithPostDelivery,
      messageId: providerMessageId
    });
    assert.equal(result.action, 'reply');
    assert.equal(atendimentos.length, 1, 'opção 3 pós-entrega deve criar exatamente 1 atendimento de suporte');
    appointmentIdOpcao3 = atendimentos[0].id;

    const conversation = await supportChatStore.getConversationByAppointmentId(appointmentIdOpcao3);
    assert.ok(conversation, 'conversation deveria existir');
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 1, 'message_count deve ser 1');
    assert.equal(messages.filter((m) => m.direction === 'inbound').length, 1, 'inbound_count deve ser 1');
    assert.equal(messages[0].body, '3');
    assert.equal(messages[0].direction, 'inbound');
    assert.equal(messages[0].sender, 'patient');
    assert.equal(messages[0].provider_message_id, providerMessageId, 'provider_message_id deve ser preservado');
    assert.ok(conversation.last_inbound_at, 'last_inbound_at deve estar preenchido');
    assert.ok(conversation.last_message_at, 'last_message_at deve estar preenchido');

    const { getMessagingWindowStatus } = require(resolveFrom('./support-chat.service'));
    const windowStatus = getMessagingWindowStatus(conversation);
    assert.equal(windowStatus.withinWindow, true, 'janela de 24h deve estar aberta imediatamente após a opção 3 — o caminho que falhou em produção');

    results.B_opcao3PosEntregaPersisteOPrimeiroInboundComJanelaAberta_caminhoQueFalhouEmProducao = 'ok';
  }

  // E) Inbound SUBSEQUENTE após a abertura via opção "3": mensagem seguinte
  //    do paciente continua sendo registrada normalmente, somando ao
  //    histórico (não substituindo), e os timestamps avançam. Roda ANTES de
  //    D por isolamento (D é o teste de retry, independente). Revisão de
  //    24/10/2026 (bug real de produção, PR de ownership): mensagem comum
  //    durante suporte ativo não dispara mais SUPPORT_WAITING_TEXT a cada
  //    mensagem — vira noop (já persistida acima; conversa é chat humano a
  //    partir daqui).
  {
    const conversationBefore = await supportChatStore.getConversationByAppointmentId(appointmentIdOpcao3);
    const lastInboundBefore = conversationBefore.last_inbound_at;
    await new Promise((r) => setTimeout(r, 5));

    const result = await support.resolveMetaInboundRouting({
      phone: '5511977770051',
      text: 'ainda preciso de ajuda',
      session: { id: 'sess-pos-entrega-B', typebot_session_id: null, metadata: {} },
      messageId: 'wamid-opcao3-subsequente-E'
    });
    assert.equal(result.action, 'noop', 'mensagem comum durante suporte ativo não repete aviso automático');

    const conversationAfter = await supportChatStore.getConversationByAppointmentId(appointmentIdOpcao3);
    const messages = await supportChatStore.listMessages(conversationAfter.id);
    assert.equal(messages.length, 2, 'segunda mensagem real deve somar ao histórico');
    assert.equal(messages.filter((m) => m.direction === 'inbound').length, 2);
    assert.notEqual(conversationAfter.last_inbound_at, lastInboundBefore, 'last_inbound_at deve avançar');
    results.E_inboundSubsequenteAposAberturaContinuaRegistrandoEAvancandoTimestamps = 'ok';
  }

  // D) Retry da opção "3" com o MESMO provider_message_id, DEPOIS que o
  //    estado já mudou (ticket passou de inexistente para WAITING — este é
  //    exatamente o "RETRY APÓS ESTADO MUDAR", o cenário crítico da
  //    correção de 24/10/2026, revisão pós-PR #101).
  //
  //    CAUSA TÉCNICA EXATA DA COLISÃO DO "3" (corrigida nesta revisão): "3"
  //    é overload. No menu pós-entrega ele significa "falar com o suporte"
  //    (abre o ticket). Mas dentro de um ticket já aberto/em atendimento,
  //    EXPLICIT_SUPPORT_COMMANDS trata "3" como "iniciar chatbot novamente"
  //    (handleSupportQueueInput, whatsapp-support.service.js ~linha 721).
  //    Antes da correção, a 2ª entrega do MESMO webhook via
  //    resolveMetaInboundRouting via o ticket JÁ aberto e reinterpretava o
  //    "3" retransmitido pelo NOVO estado — handleSupportQueueInput()
  //    fechava o próprio ticket que a 1ª entrega acabou de criar. O ponto
  //    exato onde isso era reinterpretado: a chamada a
  //    handleSupportQueueInput({phone, textNorm}) dentro do bloco
  //    `sub === WAITING || EM_ATENDIMENTO`, que rodava incondicionalmente
  //    depois de recordInboundMessage — sem nunca checar se aquele
  //    provider_message_id específico já tinha sido processado. A correção
  //    move esse corte para ANTES de handleSupportQueueInput (e antes de
  //    touchSupportInteraction): se recordInboundMessage() já vê esse
  //    provider_message_id como duplicate dentro da conversation, a função
  //    retorna { action: 'noop', duplicate: true } imediatamente — nenhum
  //    comando é reinterpretado, nenhum estado avança.
  {
    const providerMessageId = 'wamid-opcao3-posentrega-B';
    const conversationBefore = await supportChatStore.getConversationByAppointmentId(appointmentIdOpcao3);
    const atendimentoBefore = atendimentos.find((a) => a.id === appointmentIdOpcao3);
    const lastInboundBefore = conversationBefore.last_inbound_at;
    const lastMessageBefore = conversationBefore.last_message_at;
    const messagesBefore = await supportChatStore.listMessages(conversationBefore.id);
    const subStatusBefore = atendimentoBefore.dados_clinicos?.support_sub_status;
    const statusBefore = atendimentoBefore.status;

    const retry = await support.resolveMetaInboundRouting({
      phone: '5511977770051',
      text: '3',
      session: { id: 'sess-pos-entrega-B', typebot_session_id: null, metadata: {} },
      messageId: providerMessageId
    });

    // NO-OP INTEGRAL: nem persistência, nem efeito de negócio.
    assert.equal(retry.duplicate, true, 'retry precisa se identificar como duplicate');
    assert.equal(retry.action, 'noop', 'retry não pode executar handleSupportQueueInput nem reinterpretar o texto pelo novo estado');
    assert.equal(atendimentos.length, 1, 'retry não pode criar um segundo atendimento/ticket');

    const conversationAfter = await supportChatStore.getConversationByAppointmentId(appointmentIdOpcao3);
    assert.equal(conversationAfter.id, conversationBefore.id, 'retry não pode criar uma segunda conversation');
    const messagesAfter = await supportChatStore.listMessages(conversationAfter.id);
    assert.equal(messagesAfter.length, messagesBefore.length, 'retry não pode duplicar nem adicionar mensagem nova — mesmo provider_message_id');
    assert.equal(conversationAfter.last_inbound_at, lastInboundBefore, 'retry não pode alterar last_inbound_at');
    assert.equal(conversationAfter.last_message_at, lastMessageBefore, 'retry não pode alterar last_message_at');
    assert.equal(conversationAfter.status, conversationBefore.status, 'retry não pode avançar status da conversation');

    const atendimentoAfter = atendimentos.find((a) => a.id === appointmentIdOpcao3);
    assert.equal(atendimentoAfter.status, statusBefore, 'retry não pode mudar status do atendimento (não pode fechar)');
    assert.equal(atendimentoAfter.dados_clinicos?.support_sub_status, subStatusBefore, 'retry não pode mudar support_sub_status');
    assert.equal(atendimentoAfter.dados_clinicos?.support_closed_at, undefined, 'retry não pode gravar closed_at — ticket não foi fechado');
    assert.equal(atendimentoAfter.dados_clinicos?.support_closed_by, undefined, 'retry não pode gravar closed_by — ticket não foi fechado');

    results.D_retryDaOpcao3AposEstadoMudarEhNoOpIntegral_naoFechaMaisOTicket = 'ok';
  }

  // D2) Mesma garantia, explicitamente para a opção "2" (pedido explícito:
  //     "o mesmo princípio deve valer para a opção 2 inicial") — telefone
  //     isolado (053), ticket aberto e depois retry do MESMO
  //     provider_message_id.
  {
    // NÃO reseta `atendimentos` aqui — é o array compartilhado do fake, e os
    // cenários B/D/D3 (telefone 051) ainda dependem dele mais abaixo neste
    // mesmo arquivo. Isola este cenário só por contagem antes/depois e por
    // telefone (053) exclusivo.
    const countBefore = atendimentos.length;
    const phone = '5511977770053';
    const providerMessageId = 'wamid-opcao2-D2';
    const first = await support.resolveMetaInboundRouting({ phone, text: '2', messageId: providerMessageId });
    assert.equal(first.action, 'reply');
    assert.equal(atendimentos.length, countBefore + 1);
    const appointmentId = atendimentos[atendimentos.length - 1].id;

    const conversationBefore = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const retry = await support.resolveMetaInboundRouting({ phone, text: '2', messageId: providerMessageId });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.action, 'noop');
    assert.equal(atendimentos.length, countBefore + 1, 'retry da opção 2 não pode criar um segundo atendimento');

    const conversationAfter = await supportChatStore.getConversationByAppointmentId(appointmentId);
    assert.equal(conversationAfter.id, conversationBefore.id);
    const messages = await supportChatStore.listMessages(conversationAfter.id);
    assert.equal(messages.length, 1, 'retry da opção 2 não pode duplicar a mensagem');
    assert.equal(conversationAfter.last_inbound_at, conversationBefore.last_inbound_at);

    results.D2_retryDaOpcao2AposTicketAbertoEhNoOpIntegral = 'ok';
  }

  // D3) Controle negativo obrigatório: mesmo TEXTO ("3"), mas
  //     provider_message_id DIFERENTE — é uma mensagem NOVA de verdade
  //     (ex.: paciente manda "3" de novo, now within the open ticket, para
  //     pedir suporte outra vez) e PRECISA ser processada normalmente, não
  //     bloqueada. Dedup é só por provider_message_id, nunca por texto.
  {
    const conversationBefore = await supportChatStore.getConversationByAppointmentId(appointmentIdOpcao3);
    const messagesBefore = await supportChatStore.listMessages(conversationBefore.id);

    const result = await support.resolveMetaInboundRouting({
      phone: '5511977770051',
      text: '3',
      session: { id: 'sess-pos-entrega-B', typebot_session_id: null, metadata: {} },
      messageId: 'wamid-opcao3-messageId-diferente-D3'
    });

    // Dentro do ticket já aberto, "3" é EXPLICIT_SUPPORT_COMMAND e
    // handleSupportQueueInput interpreta como "reiniciar chatbot" — esse É
    // o comportamento correto para uma mensagem NOVA (não é o bug; o bug
    // era reinterpretar o MESMO evento já processado). Ou seja, mesmo
    // texto + messageId novo segue o fluxo normal do contexto atual, sem
    // ser bloqueado pelo corte de idempotência.
    assert.notEqual(result.duplicate, true, 'mensagem com messageId novo não pode ser tratada como duplicate');
    assert.equal(result.action, 'typebot_clean', 'mensagem nova de verdade segue a interpretação normal do contexto atual (não é bloqueada)');

    const conversationAfter = await supportChatStore.getConversationByAppointmentId(appointmentIdOpcao3);
    const messagesAfter = await supportChatStore.listMessages(conversationAfter.id);
    assert.equal(messagesAfter.length, messagesBefore.length + 1, 'messageId novo precisa ser gravado como inbound novo, não bloqueado');
    assert.equal(messagesAfter[messagesAfter.length - 1].provider_message_id, 'wamid-opcao3-messageId-diferente-D3');

    results.D3_mesmoTextoComMessageIdDiferenteContinuaSendoProcessado = 'ok';
  }

  // F) Fechamento (pelo painel) e nova abertura: a conversation fechada
  //    nunca reaparece como aberta, e pedir suporte de novo cria um
  //    atendimento/conversation NOVOS — histórico anterior preservado.
  //    Telefone isolado (052), só para manter este cenário independente dos
  //    anteriores (o ticket do telefone 051 agora permanece ABERTO depois
  //    de D/D3, já que o retry deixou de fechá-lo).
  {
    atendimentos = [];
    const phone = '5511977770052';
    const firstOpen = await support.resolveMetaInboundRouting({ phone, text: '2', messageId: 'wamid-F-abertura-inicial' });
    assert.equal(firstOpen.action, 'reply');
    assert.equal(atendimentos.length, 1);
    const closedAppointmentId = atendimentos[0].id;

    // Fechamento pelo painel: o admin encerra a CONVERSATION (support-chat.
    // service.close), que por sua vez sincroniza o ticket legado — direção
    // oposta à da opção 3/retry acima (ali o ticket legado fecha primeiro e
    // sincroniza a conversation; aqui a conversation fecha primeiro e
    // sincroniza o ticket legado). Ver comentário de close() em
    // support-chat.service.js.
    const conversationToClose = await supportChatStore.getConversationByAppointmentId(closedAppointmentId);
    const serviceForClose = require(resolveFrom('./support-chat.service'));
    // close() exige locked_by === actorId (closeConversation em
    // support-chat.store.js) — o atendente precisa ter reivindicado a
    // conversation antes de poder encerrá-la, mesma regra do painel real.
    await serviceForClose.claim({ conversationId: conversationToClose.id, actorId: 'admin-teste-F' });
    const closeResult = await serviceForClose.close({ conversationId: conversationToClose.id, actorId: 'admin-teste-F' });
    assert.equal(closeResult.closed, true);

    const closedConversation = await supportChatStore.getConversationByAppointmentId(closedAppointmentId);
    assert.equal(closedConversation.status, 'closed');
    const historicoAnterior = await supportChatStore.listMessages(closedConversation.id);
    assert.equal(historicoAnterior.length, 1, 'histórico da conversation fechada deve ser preservado, não apagado');

    const reopenResult = await support.resolveMetaInboundRouting({
      phone,
      text: '2',
      messageId: 'wamid-reabertura-F'
    });
    assert.equal(reopenResult.action, 'reply');
    const openAgain = await support.findOpenSupportByPhone(phone);
    assert.ok(openAgain, 'reabertura deveria criar um atendimento novo e aberto');
    assert.notEqual(openAgain.id, closedAppointmentId, 'reabertura deve criar um atendimento NOVO, nunca reaproveitar o fechado');

    const newConversation = await supportChatStore.getConversationByAppointmentId(openAgain.id);
    assert.notEqual(newConversation.id, closedConversation.id, 'reabertura deve criar uma conversation NOVA');
    const newMessages = await supportChatStore.listMessages(newConversation.id);
    assert.equal(newMessages.length, 1, 'conversation nova deve ter só a mensagem que a reabriu — não herda o histórico antigo');
    assert.equal(newMessages[0].provider_message_id, 'wamid-reabertura-F');

    // Reconfirma que o histórico antigo continua intacto após a reabertura.
    const historicoAposReabertura = await supportChatStore.listMessages(closedConversation.id);
    assert.equal(historicoAposReabertura.length, 1);

    results.F_fechamentoENovaAberturaCriaConversationNovaEPreservaHistoricoAnterior = 'ok';
  }

  // G) Janela de 24h aberta após AMBAS as opções: já verificado
  //    individualmente em A e B (withinWindow === true logo após cada
  //    abertura) — reconfirmação explícita aqui, lendo o estado real
  //    persistido no banco fake para a conversation da opção 2 (telefone
  //    050, nunca fechada por nenhum cenário posterior).
  {
    const { getMessagingWindowStatus } = require(resolveFrom('./support-chat.service'));
    const conversationOpcao2 = await supportChatStore.getConversationByAppointmentId(appointmentIdOpcao2);
    assert.equal(getMessagingWindowStatus(conversationOpcao2).withinWindow, true, 'janela da conversation da opção 2 (telefone 050) continua aberta');
    results.G_janelaDe24hConfirmadaAbertaLendoEstadoRealPersistido_opcao2 = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
