// Pedido econômico (25/10/2026) — 2 correções pontuais no Chat
// Administrativo de Suporte:
//
// 1) support_tickets (tabela legada, separada de appointments/
//    support_conversations) nunca fechava: recordSupportTicket() só grava
//    na abertura, e não existia nenhum caminho de fechamento — mesmo com o
//    appointment e a support_conversation já encerrados pelo painel,
//    support_tickets.status continuava "open"/closed_at nulo. Corrigido com
//    closeSupportTicketByAppointmentId() (clinical-persistence.service.js),
//    chamada por closeSupportEntryByAppointmentId() (o fechamento
//    administrativo, usado por support-chat.service.js#close(), que é quem
//    POST /api/admin/support/conversations/:id/close invoca).
//
// 2) Mídia (imagem/documento) enviada durante suporte ativo era descartada
//    (whatsapp_business_media_skipped_no_upload_session) — o webhook só
//    sabia processar mídia dentro de um upload_session clínico pendente.
//    Corrigido com routeIncomingMediaToActiveSupport() (whatsapp-support.
//    service.js), chamada por whatsapp.routes.js ANTES de
//    findPendingUploadContext: com suporte WAITING/EM_ATENDIMENTO aberto, a
//    mídia é persistida na support_conversation (campo `media`, já existente
//    em support_chat_messages — reservado desde a migration
//    20261010120000_support_chat_v1.sql, nenhuma migration nova foi
//    necessária); sem suporte ativo, routedToSupport:false e o caller segue
//    o fluxo clínico de upload inalterado.
//
// Este arquivo testa a cadeia REAL: whatsapp-support.service.js (não
// mockado) -> support-chat.service.js (não mockado) ->
// support-chat.store.js (não mockado) -> FakeSupabaseClient. Só
// atendimentos.store, whatsapp-sessions.store e clinical-persistence.service
// são fakes em memória (mesmo padrão de test-support-chat-first-inbound.js).
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
stub(resolveFrom('./admin-alert.service'), { notifyAdminAlert: () => {} });

// Fake em memória de support_tickets (tabela legada) — mesmo contrato de
// clinical-persistence.service.js (recordSupportTicket cria, agora também
// closeSupportTicketByAppointmentId fecha).
let supportTickets = [];
stub(resolveFrom('./clinical-persistence.service'), {
  recordSupportTicket: async ({ appointmentId, phone }) => {
    const ticket = {
      id: `ticket-${supportTickets.length + 1}`,
      appointment_id: appointmentId || null,
      status: 'open',
      closed_at: null,
      metadata: { phone }
    };
    supportTickets.push(ticket);
    return ticket;
  },
  closeSupportTicketByAppointmentId: async (appointmentId) => {
    const ticket = supportTickets.find((t) => t.appointment_id === appointmentId && t.status === 'open');
    if (!ticket) return { closed: false, reason: 'not_found_or_already_closed' };
    ticket.status = 'closed';
    ticket.closed_at = new Date().toISOString();
    return { closed: true, ticket };
  }
});

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
const supportChatService = require(resolveFrom('./support-chat.service'));

const results = {};

async function openSupportTicket(phone, messageId) {
  const result = await support.resolveMetaInboundRouting({ phone, text: '2', messageId });
  assert.equal(result.action, 'reply');
  const appointment = atendimentos.find((a) => a.paciente_telefone === phone);
  assert.ok(appointment, 'ticket deveria ter sido criado');
  return appointment.id;
}

