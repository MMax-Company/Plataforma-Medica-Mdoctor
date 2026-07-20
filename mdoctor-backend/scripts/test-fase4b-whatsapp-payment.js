/**
 * FASE 4B — consolidação do pagamento WhatsApp (somente Stripe Checkout).
 * Testes locais com mocks Stripe; sem cobrança real.
 */
const assert = require('assert');
const {
  applyCheckoutWebhook,
  resolveConfirmedWhatsAppPayment,
  stripeSessionIsPaid,
  completePaymentByToken,
  resolveCheckoutRedirect
} = require('../src/services/typebot-payment-link.service');
const { PAYMENT_AMOUNT_CENTS } = require('../src/services/typebot-payment.constants');
const { normalizePaymentStatus } = require('../src/services/clinical-payload-normalizer.service');
const fs = require('fs');
const path = require('path');

function makeSession(paymentPatch = {}) {
  return {
    id: 'wa-4b',
    phone: '5511985485777',
    bsuid: null,
    metadata: {
      typebot_payment: {
        token: 'tok-4b',
        payment_status: 'pending',
        status: 'pending',
        checkout_session_id: 'cs_4b_1',
        checkout_url: 'https://checkout.stripe.com/c/pay/cs_4b_1',
        typebot_session_id: 'tb-4b',
        amount_cents: PAYMENT_AMOUNT_CENTS,
        amount_label: 'R$ 69,90',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        ...paymentPatch
      }
    }
  };
}

function paidCheckout(overrides = {}) {
  return {
    id: 'cs_4b_1',
    payment_status: 'paid',
    status: 'complete',
    amount_total: PAYMENT_AMOUNT_CENTS,
    currency: 'brl',
    metadata: { payment_token: 'tok-4b' },
    ...overrides
  };
}

async function main() {
  const report = {};

  // 1) Checkout pago válido confirma
  assert.equal(stripeSessionIsPaid(paidCheckout()), true);
  const applied = await applyCheckoutWebhook({
    id: 'evt_4b_paid',
    data: { object: paidCheckout() }
  }, {
    findSessionByPaymentToken: async () => makeSession(),
    markPaymentStatus: async () => {}
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.justPaid, true);
  report['1_checkout_pago_valido_confirma'] = 'ok';

  // 2) payment_status="paid" apenas no Typebot NÃO confirma
  const fromTypebot = normalizePaymentStatus({ payment_status: 'paid' });
  assert.equal(fromTypebot.paid, false);
  assert.equal(fromTypebot.pagamento_status, 'PENDENTE');
  assert.equal(fromTypebot.payment_claimed_by_typebot, true);

  const noStripeSession = await resolveConfirmedWhatsAppPayment({
    phone: '5511985485777',
    deps: {
      getSessionByPhone: async () => null,
      findSessionByPaymentToken: async () => null
    }
  });
  assert.equal(noStripeSession.confirmed, false);
  report['2_typebot_paid_nao_confirma'] = 'ok';

  // 3) Checkout complete sem payment_status=paid NÃO confirma
  assert.equal(
    stripeSessionIsPaid({
      payment_status: 'unpaid',
      status: 'complete',
      amount_total: PAYMENT_AMOUNT_CENTS,
      currency: 'brl'
    }),
    false
  );
  const completeOnly = await applyCheckoutWebhook({
    id: 'evt_4b_complete_only',
    data: {
      object: {
        id: 'cs_4b_1',
        payment_status: 'unpaid',
        status: 'complete',
        amount_total: PAYMENT_AMOUNT_CENTS,
        currency: 'brl',
        metadata: { payment_token: 'tok-4b' }
      }
    }
  }, {
    findSessionByPaymentToken: async () => makeSession()
  });
  assert.equal(completeOnly.ok, false);
  assert.equal(completeOnly.code, 'COMPLETE_WITHOUT_PAID');
  report['3_complete_sem_paid_nao_confirma'] = 'ok';

  // 4) Webhook duplicado permanece idempotente
  const dup = await applyCheckoutWebhook({
    id: 'evt_4b_dup',
    data: { object: paidCheckout() }
  }, {
    findSessionByPaymentToken: async () => makeSession({
      payment_status: 'paid',
      status: 'completed',
      stripe_event_id: 'evt_4b_paid'
    })
  });
  assert.equal(dup.alreadyPaid, true);
  report['4_webhook_duplicado_idempotente'] = 'ok';

  // 5) Abrir pagamento novamente reutiliza Checkout existente (open)
  let createCalls = 0;
  const stripeReuse = {
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: 'cs_4b_1',
          status: 'open',
          payment_status: 'unpaid',
          amount_total: PAYMENT_AMOUNT_CENTS,
          currency: 'brl',
          url: 'https://checkout.stripe.com/c/pay/cs_4b_1'
        }),
        create: async () => {
          createCalls += 1;
          return { id: 'cs_new', url: 'https://checkout.stripe.com/new' };
        }
      }
    }
  };
  const reopen = await resolveCheckoutRedirect('tok-4b', {
    findSessionByPaymentToken: async () => makeSession(),
    stripe: stripeReuse
  });
  assert.equal(reopen.ok, true);
  assert.equal(reopen.url, 'https://checkout.stripe.com/c/pay/cs_4b_1');
  assert.equal(createCalls, 0);
  report['5_reabrir_reutiliza_checkout'] = 'ok';

  // 6) Atendimento recebe payment_token e checkout_session_id do pagamento validado
  const linked = await resolveConfirmedWhatsAppPayment({
    phone: '5511985485777',
    deps: {
      getSessionByPhone: async () => makeSession({
        payment_status: 'paid',
        status: 'completed',
        stripe_event_id: 'evt_4b_paid'
      }),
      verifyStripeCheckoutPaid: async () => ({
        paid: true,
        checkout: paidCheckout()
      })
    }
  });
  assert.equal(linked.confirmed, true);
  assert.equal(linked.payment_token, 'tok-4b');
  assert.equal(linked.checkout_session_id, 'cs_4b_1');
  report['6_atendimento_vincula_token_e_checkout'] = 'ok';

  // 7) Fluxo WhatsApp não cria PaymentIntent paralelo
  const bridgeSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/typebot-whatsapp.bridge.js'),
    'utf8'
  );
  assert.match(bridgeSrc, /runtimeOptions:\s*\{\s*\}/);
  assert.doesNotMatch(bridgeSrc, /runtimeOptions:\s*typebot\.input\.runtimeOptions/);

  const linkSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/typebot-payment-link.service.js'),
    'utf8'
  );
  assert.doesNotMatch(linkSrc, /paymentIntents\.create/);
  assert.match(linkSrc, /checkout\.sessions\.create/);
  assert.doesNotMatch(linkSrc, /extractIntentId\(runtimeOptions\.paymentIntentSecret\)/);

  const webhookSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/stripe-webhook.service.js'),
    'utf8'
  );
  assert.match(webhookSrc, /whatsapp_checkout_only/);
  assert.match(webhookSrc, /PaymentIntent legado/);
  // Evento PI sem sessão typebot não confirma Typebot; fluxo atendimento exige atendimento_id
  report['7_sem_payment_intent_paralelo'] = 'ok';

  // stripe_payment_verified no payload (backend) ainda confirma no normalizer
  const verifiedPayload = normalizePaymentStatus({ stripe_payment_verified: true });
  assert.equal(verifiedPayload.paid, true);

  // completePaymentByToken ainda exige paid
  const blocked = await completePaymentByToken('tok-4b', {
    session: makeSession(),
    refreshPaymentStatus: async () => ({ ok: true, paymentStatus: 'pending' }),
    claimFlowResume: async () => true,
    callTypebot: async () => { throw new Error('não deveria continuar'); }
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'NOT_PAID');

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
