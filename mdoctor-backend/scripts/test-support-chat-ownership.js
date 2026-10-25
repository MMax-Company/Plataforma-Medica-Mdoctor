// Correção de 24/10/2026 — achado real em produção: com um ticket de
// suporte WAITING/EM_ATENDIMENTO aberto (via opção "2" ou "3"), o
// roteamento ficava incorreto de duas formas:
//
// 1) Saudação ("Oi"/"Olá") sequestrava a conversa do suporte: o bloco
//    `if (greeting)` em resolveMetaInboundRouting() rodava ANTES de checar
//    se havia suporte ativo, então qualquer saudação reapresentava o menu
//    inicial (MENU_TEXT) e "roubava" o atendimento de volta pro chatbot.
//
// 2) Mensagem comum durante suporte ativo repetia SUPPORT_WAITING_TEXT a
//    cada mensagem nova (handleSupportQueueInput só tratava comandos
//    explícitos; qualquer outra coisa — inclusive a continuação natural da
//    conversa com o atendente — reapresentava o aviso de espera).
//
// Causa raiz #1: a ordem de verificação em resolveMetaInboundRouting() era
// greeting -> survey -> menu_state -> ctx/sub (suporte). Movida para
// ctx/sub (suporte) -> greeting -> survey -> menu_state — suporte ativo
// (WAITING/EM_ATENDIMENTO, não residual) passa a ser checado ANTES de
// qualquer saudação/survey/menu inicial. AWAITING_DECISION e o resto da
// função (stuckAtWelcomeChoice, atalho "3" pós-entrega, fallback "1"/"2")
// mantêm a mesma posição relativa de antes — fora de escopo desta correção.
//
// Causa raiz #2: handleSupportQueueInput() tinha um fallback único pra
// "qualquer mensagem sem comando reconhecido" que sempre devolvia
// SUPPORT_WAITING_TEXT. Esse fallback agora devolve {action:'noop'} — a
// mensagem já foi persistida por quem chamou (resolveMetaInboundRouting,
// antes de invocar handleSupportQueueInput), e o Chat Administrativo é
// quem responde a partir daí, sem repetir aviso automático.
//
// Este arquivo testa a cadeia REAL: whatsapp-support.service.js (não
// mockado) -> support-chat.service.js (não mockado) ->
// support-chat.store.js (não mockado) -> FakeSupabaseClient. Só
// atendimentos.store e whatsapp-sessions.store são fakes em memória (mesmo
// padrão de test-support-chat-first-inbound.js).
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

process.env.SUPPORT_CHAT_CAPTURE_ENABLED = 'true';
process.env.SUPPORT_CHAT_AGENT_SEND_ENABLED = 'false';
process.env.SUPPORT_CHAT_UI_ENABLED = 'false';

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

const results = {};

async function openSupportTicket(phone, { messageId }) {
  const result = await support.resolveMetaInboundRouting({ phone, text: '2', messageId });
  assert.equal(result.action, 'reply');
  const appointment = atendimentos.find((a) => a.paciente_telefone === phone);
  assert.ok(appointment, 'ticket deveria ter sido criado');
  return appointment.id;
}

