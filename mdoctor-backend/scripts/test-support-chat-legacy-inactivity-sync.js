// Correção de 24/10/2026 — fechamento por inatividade (ou pelo próprio
// paciente via WhatsApp, "0"/"ENCERRAR") do ticket LEGADO agora sincroniza
// com a support_conversation correspondente, na direção OPOSTA da já
// existente em support-chat.service.js#close() (painel -> legado). Achado
// real em produção (24/10/2026): uma conversation ficou presa em
// "awaiting_patient" depois do ticket legado fechar por inatividade — a
// fila administrativa mostrava uma conversa "fantasma" como aberta.
//
// Este arquivo testa a função nova (support-chat.service.js#
// syncLegacyClosedConversation / support-chat.store.js#
// closeConversationByAppointmentId) ISOLADA, com o store REAL contra um
// FakeSupabaseClient — sem rede, sem banco real. A integração do lado do
// whatsapp-support.service.js (quem CHAMA essa função, nos 3 pontos onde o
// ticket legado fecha fora do botão "Encerrar atendimento") é testada em
// test-support-chat-inbound-integration.js, com support-chat.service
// mockado — mesma divisão já usada para a sincronização na direção
// contrária (ver test-support-chat-service.js vs. esse outro arquivo).
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

stub(resolveFrom('../config/supabase'), {
  isSupabaseConfigured: () => true,
  getSupabase: () => fakeDb
});

const store = require(storePath);
const service = require(servicePath);

const results = {};

async function seedConversation(appointmentId, overrides = {}) {
  const { conversation } = await store.ensureConversationForAppointment({ appointmentId, patientId: null });
  const row = fakeDb.rows('support_conversations').find((r) => r.id === conversation.id);
  Object.assign(row, overrides);
  return row;
}

async function main() {
  // 1) Conversation aberta, sem ninguém com o lock (caso real de produção:
  //    ticket legado fechou por inatividade, ninguém nunca reivindicou) —
  //    syncLegacyClosedConversation encerra de verdade: status closed,
  //    closed_at preenchido, closed_by coerente com o motivo automático, e
  //    deixa de aparecer em listQueue (fila só mostra não-encerradas).
  {
    const row = await seedConversation('atd-inativo-1', { status: 'awaiting_patient' });
    const result = await service.syncLegacyClosedConversation({
      appointmentId: 'atd-inativo-1', closedBy: 'system', reason: 'legacy_inactivity_timeout'
    });
    assert.equal(result.closed, true);
    assert.equal(result.conversation.status, 'closed');
    assert.ok(result.conversation.closed_at, 'closed_at deve ser preenchido');
    assert.equal(result.conversation.closed_by, 'system');

    const queue = await store.listQueue();
    assert.ok(!queue.some((c) => c.id === row.id), 'conversation encerrada não pode aparecer na fila ativa');
    results.fechamentoPorInatividadeEncerraDeVerdadeEDeixaDeAparecerNaFila = 'ok';
  }

  // 2) Lock ATIVO (ainda não expirado) de um atendente no momento em que o
  //    ticket legado fecha por inatividade: a sincronização ainda encerra a
  //    conversation e libera o lock — o ticket legado já terminou, não há
  //    razão clínica pra manter a conversa "presa" a esse atendente.
  {
    const row = await seedConversation('atd-inativo-2', { status: 'awaiting_patient' });
    await store.claimConversation({ conversationId: row.id, actorId: 'atendente-x' });
    const beforeClaim = fakeDb.rows('support_conversations').find((r) => r.id === row.id);
    assert.ok(beforeClaim.locked_by, 'pré-condição: lock deveria estar ativo antes da sincronização');

    const result = await service.syncLegacyClosedConversation({
      appointmentId: 'atd-inativo-2', closedBy: 'system', reason: 'legacy_inactivity_timeout'
    });
    assert.equal(result.closed, true);
    assert.equal(result.conversation.locked_by, null, 'lock deve ser liberado ao sincronizar o fechamento');
    assert.equal(result.conversation.lock_expires_at, null);
    results.lockAtivoDeAtendenteELiberadoAoSincronizarFechamentoPorInatividade = 'ok';
  }

  // 3) Nenhuma conversation existe para o appointment (ticket legado antigo,
  //    criado antes do Chat Administrativo de Suporte existir, ou nunca
  //    capturado) — nunca lança, nunca inventa uma conversation nova.
  {
    const result = await service.syncLegacyClosedConversation({
      appointmentId: 'atd-sem-conversation', closedBy: 'system', reason: 'legacy_inactivity_timeout'
    });
    assert.equal(result.closed, false);
    assert.equal(result.reason, 'conversation_not_found');
    results.semConversationCorrespondenteNuncaLancaNemInventaUmaNova = 'ok';
  }

  // 4) Conversation JÁ encerrada manualmente pelo atendente (botão
  //    "Encerrar atendimento") — a sincronização automática nunca sobrescreve
  //    quem fechou primeiro nem o closed_at original (idempotência contra o
  //    OUTRO caminho de fechamento, não só contra ela mesma).
  {
    const row = await seedConversation('atd-ja-fechado-manual', { status: 'awaiting_patient' });
    await store.claimConversation({ conversationId: row.id, actorId: 'admin-manual' });
    const manualClose = await store.closeConversation({ conversationId: row.id, actorId: 'admin-manual' });
    assert.equal(manualClose.closed, true);

    const result = await service.syncLegacyClosedConversation({
      appointmentId: 'atd-ja-fechado-manual', closedBy: 'system', reason: 'legacy_inactivity_timeout'
    });
    assert.equal(result.closed, false);
    assert.equal(result.reason, 'already_closed');
    const finalRow = fakeDb.rows('support_conversations').find((r) => r.id === row.id);
    assert.equal(finalRow.closed_by, 'admin-manual', 'fechamento manual anterior não pode ser sobrescrito pela sincronização automática');
    results.fechamentoManualPrevioNuncaEhSobrescritoPelaSincronizacaoAutomatica = 'ok';
  }

  // 5) Chamar a sincronização DUAS VEZES pro mesmo appointment (ex.:
  //    closeInactiveSessions rodando de novo antes do próximo tick, ou
  //    reentrega) é idempotente: segunda chamada é no-op, sem erro, sem
  //    sobrescrever closed_at da primeira.
  {
    const row = await seedConversation('atd-inativo-duplo', { status: 'awaiting_patient' });
    const first = await service.syncLegacyClosedConversation({
      appointmentId: 'atd-inativo-duplo', closedBy: 'system', reason: 'legacy_inactivity_timeout'
    });
    assert.equal(first.closed, true);
    const firstClosedAt = first.conversation.closed_at;

    const second = await service.syncLegacyClosedConversation({
      appointmentId: 'atd-inativo-duplo', closedBy: 'system', reason: 'legacy_inactivity_timeout'
    });
    assert.equal(second.closed, false);
    assert.equal(second.reason, 'already_closed');
    const finalRow = fakeDb.rows('support_conversations').find((r) => r.id === row.id);
    assert.equal(finalRow.closed_at, firstClosedAt, 'segunda sincronização não pode trocar o closed_at da primeira');
    results.sincronizacaoExecutadaDuasVezesEhIdempotente = 'ok';
  }

  // 6) Encerramento pelo PACIENTE via WhatsApp ("0"/"ENCERRAR", ou opção "1"
  //    no menu pós-atendimento) é a MESMA função, só com closedBy diferente
  //    — confirma que não existe um segundo mecanismo paralelo de
  //    fechamento, só motivos/atores diferentes chamando a função única.
  {
    await seedConversation('atd-encerrado-paciente', { status: 'awaiting_patient' });
    const result = await service.syncLegacyClosedConversation({
      appointmentId: 'atd-encerrado-paciente', closedBy: 'patient', reason: 'legacy_closed_by_patient'
    });
    assert.equal(result.closed, true);
    assert.equal(result.conversation.closed_by, 'patient');
    results.encerramentoPeloPacienteUsaAMesmaFuncaoSoComClosedByDiferente = 'ok';
  }

  // 7) syncLegacyClosedConversation nunca lança, mesmo se a consulta ao
  //    banco falhar (ex.: tabela indisponível) — é chamada de dentro do
  //    whatsapp-support.service.js logo após o fechamento do ticket legado
  //    já ter acontecido; uma falha aqui não pode se propagar.
  {
    const original = fakeDb._execute.bind(fakeDb);
    fakeDb._execute = () => { throw new Error('falha simulada de consulta ao Supabase'); };
    try {
      const result = await service.syncLegacyClosedConversation({
        appointmentId: 'atd-qualquer', closedBy: 'system', reason: 'legacy_inactivity_timeout'
      });
      assert.equal(result.closed, false);
      assert.equal(result.reason, 'sync_error');
      results.falhaDeConsultaNuncaLancaDevolveSyncError = 'ok';
    } finally {
      fakeDb._execute = original;
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