async function main() {
  // =======================================================================
  // 1) support_tickets fecha junto com o Chat Administrativo
  // =======================================================================

  // 1a) Fechar conversation ativa -> conversation + appointment +
  //     support_ticket fecham.
  {
    atendimentos = [];
    supportTickets = [];
    const phone = '5511977790001';
    const appointmentId = await openSupportTicket(phone, 'wamid-1a-abertura');
    const ticket = supportTickets.find((t) => t.appointment_id === appointmentId);
    assert.equal(ticket.status, 'open');

    const conversation = await supportChatStore.getConversationByAppointmentId(appointmentId);
    await supportChatService.claim({ conversationId: conversation.id, actorId: 'admin-1a' });
    const closeResult = await supportChatService.close({ conversationId: conversation.id, actorId: 'admin-1a' });
    assert.equal(closeResult.closed, true, 'conversation deveria fechar');

    const appointmentAfter = atendimentos.find((a) => a.id === appointmentId);
    assert.equal(appointmentAfter.status, 'rejected', 'appointment deveria fechar');
    assert.equal(appointmentAfter.dados_clinicos.support_sub_status, support.SUPPORT_SUB.CLOSED_ADMIN);

    const ticketAfter = supportTickets.find((t) => t.appointment_id === appointmentId);
    assert.equal(ticketAfter.status, 'closed', 'support_ticket legado deveria fechar junto');
    assert.ok(ticketAfter.closed_at, 'closed_at deveria estar preenchido');

    results['1a_conversationAppointmentETicketFecham'] = 'ok';
  }

  // 1b) Repetir close -> não duplica nem sobrescreve timestamps indevidamente.
  {
    const phone = '5511977790001';
    const appointmentId = atendimentos.find((a) => a.paciente_telefone === phone).id;
    const ticketBefore = supportTickets.find((t) => t.appointment_id === appointmentId);
    const closedAtBefore = ticketBefore.closed_at;

    const secondClose = await support.closeSupportEntryByAppointmentId({ appointmentId, actorId: 'admin-outro' });
    assert.equal(secondClose.closed, false, 'segunda chamada não pode fechar de novo');
    assert.equal(secondClose.reason, 'already_closed');

    const ticketAfter = supportTickets.find((t) => t.appointment_id === appointmentId);
    assert.equal(ticketAfter.status, 'closed');
    assert.equal(ticketAfter.closed_at, closedAtBefore, 'closed_at não pode ser sobrescrito numa segunda chamada');
    assert.equal(supportTickets.filter((t) => t.appointment_id === appointmentId).length, 1, 'não pode duplicar a linha do support_ticket');

    results['1b_repetirCloseNaoDuplicaNemSobrescreveTimestamps'] = 'ok';
  }

  // 1c) Fechamento pelo PACIENTE ("0"/"ENCERRAR") continua funcionando —
  //     caminho fora de escopo desta correção (objetivo é só o fechamento
  //     administrativo via POST /conversations/:id/close); confirma que não
  //     regredimos esse caminho.
  {
    atendimentos = [];
    supportTickets = [];
    const phone = '5511977790002';
    await openSupportTicket(phone, 'wamid-1c-abertura');

    const result = await support.resolveMetaInboundRouting({ phone, text: 'ENCERRAR', messageId: 'wamid-1c-encerrar' });
    assert.equal(result.action, 'reply');
    assert.equal(result.reply, support.SUPPORT_CLOSED_TEXT);
    const openAfter = await support.findOpenSupportByPhone(phone);
    assert.equal(openAfter, null, 'ticket (appointment) deve estar encerrado');

    results['1c_fechamentoPeloPacienteContinuaFuncionando'] = 'ok';
  }

  // =======================================================================
  // 2) Mídia enviada durante suporte é persistida (não descartada)
  // =======================================================================

  // 2a) Suporte ativo + image -> persiste no chat, sem Typebot (a função
  //     nunca chama nada de Typebot/auto-reply — só persiste e retorna).
  {
    atendimentos = [];
    const phone = '5511977790003';
    const appointmentId = await openSupportTicket(phone, 'wamid-2a-abertura');

    const routing = await support.routeIncomingMediaToActiveSupport({
      phone,
      messageId: 'wamid-2a-imagem',
      mediaType: 'image',
      mediaId: 'meta-media-id-123',
      mimeType: 'image/jpeg',
      filename: 'foto.jpg'
    });
    assert.equal(routing.routedToSupport, true, 'com suporte ativo, mídia deve pertencer à support_conversation');
    assert.equal(routing.recorded, true);
    assert.notEqual(routing.duplicate, true);

    const conversation = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 2, '"2" de abertura + a mídia devem estar persistidas');
    const mediaMessage = messages[1];
    assert.equal(mediaMessage.direction, 'inbound');
    assert.equal(mediaMessage.provider_message_id, 'wamid-2a-imagem');
    assert.deepEqual(mediaMessage.media, { type: 'image', mediaId: 'meta-media-id-123', mimeType: 'image/jpeg', filename: 'foto.jpg' });

    results['2a_suporteAtivoMaisImagemPersisteSemTypebot'] = 'ok';
  }

  // 2b) Suporte ativo + document -> persiste no chat, sem Typebot.
  {
    atendimentos = [];
    const phone = '5511977790004';
    const appointmentId = await openSupportTicket(phone, 'wamid-2b-abertura');

    const routing = await support.routeIncomingMediaToActiveSupport({
      phone,
      messageId: 'wamid-2b-documento',
      mediaType: 'document',
      mediaId: 'meta-media-id-456',
      mimeType: 'application/pdf',
      filename: 'documento.pdf'
    });
    assert.equal(routing.routedToSupport, true);

    const conversation = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1].media.type, 'document');
    assert.equal(messages[1].media.filename, 'documento.pdf');

    results['2b_suporteAtivoMaisDocumentoPersisteSemTypebot'] = 'ok';
  }

  // 2c) Sem suporte + mídia clínica -> routedToSupport:false, comportamento
  //     atual de upload clínico preservado (o caller — whatsapp.routes.js —
  //     segue para findPendingUploadContext/ingestWhatsAppPrescriptionMedia
  //     exatamente como antes; esta função não decide nada além de "é do
  //     suporte ou não é").
  {
    atendimentos = [];
    const phone = '5511977790005';

    const routing = await support.routeIncomingMediaToActiveSupport({
      phone,
      messageId: 'wamid-2c-imagem',
      mediaType: 'image',
      mediaId: 'meta-media-id-789',
      mimeType: 'image/jpeg',
      filename: 'receita.jpg'
    });
    assert.equal(routing.routedToSupport, false, 'sem suporte ativo, deve devolver a decisão pro fluxo clínico');

    results['2c_semSuporteMaisMidiaClinicaPreservaComportamentoAtual'] = 'ok';
  }

  // 2d) Mesmo provider_message_id -> sem duplicação.
  {
    atendimentos = [];
    const phone = '5511977790006';
    const appointmentId = await openSupportTicket(phone, 'wamid-2d-abertura');

    const first = await support.routeIncomingMediaToActiveSupport({
      phone,
      messageId: 'wamid-2d-imagem',
      mediaType: 'image',
      mediaId: 'meta-media-id-999',
      mimeType: 'image/jpeg',
      filename: 'foto2.jpg'
    });
    assert.equal(first.routedToSupport, true);
    assert.notEqual(first.duplicate, true);

    const retry = await support.routeIncomingMediaToActiveSupport({
      phone,
      messageId: 'wamid-2d-imagem',
      mediaType: 'image',
      mediaId: 'meta-media-id-999',
      mimeType: 'image/jpeg',
      filename: 'foto2.jpg'
    });
    assert.equal(retry.routedToSupport, true);
    assert.equal(retry.duplicate, true, 'retry do mesmo provider_message_id deve ser identificado como duplicate');

    const conversation = await supportChatStore.getConversationByAppointmentId(appointmentId);
    const messages = await supportChatStore.listMessages(conversation.id);
    assert.equal(messages.length, 2, '"2" de abertura + 1 mídia — retry não pode duplicar');

    results['2d_mesmoProviderMessageIdSemDuplicacao'] = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, '\n', e.stack); process.exit(1); });
