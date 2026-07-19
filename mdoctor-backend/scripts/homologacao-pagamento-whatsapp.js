/**
 * Homologação do bloco Pagamento (WhatsApp bridge + serviço).
 * Estados: pendente, aprovado, cancelado, reabertura sem cobrança duplicada, webhook repetido.
 */
const assert = require('assert');
const {
  applyCheckoutWebhook,
  completePaymentByToken,
  createPaymentLinkForSession,
  handlePaymentChoice,
  paymentFromSession,
  refreshPaymentStatus
} = require('../src/services/typebot-payment-link.service');
const { PAYMENT_AMOUNT_CENTS, PRE_PAYMENT_MESSAGE } = require('../src/services/typebot-payment.constants');

function session(paymentPatch = {}) {
  return {
    id: 'wa-homolog',
    phone: '5511987654321',
    bsuid: null,
    metadata: {
      typebot_payment: {
        token: 'tok-h',
        payment_status: 'pending',
        status: 'pending',
        checkout_session_id: 'cs_homolog_1',
        checkout_url: 'https://checkout.stripe.com/c/pay/cs_homolog_1',
        typebot_session_id: 'tb-homolog',
        amount_cents: PAYMENT_AMOUNT_CENTS,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        ...paymentPatch
      }
    }
  };
}

async function main() {
  const report = { estados: {}, ok: true };

  // 1) Abertura / pendente
  const pendingCheck = await refreshPaymentStatus('tok-h', {
    session: session(),
    stripe: {
      checkout: {
        sessions: {
          retrieve: async () => ({ status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/x' })
        }
      }
    }
  });
  assert.equal(pendingCheck.paymentStatus, 'pending');
  report.estados.pendente = 'ok';

  // 2) Cancelado
  const cancelledMsgs = [];
  const cancel = await handlePaymentChoice({
    text: 'Cancelar e continuar depois',
    session: session(),
    correlationId: 'homolog-cancel',
    provider: { sendTextMessage: async (p) => { cancelledMsgs.push(p.text); return {}; } },
    deps: {
      markPaymentStatus: async (s, status) => {
        s.metadata.typebot_payment.payment_status = status;
      }
    }
  });
  assert.equal(cancel.action, 'cancelled');
  report.estados.cancelado = 'ok';

  // 3) Aprovado via webhook + continuidade
  const paidSession = session();
  await applyCheckoutWebhook({
    id: 'evt_homolog_1',
    data: {
      object: {
        id: 'cs_homolog_1',
        payment_status: 'paid',
        status: 'complete',
        amount_total: PAYMENT_AMOUNT_CENTS,
        metadata: { payment_token: 'tok-h' }
      }
    }
  }, {
    findSessionByPaymentToken: async () => paidSession,
    markPaymentStatus: async (s, status, extra) => {
      s.metadata.typebot_payment = { ...s.metadata.typebot_payment, payment_status: status, ...extra };
    }
  });

  const typebotCalls = [];
  const approved = await completePaymentByToken('tok-h', {
    session: paidSession,
    refreshPaymentStatus: async () => ({ ok: true, paymentStatus: 'paid' }),
    claimFlowResume: async () => true,
    callTypebot: async (path, body) => {
      typebotCalls.push({ path, body });
      return {
        messages: [{ type: 'text', content: { plainText: 'Quantos medicamentos deseja renovar?' } }],
        input: { id: 'med-count', type: 'choice input' }
      };
    },
    provider: {
      sendTextMessage: async () => ({ providerMessageId: 'm1' }),
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({}),
      sendCtaUrlMessage: async () => ({})
    }
  });
  assert.equal(approved.ok, true);
  assert.match(typebotCalls[0].path, /tb-homolog/);
  report.estados.aprovado = 'ok';

  // 4) Reabertura sem nova cobrança quando já paid
  let checkoutCreates = 0;
  const reopenPaid = await handlePaymentChoice({
    text: 'Abrir pagamento novamente',
    session: session({ payment_status: 'paid', status: 'completed', flow_resumed: true }),
    correlationId: 'homolog-reopen-paid',
    provider: {
      sendTextMessage: async () => ({}),
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({}),
      sendCtaUrlMessage: async () => ({})
    },
    deps: {
      createPaymentLinkForSession: async () => { checkoutCreates += 1; return { alreadyPaid: true, token: 'tok-h' }; },
      completePaymentByToken: async () => ({ ok: true, alreadyCompleted: true })
    }
  });
  assert.equal(reopenPaid.action, 'already_paid');
  assert.equal(checkoutCreates, 0);
  report.estados.reabertura_sem_cobranca_duplicada = 'ok';

  // 5) Webhook repetido idempotente
  const dup = await applyCheckoutWebhook({
    id: 'evt_homolog_dup',
    data: {
      object: {
        id: 'cs_homolog_1',
        payment_status: 'paid',
        status: 'complete',
        amount_total: PAYMENT_AMOUNT_CENTS,
        metadata: { payment_token: 'tok-h' }
      }
    }
  }, {
    findSessionByPaymentToken: async () => session({ payment_status: 'paid', status: 'completed' })
  });
  assert.equal(dup.alreadyPaid, true);
  report.estados.webhook_repetido = 'ok';

  assert(PRE_PAYMENT_MESSAGE.includes('R$ 69,90'));
  report.mensagem_institucional = 'ok';

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
