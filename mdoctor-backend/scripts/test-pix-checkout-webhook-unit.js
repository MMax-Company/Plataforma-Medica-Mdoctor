// Offline Pix Checkout integration regression. No Stripe or Supabase credentials required.
const assert = require('assert');
const path = require('path');
const base = path.join(__dirname, '..', 'src', 'services', 'stripe-webhook.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);
function stub(p, exports) {
  const resolved = require.resolve(resolveFrom(p));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const payments = require('../src/services/typebot-payment.constants');
assert.deepStrictEqual(payments.PAYMENT_METHOD_TYPES, ['card', 'pix']);
assert.strictEqual(payments.PIX_EXPIRES_AFTER_SECONDS, 1800);
let applied = 0;
let resumed = 0;
let paid = true;
stub('../config/logger', { info() {}, warn() {}, error() {} });
stub('../store/audit.store', { createAuditLog: async () => {} });
stub('../store/atendimentos.store', { STATUS: {}, getAtendimento: async () => null, listAtendimentos: async () => [], updateAtendimentoStatus: async () => {} });
stub('../store/payments.store', { findPaymentByAppointment: async () => null, findPaymentEventByProviderId: async () => null, markPaymentRefunded: async () => {}, recordStripePaymentEvent: async () => {} });
stub('./clinical-persistence.service', { recordIntegrationLog: async () => {} });
stub('./prescription-upload-token.service', { isExternalUploadEnabled: () => false, ensurePrescriptionUploadSession: async () => {} });
stub('./typebot-payment-link.service', {
  applyCheckoutWebhook: async () => { applied++; return paid ? { ok: true, token: 'test-token', session: {} } : {ok: false, code: 'COMPLETE_WITHOUT_PAID'}; },
  completePaymentByToken: async () => { resumed++; return { responsesSent: 1 }; },
  findSessionByPaymentIntentId: async () => null
});
delete require.cache[require.resolve(base)];
const {handleStripeWebhookEvent} = require(base);
const checkout = (type, payment_status) => ({
  id: 'evt_pix_offline', type, data: { object: { id: 'cs_test_offline', amount_total: 4990, currency: 'brl',
  payment_status, metadata: {payment_token: 'test-token', typebot_session_id: 'test-session'} } }
});
(async () => {
  let result = await handleStripeWebhookEvent(checkout('checkout.session.async_payment_succeeded', 'paid'));
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.typebot_payment, true);
  assert.strictEqual(applied, 1);
  assert.strictEqual(resumed, 1);
  paid = false;
  result = await handleStripeWebhookEvent(checkout('checkout.session.completed', 'unpaid'));
  assert.strictEqual(result.status, 200);
  assert.strictEqual(resumed, 1, 'unpaid Checkout must never resume Typebot');
  result = await handleStripeWebhookEvent(checkout('checkout.session.async_payment_failed', 'unpaid'));
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.ignored, true);
  assert.strictEqual(resumed, 1);
  console.log(JSON.stringify({ pix_async_paid_resumes: 'ok', unpaid_does_not_resume: 'ok',
    async_failed_does_not_resume: 'ok', checkout_methods: 'card,pix', pix_expiry_seconds: 1800 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