async function main() {
  // A) Suporte aberto + "Oi": mensagem persistida, action noop, nenhum
  //    MENU_TEXT devolvido — a saudação não pode reiniciar o chatbot nem
  //    reapresentar o menu enquanto o suporte está ativo.
  {
    atendimentos = [];
    const phone = '5511977780001';
    const appointmentId = await openSupportTicket(phone, { messageId: 'wamid-A-abertura' });

    const result = await support.resolveMetaInboundRouting({ phone, text: 'Oi', messageId: 'wamid-A-oi' });
    assert.equal(result.action, 'noop', 'saudação durante suporte ativo não pode reapresentar o menu');
    assert.notEqual(result.reply, support.MENU_TEXT);

    const conversation = await supportChatStore.getConversationByAppointmentId(appointmentId);
    assert.equal(conversation.status, 'awaiting_agent', 'conversation continua aberta');
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 2, '"2" de abertura + "Oi" devem estar persistidas');
    assert.equal(messages[1].body, 'Oi');
    assert.equal(messages[1].direction, 'inbound');
    assert.ok(conversation.last_inbound_at);
    assert.ok(conversation.last_message_at);

    const sessionAfter = sessionsByPhone.get(phone);
    assert.notEqual(sessionAfter?.metadata?.whatsapp_menu_state, support.MENU_STATE_AWAITING_CHOICE, 'saudação durante suporte não pode gravar o estado de menu inicial');

    results.A_suporteAbertoMaisOiPersisteSemReapresentarMenu = 'ok';
  }

  // B) Idêntico ao A, com "Olá".
  {
    atendimentos = [];
    const phone = '5511977780002';
    const appointmentId = await openSupportTicket(phone, { messageId: 'wamid-B-abertura' });

    const result = await support.resolveMetaInboundRouting({ phone, text: 'Olá', messageId: 'wamid-B-ola' });
    assert.equal(result.action, 'noop');
    assert.notEqual(result.reply, support.MENU_TEXT);

    const conversation = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].body, 'Olá');
    assert.equal(conversation.status, 'awaiting_agent');

    results.B_suporteAbertoMaisOlaPersisteSemReapresentarMenu = 'ok';
  }

  // C) Suporte aberto + mensagem comum: persistida, sem SUPPORT_WAITING_TEXT.
  {
    atendimentos = [];
    const phone = '5511977780003';
    const appointmentId = await openSupportTicket(phone, { messageId: 'wamid-C-abertura' });

    const result = await support.resolveMetaInboundRouting({
      phone,
      text: 'não recebi minha receita, pode verificar?',
      messageId: 'wamid-C-mensagem'
    });
    assert.equal(result.action, 'noop');
    assert.notEqual(result.reply, support.SUPPORT_WAITING_TEXT, 'mensagem comum não pode repetir o aviso automático de espera');

    const conversation = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].body, 'não recebi minha receita, pode verificar?');

    results.C_suporteAbertoMaisMensagemComumPersisteSemAvisoRepetitivo = 'ok';
  }

  // D) Suporte aberto + "0": encerra normalmente (comando explícito
  //    preservado, inalterado por esta correção).
  {
    atendimentos = [];
    const phone = '5511977780004';
    await openSupportTicket(phone, { messageId: 'wamid-D-abertura' });

    const result = await support.resolveMetaInboundRouting({ phone, text: '0', messageId: 'wamid-D-zero' });
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.SUPPORT_CLOSED_TEXT);

    const openAfter = await support.findOpenSupportByPhone(phone);
    assert.equal(openAfter, null, 'ticket deve estar encerrado');
    results.D_suporteAbertoMaisZeroEncerraNormalmente = 'ok';
  }

  // E) Suporte aberto + "ENCERRAR": idem.
  {
    atendimentos = [];
    const phone = '5511977780005';
    await openSupportTicket(phone, { messageId: 'wamid-E-abertura' });

    const result = await support.resolveMetaInboundRouting({ phone, text: 'ENCERRAR', messageId: 'wamid-E-encerrar' });
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.SUPPORT_CLOSED_TEXT);

    const openAfter = await support.findOpenSupportByPhone(phone);
    assert.equal(openAfter, null);
    results.E_suporteAbertoMaisEncerrarEncerraNormalmente = 'ok';
  }

  // F) Sem suporte ativo + "Oi": continua abrindo o menu inicial
  //    normalmente — a correção só se aplica quando há suporte ativo.
  {
    atendimentos = [];
    const phone = '5511977780006';
    const result = await support.resolveMetaInboundRouting({ phone, text: 'Oi', messageId: 'wamid-F-oi' });
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.MENU_TEXT);
    results.F_semSuporteMaisOiContinuaAbrindoMenuInicial = 'ok';
  }

  // G) Typebot clínico realmente ativo + mensagem clínica: continua
  //    propriedade do Typebot, mesmo sem nenhum ticket de suporte.
  {
    atendimentos = [];
    const phone = '5511977780007';
    sessionsByPhone.set(phone, {
      id: 'sess-G',
      typebot_session_id: 'tb-ativo-G',
      metadata: { typebot_expected_input_id: 'blk_pergunta_clinica_qualquer' }
    });

    const result = await support.resolveMetaInboundRouting({ phone, text: 'Dislipidemia', messageId: 'wamid-G' });
    assert.equal(result.handled, false, 'Typebot clínico ativo deve receber a mensagem (continueChat)');
    assert.equal(result.action, 'typebot');
    results.G_typebotClinicoAtivoContinuaPropriedadeDoTypebot = 'ok';
  }

  // H) Ticket residual mais antigo que a sessão Typebot atual: não pode
  //    sequestrar o Typebot (mesma garantia de 19/08/2026, preservada).
  {
    atendimentos = [{
      id: 'atd-residual-H',
      status: 'em_atendimento',
      paciente_telefone: '5511977780008',
      condicao: 'suporte_whatsapp',
      dados_clinicos: {
        queue_type: 'support',
        whatsapp_support: true,
        support_sub_status: 'em_atendimento',
        opened_at: '2026-08-11T18:13:04.052Z',
        support_started_at: '2026-08-12T16:04:47.465Z' // ticket mais antigo
      }
    }];
    const phone = '5511977780008';
    sessionsByPhone.set(phone, {
      id: 'sess-H',
      typebot_session_id: 'tb-ativo-H',
      metadata: {
        typebot_expected_input_id: support.WELCOME_CHOICE_INPUT_ID,
        typebot_session_started_at: '2026-08-19T08:53:38.544Z' // sessão mais recente que o ticket
      }
    });

    const result = await support.resolveMetaInboundRouting({ phone, text: 'Vamos começar', messageId: 'wamid-H' });
    assert.equal(result.handled, false, 'ticket residual não pode sequestrar a sessão Typebot mais recente');
    assert.equal(result.action, 'typebot');
    results.H_ticketResidualMaisAntigoNaoSequestraTypebot = 'ok';
  }

  // I) Ticket atual/intencional (mais recente que a sessão Typebot, ou sem
  //    nenhuma sessão Typebot concorrente): mantém a prioridade do suporte.
  {
    atendimentos = [{
      id: 'atd-atual-I',
      status: 'em_atendimento',
      paciente_telefone: '5511977780009',
      condicao: 'suporte_whatsapp',
      dados_clinicos: {
        queue_type: 'support',
        whatsapp_support: true,
        support_sub_status: 'em_atendimento',
        opened_at: '2026-08-19T09:00:00.000Z',
        support_started_at: '2026-08-19T09:00:00.000Z' // ticket mais recente
      }
    }];
    const phone = '5511977780009';
    sessionsByPhone.set(phone, {
      id: 'sess-I',
      typebot_session_id: 'tb-ativo-I',
      metadata: {
        typebot_expected_input_id: support.WELCOME_CHOICE_INPUT_ID,
        typebot_session_started_at: '2026-08-19T08:53:38.544Z' // sessão mais antiga que o ticket
      }
    });

    const result = await support.resolveMetaInboundRouting({ phone, text: 'Vamos começar', messageId: 'wamid-I' });
    assert.equal(result.handled, true, 'ticket atual/intencional mantém a prioridade do suporte');
    assert.equal(result.action, 'noop', 'mensagem genérica dentro do suporte ativo vira noop, não repete aviso');
    results.I_ticketAtualIntencionalMantemPrioridadeDoSuporte = 'ok';
  }

  // J) Retry do mesmo provider_message_id: no-op integral preservado
  //    (garantia já publicada no PR #101, reconfirmada depois da
  //    reordenação de prioridade desta correção).
  {
    atendimentos = [];
    const phone = '5511977780010';
    const appointmentId = await openSupportTicket(phone, { messageId: 'wamid-J-abertura' });

    const conversationBefore = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const lastInboundBefore = conversationBefore.last_inbound_at;

    const retry = await support.resolveMetaInboundRouting({ phone, text: '2', messageId: 'wamid-J-abertura' });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.action, 'noop');

    const conversationAfter = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const messages = await supportChatStore.listMessages(conversationAfter.id);
    assert.equal(messages.length, 1, 'retry não pode duplicar mensagem');
    assert.equal(conversationAfter.last_inbound_at, lastInboundBefore, 'retry não pode alterar last_inbound_at');
    assert.equal(atendimentos.length, 1, 'retry não pode criar segundo ticket');

    results.J_retryComMesmoProviderMessageIdContinuaNoOpIntegral = 'ok';
  }

  // K) Opção "2" inicial continua abrindo o suporte corretamente (não
  //    regredir o PR #101).
  {
    atendimentos = [];
    const phone = '5511977780011';
    const result = await support.resolveMetaInboundRouting({ phone, text: '2', messageId: 'wamid-K' });
    assert.equal(result.action, 'reply');
    assert.equal(atendimentos.length, 1);
    const conversation = await supportChatStore.getConversationByAppointmentId(atendimentos[0].id);
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].provider_message_id, 'wamid-K');
    assert.ok(conversation.last_inbound_at);
    results.K_opcao2InicialContinuaAbrindoSuporteCorretamente = 'ok';
  }

  // L) Opção "3" pós-emissão continua abrindo o suporte corretamente (não
  //    regredir o PR #101).
  {
    atendimentos = [];
    const phone = '5511977780012';
    const result = await support.resolveMetaInboundRouting({
      phone,
      text: '3',
      session: { id: 'sess-L', typebot_session_id: null, metadata: { post_delivery_support_available: true } },
      messageId: 'wamid-L'
    });
    assert.equal(result.action, 'reply');
    assert.equal(atendimentos.length, 1);
    const conversation = await supportChatStore.getConversationByAppointmentId(atendimentos[0].id);
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].provider_message_id, 'wamid-L');
    assert.ok(conversation.last_inbound_at);
    results.L_opcao3PosEmissaoContinuaAbrindoSuporteCorretamente = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, '\n', e.stack); process.exit(1); });
