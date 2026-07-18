const assert = require('assert');
const {
  PAYMENT_SUCCESS_REPLY,
  applyCheckoutWebhook,
  completePaymentByToken,
  extractIntentId,
  refreshPaymentStatus
} = require('../src/services/typebot-payment-link.service');
const { PAYMENT_AMOUNT_CENTS } = require('../src/services/typebot-payment.constants');

function makeSession(paymentPatch = {}) {
  return {
    id: 'wa-1',
    phone: '5511985485777',
    bsuid: null,
    metadata: {
      typebot_payment: {
        token: 'tok-1',
        payment_status: 'pending',
        status: 'pending',
        checkout_session_id: 'cs_test_123',
        checkout_url: 'https://checkout.stripe.com/pay/cs_test_123',
        typebot_session_id: 'tb-session-1',
        amount_cents: PAYMENT_AMOUNT_CENTS,
        amount_label: 'R$ 69,90',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ...paymentPatch
      }
    }
  };
}

async function main() {
  assert.equal(extractIntentId('pi_3TuDxg_secret_xyz'), 'pi_3TuDxg');
  assert.equal(extractIntentId('seti_123_secret_x'), null);

  let claimCalls = 0;
  const notPaid = await completePaymentByToken('tok-1', {
    session: makeSession(),
    refreshPaymentStatus: async () => ({ ok: true, paymentStatus: 'pending' }),
    claimFlowResume: async () => { claimCalls += 1; return true; },
    callTypebot: async () => { throw new Error('não deveria continuar sem pagamento'); }
  });
  assert.deepEqual({ ok: notPaid.ok, code: notPaid.code }, { ok: false, code: 'NOT_PAID' });
  assert.equal(claimCalls, 0);

  const typebotCalls = [];
  const sent = [];
  const success = await completePaymentByToken('tok-1', {
    session: makeSession(),
    refreshPaymentStatus: async () => ({ ok: true, paymentStatus: 'paid' }),
    claimFlowResume: async () => true,
    callTypebot: async (path, body) => {
      typebotCalls.push({ path, body });
      return {
        sessionId: 'tb-session-1',
        messages: [{ type: 'text', content: { plainText: 'Quantos medicamentos deseja renovar?' } }],
        input: { id: 'w97ho902ina4lg7b6dn0sycw', type: 'choice input' }
      };
    },
    provider: {
      sendTextMessage: async (payload) => { sent.push(payload); return { providerMessageId: `m-${sent.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({}),
      sendCtaUrlMessage: async () => ({})
    }
  });
  assert.equal(success.ok, true);
  assert.equal(typebotCalls.length, 1);
  assert.equal(typebotCalls[0].body.message.text, PAYMENT_SUCCESS_REPLY);
  assert.match(sent[0].text, /Pagamento confirmado/);

  const already = await completePaymentByToken('tok-1', {
    session: makeSession({ flow_resumed: true, payment_status: 'paid', status: 'completed' }),
    callTypebot: async () => { throw new Error('não deveria continuar de novo'); }
  });
  assert.deepEqual({ ok: already.ok, alreadyCompleted: already.alreadyCompleted }, { ok: true, alreadyCompleted: true });

  const raced = await completePaymentByToken('tok-1', {
    session: makeSession(),
    refreshPaymentStatus: async () => ({ ok: true, paymentStatus: 'paid' }),
    claimFlowResume: async () => false,
    callTypebot: async () => { throw new Error('perdedor da corrida não continua o flow'); }
  });
  assert.deepEqual({ ok: raced.ok, alreadyCompleted: raced.alreadyCompleted }, { ok: true, alreadyCompleted: true });

  let reverted = 0;
  await assert.rejects(
    completePaymentByToken('tok-1', {
      session: makeSession(),
      refreshPaymentStatus: async () => ({ ok: true, paymentStatus: 'paid' }),
      claimFlowResume: async () => true,
      revertFlowResume: async () => { reverted += 1; },
      createIntegrationError: async () => {},
      provider: {
        sendTextMessage: async () => ({ providerMessageId: 'm-1' }),
        sendButtonMessage: async () => ({}),
        sendListMessage: async () => ({}),
        sendCtaUrlMessage: async () => ({})
      },
      callTypebot: async () => { throw new Error('viewer indisponível'); }
    }),
    /viewer indisponível/
  );
  assert.equal(reverted, 1);

  const webhookApplied = await applyCheckoutWebhook({
    id: 'evt_1',
    data: {
      object: {
        id: 'cs_test_123',
        payment_status: 'paid',
        status: 'complete',
        amount_total: PAYMENT_AMOUNT_CENTS,
        metadata: { payment_token: 'tok-1' }
      }
    }
  }, {
    findSessionByPaymentToken: async () => makeSession(),
    findSessionByCheckoutSessionId: async () => makeSession(),
    markPaymentStatus: async () => {}
  });
  assert.equal(webhookApplied.ok, true);
  assert.equal(webhookApplied.justPaid, true);

  const duplicateWebhook = await applyCheckoutWebhook({
    id: 'evt_2',
    data: {
      object: {
        id: 'cs_test_123',
        payment_status: 'paid',
        status: 'complete',
        amount_total: PAYMENT_AMOUNT_CENTS,
        metadata: { payment_token: 'tok-1' }
      }
    }
  }, {
    findSessionByPaymentToken: async () => makeSession({ payment_status: 'paid', status: 'completed' })
  });
  assert.equal(duplicateWebhook.alreadyPaid, true);

  console.log(JSON.stringify({
    unpaidBlocksContinuation: 'ok',
    paidContinuesSameTypebotSession: 'ok',
    flowResumeIsIdempotent: 'ok',
    raceLoserDoesNotDuplicate: 'ok',
    failureAfterClaimRevertsFlowResume: 'ok',
    webhookMarksPaidWithAmountValidation: 'ok',
    duplicateWebhookIsIdempotent: 'ok'
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });
