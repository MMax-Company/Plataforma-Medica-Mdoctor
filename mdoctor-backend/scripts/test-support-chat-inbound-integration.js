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
stub(resolveFrom('../store/atendimentos.store'), {
  STATUS: { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento', REJECTED: 'rejected' },
  createAtendimento: async (row) => ({ id: 'atd-mock', ...row }),
  listAtendimentos: async () => atendimentos,
  getAtendimento: async () => null,
  updateAtendimentoStatus: async () => ({})
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
  }
});

// support-chat.service stubado — controla o que recordInboundMessage faz,
// sem tocar em store/constants reais (já cobertos nos outros testes).
let recordInboundCalls = [];
let recordInboundBehavior = async () => ({ recorded: true, duplicate: false, conversationId: 'conv-mock' });
stub(resolveFrom('./support-chat.service'), {
  recordInboundMessage: async (args) => {
    recordInboundCalls.push(args);
    return recordInboundBehavior(args);
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
  //    captura toda mensagem do WhatsApp.
  {
    atendimentos = [];
    sessionsByPhone.set('5511977770099', { id: 'sess-sem-suporte', typebot_session_id: null, metadata: {} });
    recordInboundCalls = [];
    const result = await support.resolveMetaInboundRouting({ phone: '5511977770099', text: '2', messageId: 'wamid-real-005' });
    assert.equal(result.action, 'reply');
    assert.equal(recordInboundCalls.length, 0, 'fora do ramo de suporte ativo, recordInboundMessage não deve ser chamado');
    results.foraDoRamoDeSuporteNuncaChamaRecordInboundMessage = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, e.stack); process.exit(1); });
