// Etapa funcional (10/10/2026) — testa o ÚNICO ponto de integração do
// inbound real do WhatsApp com o módulo novo de chat administrativo
// (whatsapp-support.service.js -> support-chat.service.js
// recordInboundMessage(), dentro do ramo de suporte já existente em
// resolveMetaInboundRouting). Sem rede, sem banco real — support-chat.
// service é stubado para isolar exatamente o que está sendo testado aqui:
// 1) a chamada acontece com os parâmetros certos quando a mensagem
//    pertence a um ticket de suporte ativo (waiting/em_atendimento);
// 2) ela nunca altera a resposta que o paciente recebe;
// 3) uma falha nela (rejeição ou exceção síncrona) nunca propaga e nunca
//    impede o fluxo normal do WhatsApp de responder.
// A persistência real (gravação, idempotência por provider_message_id,
// comportamento das 3 flags) já está coberta por
// test-support-chat-foundation.js e test-support-chat-service.js — este
// arquivo cobre só a integração nova.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'whatsapp-support.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

let atendimentos = [];
let nextAtendimentoId = 1;
stub(resolveFrom('../store/atendimentos.store'), {
  STATUS: { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento', REJECTED: 'rejected' },
  // Agora um fake mínimo de verdade (cria/busca/atualiza no array
  // compartilhado), não só um registro solto — necessário para os cenários
  // 8+ (fechar pelo painel e confirmar reabertura), que dependem de
  // getAtendimento/updateAtendimentoStatus refletirem no mesmo estado que
  // listAtendimentos (e portanto findOpenSupportByPhone) lê depois.
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
stub(resolveFrom('./post-delivery-survey.service'), { handleSurveyInbound: async () => ({ handled: false }) });
stub(resolveFrom('../delivery/delivery.service'), { sendWhatsAppText: async () => {} });

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
  clearTypebotSession: async () => {}
});

// support-chat.service stubado — controla o que recordInboundMessage,
// ensureConversation e syncLegacyClosedConversation fazem, sem tocar em
// store/constants reais (já cobertos nos outros testes).
let recordInboundCalls = [];
let recordInboundBehavior = async () => ({ recorded: true, duplicate: false, conversationId: 'conv-mock' });
let ensureConversationCalls = [];
let syncLegacyClosedCalls = [];
let syncLegacyClosedBehavior = async () => ({ closed: true, conversation: { id: 'conv-mock' } });
stub(resolveFrom('./support-chat.service'), {
  recordInboundMessage: async (args) => {
    recordInboundCalls.push(args);
    return recordInboundBehavior(args);
  },
  ensureConversation: async (args) => {
    ensureConversationCalls.push(args);
    return { recorded: true, created: true, conversationId: 'conv-mock' };
  },
  syncLegacyClosedConversation: async (args) => {
    syncLegacyClosedCalls.push(args);
    return syncLegacyClosedBehavior(args);
  }
});

const supportServicePath = require.resolve(base);
delete require.cache[supportServicePath];
const support = require(base);

const SUPPORT_PHONE = '5511977770001';
const ATENDIMENTO_ID = 'atd-suporte-ativo-001';

function seedActiveSupportTicket(subStatus) {
  atendimentos = [{
    id: ATENDIMENTO_ID,
    status: subStatus === 'em_atendimento' ? 'em_atendimento' : 'waiting',
    paciente_telefone: SUPPORT_PHONE,
    condicao: 'suporte_whatsapp',
    dados_clinicos: {
      queue_type: 'support',
      whatsapp_support: true,
      support_sub_status: subStatus,
      opened_at: new Date().toISOString()
    }
  }];
  sessionsByPhone.set(SUPPORT_PHONE, { id: `sess-${SUPPORT_PHONE}`, typebot_session_id: null, metadata: {} });
}

const results = {};

async function main() {
  // 1) Mensagem de suporte ativo chama recordInboundMessage com os
  //    parâmetros certos (appointmentId do ticket, body = texto original,
  //    providerMessageId = messageId, sender: 'patient') — e a resposta ao
  //    paciente continua exatamente a mesma (SUPPORT_WAITING_TEXT).
  {
    seedActiveSupportTicket('waiting');
    recordInboundCalls = [];
    const result = await support.resolveMetaInboundRouting({
      phone: SUPPORT_PHONE,
      text: 'minha receita não chegou',
      messageId: 'wamid-real-001'
    });
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.SUPPORT_WAITING_TEXT);
    assert.equal(recordInboundCalls.length, 1, 'recordInboundMessage deve ser chamado exatamente uma vez');
    assert.equal(recordInboundCalls[0].appointmentId, ATENDIMENTO_ID);
    assert.equal(recordInboundCalls[0].body, 'minha receita não chegou');
    assert.equal(recordInboundCalls[0].providerMessageId, 'wamid-real-001');
    assert.equal(recordInboundCalls[0].sender, 'patient');
    results.inboundDeSuporteChamaRecordInboundMessageComParametrosCorretos = 'ok';
  }

  // 2) Mesmo em em_atendimento (atendente já assumiu via painel), a
  //    integração continua ativa.
  {
    seedActiveSupportTicket('em_atendimento');
    recordInboundCalls = [];
    const result = await support.resolveMetaInboundRouting({
      phone: SUPPORT_PHONE,
      text: 'alguém aí?',
      messageId: 'wamid-real-002'
    });
    assert.equal(result.reply, support.SUPPORT_WAITING_TEXT);
    assert.equal(recordInboundCalls.length, 1);
    assert.equal(recordInboundCalls[0].appointmentId, ATENDIMENTO_ID);
    results.inboundTambemCapturadoEmEmAtendimento = 'ok';
  }

  // 3) Falha ASSÍNCRONA (rejeição) em recordInboundMessage nunca propaga —
  //    o paciente recebe a mesma resposta de sempre, sem exceção subindo.
  {
    seedActiveSupportTicket('waiting');
    recordInboundBehavior = async () => { throw new Error('falha simulada de rede/banco'); };
    const result = await support.resolveMetaInboundRouting({
      phone: SUPPORT_PHONE,
      text: 'teste com falha assíncrona',
      messageId: 'wamid-real-003'
    });
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.SUPPORT_WAITING_TEXT, 'resposta ao paciente deve ser idêntica mesmo com falha na gravação do chat');
    results.falhaAssincronaNoRegistroNaoQuebraRespostaAoPaciente = 'ok';
  }

  // 4) Falha SÍNCRONA (require() quebrado, erro de import) também nunca
  //    propaga — simulada substituindo o require inteiro por uma função que
  //    lança antes de retornar a promise.
  {
    seedActiveSupportTicket('waiting');
    const originalModule = require.cache[require.resolve(resolveFrom('./support-chat.service'))];
    stub(resolveFrom('./support-chat.service'), {
      get recordInboundMessage() { throw new Error('falha síncrona simulada (ex.: módulo quebrado)'); }
    });
    try {
      const result = await support.resolveMetaInboundRouting({
        phone: SUPPORT_PHONE,
        text: 'teste com falha síncrona',
        messageId: 'wamid-real-004'
      });
      assert.equal(result.action, 'reply');
      assert.equal(result.reply, support.SUPPORT_WAITING_TEXT, 'resposta ao paciente deve ser idêntica mesmo com falha síncrona no require/chamada');
      results.falhaSincronaNoRegistroNaoQuebraRespostaAoPaciente = 'ok';
    } finally {
      require.cache[require.resolve(resolveFrom('./support-chat.service'))] = originalModule;
      recordInboundBehavior = async () => ({ recorded: true, duplicate: false, conversationId: 'conv-mock' });
    }
  }

  // 5) Fora do ramo de suporte (sem ticket ativo), recordInboundMessage
  //    nunca é chamado — a integração é restrita ao ramo existente, não
  //    captura toda mensagem do WhatsApp. A mesma mensagem ("2", sem ticket
  //    prévio) ABRE um novo ticket de suporte — ver cenário 6 a seguir para
  //    a asserção de que isso chama ensureConversation.
  {
    atendimentos = [];
    sessionsByPhone.set('5511977770099', { id: 'sess-sem-suporte', typebot_session_id: null, metadata: {} });
    recordInboundCalls = [];
    const result = await support.resolveMetaInboundRouting({ phone: '5511977770099', text: '2', messageId: 'wamid-real-005' });
    assert.equal(result.action, 'reply');
    assert.equal(recordInboundCalls.length, 0, 'fora do ramo de suporte ativo, recordInboundMessage não deve ser chamado');
    results.foraDoRamoDeSuporteNuncaChamaRecordInboundMessage = 'ok';
  }

  // 6) Abertura de um ticket de suporte NOVO (createWhatsAppSupportEntry,
  //    disparada pelo cenário 5 acima, mensagem "2" sem ticket ativo) chama
  //    ensureConversation com o appointmentId do ticket recém-criado — sem
  //    isso, a conversation só nasceria na 2ª mensagem do paciente e ficaria
  //    invisível para o administrador até lá (achado de revisão, 17/10/2026).
  {
    assert.equal(ensureConversationCalls.length, 1, 'abrir um ticket de suporte novo deveria chamar ensureConversation exatamente uma vez');
    assert.equal(atendimentos.length, 1, 'deveria ter criado exatamente 1 atendimento novo');
    assert.equal(ensureConversationCalls[0].appointmentId, atendimentos[0].id);
    results.aberturaDeTicketNovoChamaEnsureConversationComAppointmentIdCorreto = 'ok';
  }

  // 7) Falha (síncrona ou assíncrona) em ensureConversation nunca propaga —
  //    a resposta ao paciente que está abrindo o ticket continua a mesma.
  {
    atendimentos = [];
    sessionsByPhone.set('5511977770088', { id: 'sess-sem-suporte-2', typebot_session_id: null, metadata: {} });
    const originalModule = require.cache[require.resolve(resolveFrom('./support-chat.service'))];
    stub(resolveFrom('./support-chat.service'), {
      recordInboundMessage: async (args) => {
        recordInboundCalls.push(args);
        return recordInboundBehavior(args);
      },
      ensureConversation: async () => {
        throw new Error('falha simulada ao garantir a conversation na abertura do ticket');
      }
    });
    try {
      const result = await support.resolveMetaInboundRouting({ phone: '5511977770088', text: '2', messageId: 'wamid-real-006' });
      assert.equal(result.action, 'reply');
      assert.ok(result.reply, 'abertura do ticket deve continuar respondendo normalmente mesmo com falha em ensureConversation');
      results.falhaEmEnsureConversationNuncaQuebraAAberturaDoTicket = 'ok';
    } finally {
      require.cache[require.resolve(resolveFrom('./support-chat.service'))] = originalModule;
    }
  }

  // 8) closeSupportEntryByAppointmentId fecha de verdade um ticket aberto:
  //    status -> REJECTED, support_sub_status -> CLOSED_ADMIN, e a partir daí
  //    findOpenSupportByPhone()/getPatientSupportContext() não encontram
  //    mais esse atendimento para o telefone do paciente.
  {
    seedActiveSupportTicket('waiting');
    const result = await support.closeSupportEntryByAppointmentId({ appointmentId: ATENDIMENTO_ID, actorId: 'admin-fechou' });
    assert.equal(result.closed, true);
    assert.equal(result.atendimento.status, 'rejected');
    assert.equal(result.atendimento.dados_clinicos.support_sub_status, support.SUPPORT_SUB.CLOSED_ADMIN);
    assert.equal(result.atendimento.dados_clinicos.support_closed_by, 'admin-fechou');

    const stillOpen = await support.findOpenSupportByPhone(SUPPORT_PHONE);
    assert.equal(stillOpen, null, 'depois de fechado pelo painel, o ticket não pode mais aparecer como aberto');
    const ctx = await support.getPatientSupportContext(SUPPORT_PHONE);
    assert.equal(ctx, null, 'getPatientSupportContext também não deve mais encontrar o ticket fechado');
    results.closeSupportEntryByAppointmentIdFechaTicketEParaDeSerEncontradoComoAberto = 'ok';
  }

  // 9) Idempotente: chamar de novo no mesmo atendimento já fechado é um
  //    no-op (não sobrescreve support_closed_by nem gera novo evento).
  {
    const result = await support.closeSupportEntryByAppointmentId({ appointmentId: ATENDIMENTO_ID, actorId: 'admin-outro' });
    assert.equal(result.closed, false);
    assert.equal(result.reason, 'already_closed');
    const atendimento = atendimentos.find((a) => a.id === ATENDIMENTO_ID);
    assert.equal(atendimento.dados_clinicos.support_closed_by, 'admin-fechou', 'segunda chamada não deve sobrescrever quem fechou primeiro');
    results.closeSupportEntryByAppointmentIdEhIdempotenteEmTicketJaFechado = 'ok';
  }

  // 10) Guards: appointmentId inexistente e atendimento que não é de
  //     suporte nunca são fechados por engano.
  {
    const notFound = await support.closeSupportEntryByAppointmentId({ appointmentId: 'atd-nao-existe', actorId: 'admin' });
    assert.equal(notFound.closed, false);
    assert.equal(notFound.reason, 'not_found');

    atendimentos.push({
      id: 'atd-clinico-001',
      status: 'waiting',
      paciente_telefone: '5511977770077',
      dados_clinicos: { queue_type: 'clinical' }
    });
    const notSupport = await support.closeSupportEntryByAppointmentId({ appointmentId: 'atd-clinico-001', actorId: 'admin' });
    assert.equal(notSupport.closed, false);
    assert.equal(notSupport.reason, 'not_support_queue');
    results.closeSupportEntryByAppointmentIdNuncaFechaInexistenteOuNaoSuporte = 'ok';
  }

  // 11) Reabertura: depois do fechamento pelo painel, a PRÓXIMA mensagem do
  //     mesmo telefone não é mais capturada pelo ticket antigo (cai no fluxo
  //     normal de saudação/menu) — e se o paciente pedir suporte de novo,
  //     nasce um atendimento/conversation NOVOS (appointment_id diferente),
  //     nunca uma tentativa de reabrir o antigo.
  {
    seedActiveSupportTicket('waiting');
    await support.closeSupportEntryByAppointmentId({ appointmentId: ATENDIMENTO_ID, actorId: 'admin-fechou-2' });

    recordInboundCalls = [];
    const afterClose = await support.resolveMetaInboundRouting({
      phone: SUPPORT_PHONE,
      text: 'alguém aí ainda?',
      messageId: 'wamid-pos-fechamento-001'
    });
    assert.notEqual(afterClose.reply, support.SUPPORT_WAITING_TEXT, 'mensagem após fechamento pelo painel não pode mais cair no ticket antigo');
    assert.equal(recordInboundCalls.length, 0, 'ticket fechado não deve mais capturar inbound como se estivesse ativo');

    ensureConversationCalls = [];
    const reopenResult = await support.resolveMetaInboundRouting({ phone: SUPPORT_PHONE, text: '2', messageId: 'wamid-pos-fechamento-002' });
    assert.equal(reopenResult.action, 'reply');
    const openAgain = await support.findOpenSupportByPhone(SUPPORT_PHONE);
    assert.ok(openAgain, 'pedir suporte de novo deveria criar um atendimento novo e aberto');
    assert.notEqual(openAgain.id, ATENDIMENTO_ID, 'reabertura deve criar um atendimento NOVO, nunca reaproveitar o id do antigo (fechado)');
    assert.equal(ensureConversationCalls.length, 1);
    assert.equal(ensureConversationCalls[0].appointmentId, openAgain.id);
    results.reaberturaAposFechamentoPeloPainelCriaAtendimentoEConversationNovos = 'ok';
  }

  // 12) Correção de 24/10/2026 — fechamento do ticket legado por
  //     INATIVIDADE (closeInactiveSessions, tick de 5min) chama
  //     syncLegacyClosedConversation com appointmentId/closedBy/reason
  //     corretos. Achado real em produção: sem isso, a support_conversation
  //     ficava presa em "awaiting_patient" depois do ticket legado fechar.
  {
    atendimentos = [{
      id: 'atd-expirado-inatividade',
      status: 'waiting',
      paciente_telefone: '5511977770020',
      condicao: 'suporte_whatsapp',
      criado_em: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      dados_clinicos: {
        queue_type: 'support',
        whatsapp_support: true,
        support_sub_status: support.SUPPORT_SUB.WAITING,
        opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      }
    }];
    syncLegacyClosedCalls = [];
    const closedCount = await support.closeInactiveSessions();
    assert.equal(closedCount, 1);
    assert.equal(atendimentos[0].dados_clinicos.support_sub_status, support.SUPPORT_SUB.INACTIVE);
    assert.equal(syncLegacyClosedCalls.length, 1, 'fechamento por inatividade deve sincronizar a support_conversation exatamente uma vez');
    assert.equal(syncLegacyClosedCalls[0].appointmentId, 'atd-expirado-inatividade');
    assert.equal(syncLegacyClosedCalls[0].closedBy, 'system');
    assert.equal(syncLegacyClosedCalls[0].reason, 'legacy_inactivity_timeout');
    results.fechamentoPorInatividadeChamaSyncComParametrosCorretos = 'ok';
  }

  // 13) Falha na sincronização durante o fechamento por inatividade nunca
  //     impede o fechamento do ticket legado em si (best-effort) — mesma
  //     garantia já validada para recordInboundMessage/ensureConversation.
  {
    atendimentos = [{
      id: 'atd-expirado-falha-sync',
      status: 'waiting',
      paciente_telefone: '5511977770021',
      condicao: 'suporte_whatsapp',
      criado_em: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      dados_clinicos: {
        queue_type: 'support',
        whatsapp_support: true,
        support_sub_status: support.SUPPORT_SUB.WAITING,
        opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      }
    }];
    syncLegacyClosedBehavior = async () => { throw new Error('falha simulada ao sincronizar a conversation'); };
    try {
      const closedCount = await support.closeInactiveSessions();
      assert.equal(closedCount, 1, 'falha na sincronização não pode impedir o fechamento do ticket legado');
      assert.equal(atendimentos[0].dados_clinicos.support_sub_status, support.SUPPORT_SUB.INACTIVE);
      results.falhaNaSincronizacaoNuncaImpedeOFechamentoDoTicketLegadoPorInatividade = 'ok';
    } finally {
      syncLegacyClosedBehavior = async () => ({ closed: true, conversation: { id: 'conv-mock' } });
    }
  }

  // 14) Encerramento pelo PACIENTE via WhatsApp ("0"/"ENCERRAR") também
  //     chama a sincronização, com closedBy: 'patient' — mesmo mecanismo,
  //     ator diferente.
  {
    seedActiveSupportTicket('waiting');
    syncLegacyClosedCalls = [];
    const result = await support.closeWhatsAppSupportEntry({ phone: SUPPORT_PHONE });
    assert.equal(result.closed, true);
    assert.equal(syncLegacyClosedCalls.length, 1);
    assert.equal(syncLegacyClosedCalls[0].appointmentId, ATENDIMENTO_ID);
    assert.equal(syncLegacyClosedCalls[0].closedBy, 'patient');
    assert.equal(syncLegacyClosedCalls[0].reason, 'legacy_closed_by_patient');
    results.encerramentoPeloPacienteViaWhatsappChamaSyncComClosedByPatient = 'ok';
  }

  // 15) Encerramento pela opção "1" do menu pós-atendimento
  //     (respondToFinalization) também sincroniza — terceiro ponto onde o
  //     ticket legado fecha fora do botão "Encerrar atendimento" do painel.
  {
    const phone = '5511977770022';
    atendimentos = [{
      id: 'atd-decisao-encerrar',
      status: 'waiting',
      paciente_telefone: phone,
      condicao: 'suporte_whatsapp',
      dados_clinicos: {
        queue_type: 'support',
        whatsapp_support: true,
        support_sub_status: support.SUPPORT_SUB.AWAITING_DECISION
      }
    }];
    sessionsByPhone.set(phone, { id: `sess-${phone}`, typebot_session_id: null, metadata: {} });
    syncLegacyClosedCalls = [];
    const result = await support.respondToFinalization(phone, '1');
    assert.equal(result.handled, true);
    assert.equal(result.sub_status, support.SUPPORT_SUB.CLOSED_PATIENT);
    assert.equal(syncLegacyClosedCalls.length, 1);
    assert.equal(syncLegacyClosedCalls[0].appointmentId, 'atd-decisao-encerrar');
    assert.equal(syncLegacyClosedCalls[0].closedBy, 'patient');
    assert.equal(syncLegacyClosedCalls[0].reason, 'legacy_closed_by_patient');
    results.encerramentoPelaOpcao1DoMenuPosAtendimentoTambemSincroniza = 'ok';
  }

  // 16) Reabertura após fechamento por INATIVIDADE (não pelo painel, como
  //     no cenário 11): a próxima mensagem do paciente não cai mais no
  //     ticket fechado, e pedir suporte de novo cria um atendimento NOVO —
  //     mesma garantia de C, pelo caminho de fechamento automático.
  {
    atendimentos = [{
      id: 'atd-expirado-reabertura',
      status: 'waiting',
      paciente_telefone: '5511977770023',
      condicao: 'suporte_whatsapp',
      criado_em: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      dados_clinicos: {
        queue_type: 'support',
        whatsapp_support: true,
        support_sub_status: support.SUPPORT_SUB.WAITING,
        opened_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      }
    }];
    sessionsByPhone.set('5511977770023', { id: 'sess-5511977770023', typebot_session_id: null, metadata: {} });
    await support.closeInactiveSessions();

    recordInboundCalls = [];
    const afterClose = await support.resolveMetaInboundRouting({
      phone: '5511977770023',
      text: 'alguém aí ainda?',
      messageId: 'wamid-pos-inatividade-001'
    });
    assert.notEqual(afterClose.reply, support.SUPPORT_WAITING_TEXT, 'mensagem após fechamento por inatividade não pode mais cair no ticket antigo');
    assert.equal(recordInboundCalls.length, 0);

    ensureConversationCalls = [];
    const reopenResult = await support.resolveMetaInboundRouting({ phone: '5511977770023', text: '2', messageId: 'wamid-pos-inatividade-002' });
    assert.equal(reopenResult.action, 'reply');
    const openAgain = await support.findOpenSupportByPhone('5511977770023');
    assert.ok(openAgain, 'pedir suporte de novo deveria criar um atendimento novo e aberto');
    assert.notEqual(openAgain.id, 'atd-expirado-reabertura', 'reabertura deve criar um atendimento NOVO, nunca reaproveitar o id do antigo (fechado por inatividade)');
    assert.equal(ensureConversationCalls.length, 1);
    assert.equal(ensureConversationCalls[0].appointmentId, openAgain.id);
    results.reaberturaAposFechamentoPorInatividadeCriaAtendimentoEConversationNovos = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, e.stack); process.exit(1); });
