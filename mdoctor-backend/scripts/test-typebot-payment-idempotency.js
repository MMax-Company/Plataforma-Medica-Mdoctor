// Fase 2 pedido 2 — testes isolados (sem rede/Stripe/banco reais) das
// garantias centrais do pagamento WhatsApp/Typebot: webhook único confirma,
// evento repetido não repete mensagem/retomada, e Typebot não confirma
// pagamento sozinho. Usa as próprias funções de produção via injeção de
// dependências que o serviço já expõe (deps), sem mocks do módulo inteiro.
const assert = require('assert');
const {
  applyCheckoutWebhook,
  completePaymentByToken,
  stripeSessionIsPaid
} = require('../src/services/typebot-payment-link.service');

function makeSession(overrides = {}) {
  return {
    id: 'wa-session-1',
    phone: '5511999990001',
    bsuid: null,
    metadata: {
      typebot_payment: {
        token: 'tok-abc',
        payment_status: 'pending',
        status: 'pending',
        checkout_session_id: 'cs_test_123',
        typebot_session_id: 'typebot-sess-1',
        amount_cents: 4990,
        amount_label: 'R$ 49,90',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        ...overrides
      }
    }
  };
}

function stripeCheckoutEvent({ id = 'evt_1', sessionId = 'cs_test_123', token = 'tok-abc', paymentStatus = 'paid', amountTotal = 4990, currency = 'brl', status = 'complete' } = {}) {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        status,
        payment_status: paymentStatus,
        amount_total: amountTotal,
        currency,
        metadata: { payment_token: token }
      }
    }
  };
}

async function main() {
  const results = {};

  // 1) stripeSessionIsPaid: só aceita payment_status=paid + valor exato + BRL.
  assert.equal(stripeSessionIsPaid({ payment_status: 'paid', amount_total: 4990, currency: 'brl' }), true);
  assert.equal(stripeSessionIsPaid({ payment_status: 'unpaid', amount_total: 4990, currency: 'brl' }), false, 'Typebot/cliente dizendo "paid" sem o Stripe confirmar não basta');
  assert.equal(stripeSessionIsPaid({ payment_status: 'paid', amount_total: 100, currency: 'brl' }), false, 'valor divergente não confirma');
  assert.equal(stripeSessionIsPaid({ payment_status: 'paid', amount_total: 4990, currency: 'usd' }), false, 'moeda divergente não confirma');
  assert.equal(stripeSessionIsPaid({ status: 'complete', payment_status: 'unpaid', amount_total: 4990, currency: 'brl' }), false, 'status=complete sozinho, sem payment_status=paid, não confirma');
  results.somenteStripeValidoConfirma = 'ok';

  // 2) applyCheckoutWebhook: webhook válido confirma e marca payment_status=paid.
  {
    const session = makeSession();
    const marked = [];
    const result = await applyCheckoutWebhook(stripeCheckoutEvent(), {
      findSessionByPaymentToken: async () => session,
      markPaymentStatus: async (s, status, extra) => { marked.push({ status, extra }); s.metadata.typebot_payment.payment_status = status; },
      recordStripePaymentEvent: async () => ({ duplicate: false, payment: { id: 'fake-payment-1' }, paymentEvent: { id: 'fake-event-1' } })
    });
    assert.equal(result.ok, true);
    assert.equal(result.justPaid, true);
    assert.equal(marked.length, 1);
    assert.equal(marked[0].status, 'paid');
    assert.equal(marked[0].extra.stripe_event_id, 'evt_1');
    results.webhookValidoConfirma = 'ok';
  }

  // 3) applyCheckoutWebhook: webhook com payment_status != paid NÃO confirma.
  {
    const session = makeSession();
    let markCalls = 0;
    const result = await applyCheckoutWebhook(stripeCheckoutEvent({ paymentStatus: 'unpaid' }), {
      findSessionByPaymentToken: async () => session,
      markPaymentStatus: async () => { markCalls += 1; }
    });
    assert.equal(result.ok, false);
    assert.equal(markCalls, 0, 'webhook inválido não pode marcar como pago');
    results.webhookInvalidoNaoConfirma = 'ok';
  }

  // 4) applyCheckoutWebhook: evento repetido para uma sessão já paga não
  //    marca de novo (idempotência a nível do estado da sessão).
  {
    const session = makeSession({ payment_status: 'paid', status: 'completed' });
    let markCalls = 0;
    const result = await applyCheckoutWebhook(stripeCheckoutEvent(), {
      findSessionByPaymentToken: async () => session,
      markPaymentStatus: async () => { markCalls += 1; }
    });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyPaid, true);
    assert.equal(markCalls, 0);
    results.eventoRepetidoNaoRemarcaPago = 'ok';
  }

  // 5) completePaymentByToken: primeira chamada retoma (envia confirmação +
  //    continua o Typebot); chamadas subsequentes (mesmo evento reentregue,
  //    ou clique duplo) não repetem nem mensagem nem retomada.
  {
    const session = makeSession({ payment_status: 'paid', status: 'completed', flow_resumed: false });
    const sentMessages = [];
    const typebotCalls = [];
    let resumeClaims = 0;
    const claimedFlag = { value: false };
    const result1 = await completePaymentByToken('tok-abc', {
      session,
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: async () => {
        resumeClaims += 1;
        if (claimedFlag.value) return false;
        claimedFlag.value = true;
        return true;
      },
      callTypebot: async (path, body) => { typebotCalls.push({ path, body }); return { input: { id: 'grp_foto_receita_input' }, messages: [] }; },
      convertTypebotResponse: () => [],
      provider: { sendTextMessage: async (payload) => { sentMessages.push(payload); return { providerMessageId: `m-${sentMessages.length}` }; } },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    });
    assert.equal(result1.ok, true);
    assert.equal(result1.alreadyCompleted, undefined);
    assert.equal(sentMessages.length, 1, 'envia a confirmação de pagamento uma única vez');
    assert(sentMessages[0].text.includes('Pagamento confirmado com sucesso'));
    assert(sentMessages[0].text.includes('Agora envie sua receita médica anterior pelo WhatsApp'));
    assert.equal(typebotCalls.length, 1);
    assert(typebotCalls[0].path.includes('/sessions/typebot-sess-1/continueChat'), 'retoma a MESMA sessão clínica');

    // Segunda chamada: mesmo token, claim já usado -> não reenvia nem retoma de novo.
    const result2 = await completePaymentByToken('tok-abc', {
      session,
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: async () => {
        resumeClaims += 1;
        return false; // já reclamado por outra chamada/evento
      },
      callTypebot: async (path, body) => { typebotCalls.push({ path, body }); return { input: {}, messages: [] }; },
      convertTypebotResponse: () => [],
      provider: { sendTextMessage: async (payload) => { sentMessages.push(payload); return { providerMessageId: `m-${sentMessages.length}` }; } },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    });
    assert.equal(result2.ok, true);
    assert.equal(result2.alreadyCompleted, true);
    assert.equal(sentMessages.length, 1, 'segunda tentativa não envia mensagem de novo');
    assert.equal(typebotCalls.length, 1, 'segunda tentativa não chama o Typebot de novo (sem retomada duplicada)');
    assert.equal(resumeClaims, 2);
    results.webhookRepetidoNaoRepeteMensagemNemRetomada = 'ok';
  }

  // 6) completePaymentByToken: sessão expirada não confirma nem retoma.
  {
    const session = makeSession({ payment_status: 'pending', expires_at: new Date(Date.now() - 1000).toISOString() });
    const result = await completePaymentByToken('tok-abc', { session });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'EXPIRED');
    results.sessaoExpiradaNaoConfirma = 'ok';
  }

  // 7) completePaymentByToken: pagamento ainda não confirmado pelo Stripe
  //    (mesmo que alguém tente forçar) não retoma.
  {
    const session = makeSession({ payment_status: 'pending' });
    let typebotCalled = false;
    const result = await completePaymentByToken('tok-abc', {
      session,
      refreshPaymentStatus: async () => ({ paymentStatus: 'pending' }),
      callTypebot: async () => { typebotCalled = true; return { input: {}, messages: [] }; }
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'NOT_PAID');
    assert.equal(typebotCalled, false, 'sem confirmação real do Stripe, o Typebot nunca é chamado para retomar');
    results.semConfirmacaoStripeNaoRetoma = 'ok';
  }

  console.log(JSON.stringify(results));
}

main().catch((e) => { console.error('FALHOU:', e.message, e.stack); process.exit(1); });
