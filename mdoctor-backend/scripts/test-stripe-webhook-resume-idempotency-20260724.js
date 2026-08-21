/**
 * Testa a idempotência da retomada do fluxo WhatsApp/Typebot após
 * confirmação de pagamento (applyCheckoutWebhook, typebot-payment-link
 * .service.js), usando a mesma proteção do canal painel/Memed
 * (payment_events.provider_event_id, índice único parcial — ver
 * supabase/migrations/20260602_fechamento_stripe_payments_idempotency.sql).
 *
 * Usa o banco real de staging com sessões/eventos isolados (telefone e
 * checkout_session_id fake, nunca usados em produção), removidos ao final
 * de cada cenário.
 */
require('./load-dotenv');
require('../src/config/supabase').initSupabase();
const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');
const svc = require('../src/services/typebot-payment-link.service');
const { findPaymentEventByProviderId } = require('../src/store/payments.store');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function makeSession(phone, checkoutSessionId, overrides = {}) {
  await supabase.from('whatsapp_sessions').delete().eq('phone', phone);
  const { data, error } = await supabase.from('whatsapp_sessions').insert({
    phone,
    provider: 'meta',
    status: 'active',
    typebot_session_id: 'fake-typebot-session-' + phone,
    metadata: {
      typebot_payment: {
        token: 'tok-' + phone,
        status: 'pending',
        payment_status: 'pending',
        checkout_session_id: checkoutSessionId,
        typebot_session_id: 'fake-typebot-session-' + phone,
        amount_cents: 4990,
        amount_label: 'R$ 49,90',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        ...overrides
      }
    }
  }).select('*').single();
  if (error) throw error;
  return data;
}

function makeEvent({ id, checkoutSessionId, token }) {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkoutSessionId,
        payment_status: 'paid',
        currency: 'brl',
        amount_total: 4990,
        metadata: { payment_token: token, typebot_session_id: 'irrelevant' }
      }
    }
  };
}

async function cleanup(phone) {
  await supabase.from('whatsapp_sessions').delete().eq('phone', phone);
}

async function cleanupPaymentEvent(eventId) {
  const existing = await findPaymentEventByProviderId('stripe', eventId);
  if (existing) {
    await supabase.from('payment_events').delete().eq('id', existing.id);
    if (existing.payment_id) await supabase.from('payments').delete().eq('id', existing.payment_id);
  }
}

const results = {};

async function test1_primeiraEntrega() {
  const phone = '5511900050001';
  const cs = 'cs_test_idem_1';
  await makeSession(phone, cs);
  const event = makeEvent({ id: 'evt_idem_1', checkoutSessionId: cs, token: 'tok-' + phone });
  const r = await svc.applyCheckoutWebhook(event);
  assert.equal(r.ok, true);
  assert.equal(r.justPaid, true, 'primeira entrega deve marcar pagamento (justPaid)');
  assert.equal(r.alreadyPaid, undefined, 'primeira entrega não é "já paga"');
  const evRow = await findPaymentEventByProviderId('stripe', event.id);
  assert.ok(evRow, 'payment_event deve ter sido criado para o event.id');
  await cleanup(phone);
  await cleanupPaymentEvent(event.id);
  results.teste1_primeira_entrega_confirma_e_retoma = 'ok';
}

async function test2_reentregaMesmoEvento() {
  const phone = '5511900050002';
  const cs = 'cs_test_idem_2';
  await makeSession(phone, cs);
  const event = makeEvent({ id: 'evt_idem_2', checkoutSessionId: cs, token: 'tok-' + phone });
  const r1 = await svc.applyCheckoutWebhook(event);
  assert.equal(r1.justPaid, true);

  // Reentrega: sessão já paga -> caminho de já-pago (curto-circuito antes
  // até de checar payment_events, igual ao comportamento pré-existente).
  const r2 = await svc.applyCheckoutWebhook(event);
  assert.equal(r2.ok, true);
  assert.equal(r2.alreadyPaid, true, 'reentrega não deve marcar como justPaid de novo');
  assert.equal(r2.justPaid, undefined);

  const { data: rows } = await supabase.from('payment_events').select('id').eq('provider_event_id', event.id);
  assert.equal(rows.length, 1, 'somente um payment_event deve existir para o mesmo event.id');

  await cleanup(phone);
  await cleanupPaymentEvent(event.id);
  results.teste2_reentrega_mesmo_event_id_sem_nova_retomada = 'ok';
}

async function test3_eventosSimultaneos() {
  const phone = '5511900050003';
  const cs = 'cs_test_idem_3';
  await makeSession(phone, cs);
  const event = makeEvent({ id: 'evt_idem_3', checkoutSessionId: cs, token: 'tok-' + phone });

  // Concorrência real: duas chamadas simultâneas para o MESMO event.id,
  // ambas partindo de uma sessão ainda "pending" (sem short-circuit por
  // já-pago) -> testa a reivindicação atômica em payment_events.
  const [ra, rb] = await Promise.all([
    svc.applyCheckoutWebhook(event),
    svc.applyCheckoutWebhook(event)
  ]);
  const justPaidCount = [ra, rb].filter((r) => r.justPaid).length;
  const alreadyPaidCount = [ra, rb].filter((r) => r.alreadyPaid).length;
  assert.equal(justPaidCount, 1, 'exatamente uma das duas chamadas concorrentes deve confirmar/retomar');
  assert.equal(ra.ok && rb.ok, true, 'ambas devem responder ok (nenhuma quebra)');

  const { data: rows } = await supabase.from('payment_events').select('id').eq('provider_event_id', event.id);
  assert.equal(rows.length, 1, 'somente um payment_event deve ter sido criado apesar da concorrência');

  await cleanup(phone);
  await cleanupPaymentEvent(event.id);
  results.teste3_eventos_simultaneos_uma_unica_retomada = `ok (justPaidCount=${justPaidCount}, alreadyPaidCount=${alreadyPaidCount})`;
}

async function test4_eventoDiferentePagamentoJaProcessado() {
  const phone = '5511900050004';
  const cs = 'cs_test_idem_4';
  await makeSession(phone, cs);
  const eventA = makeEvent({ id: 'evt_idem_4a', checkoutSessionId: cs, token: 'tok-' + phone });
  const eventB = makeEvent({ id: 'evt_idem_4b', checkoutSessionId: cs, token: 'tok-' + phone });

  const rA = await svc.applyCheckoutWebhook(eventA);
  assert.equal(rA.justPaid, true);

  // Evento DIFERENTE (ex.: payment_intent.succeeded reentregue como
  // checkout.session.completed por engano, ou duplicidade de origem) para a
  // MESMA sessão já paga -> não deve duplicar nem criar novo payment_event.
  const rB = await svc.applyCheckoutWebhook(eventB);
  assert.equal(rB.ok, true);
  assert.equal(rB.alreadyPaid, true, 'evento diferente para pagamento já confirmado não deve reprocessar');
  assert.equal(rB.justPaid, undefined);

  const evRowA = await findPaymentEventByProviderId('stripe', eventA.id);
  const evRowB = await findPaymentEventByProviderId('stripe', eventB.id);
  assert.ok(evRowA, 'payment_event do evento A deve existir');
  assert.equal(evRowB, null, 'evento B não deve ter criado payment_event (nunca chegou a reivindicar)');

  await cleanup(phone);
  await cleanupPaymentEvent(eventA.id);
  await cleanupPaymentEvent(eventB.id);
  results.teste4_evento_diferente_pagamento_ja_processado_sem_duplicacao = 'ok';
}

async function test5_falhaAntesDaRetomada() {
  const phone = '5511900050005';
  const cs = 'cs_test_idem_5';
  await makeSession(phone, cs);
  const event = makeEvent({ id: 'evt_idem_5', checkoutSessionId: cs, token: 'tok-' + phone });

  // Simula falha durante a marcação do pagamento (antes da retomada real do
  // Typebot) -> a reivindicação deve ser desfeita para permitir nova
  // tentativa segura.
  let threw = false;
  try {
    await svc.applyCheckoutWebhook(event, {
      markPaymentStatus: async () => { throw new Error('falha simulada antes da retomada'); }
    });
  } catch (error) {
    threw = true;
    assert.match(error.message, /falha simulada/);
  }
  assert.equal(threw, true, 'a falha deve propagar (não deve ser engolida silenciosamente)');

  const evRowAfterFailure = await findPaymentEventByProviderId('stripe', event.id);
  assert.equal(evRowAfterFailure, null, 'reivindicação deve ter sido desfeita após a falha');

  // Nova tentativa (mesmo event.id, dessa vez sem falha) deve funcionar
  // normalmente -> prova que a falha anterior não bloqueou permanentemente.
  const retry = await svc.applyCheckoutWebhook(event);
  assert.equal(retry.ok, true);
  assert.equal(retry.justPaid, true, 'nova tentativa após falha deve confirmar e retomar normalmente');

  await cleanup(phone);
  await cleanupPaymentEvent(event.id);
  results.teste5_falha_antes_da_retomada_permite_nova_tentativa = 'ok';
}

async function main() {
  await test1_primeiraEntrega();
  await test2_reentregaMesmoEvento();
  await test3_eventosSimultaneos();
  await test4_eventoDiferentePagamentoJaProcessado();
  await test5_falhaAntesDaRetomada();
  console.log(JSON.stringify(results, null, 2));
  console.log('\nTodos os testes passaram.');
}

main().catch((error) => {
  console.error('FALHOU:', error.message);
  console.error(JSON.stringify(results, null, 2));
  process.exit(1);
});
