// Pedido 02/08/2026 (item 4 dos testes offline): Checkout Session criado
// pelo fluxo WhatsApp/Typebot deve conter cartão E Pix simultaneamente
// (payment_method_types), com o Pix expirando em 30 minutos
// (payment_method_options.pix.expires_after_seconds === 1800), mantendo
// valor, moeda e demais campos do fluxo de cartão sem regressão.
//
// createCheckoutSession (typebot-payment-link.service.js) não é exportado —
// é testado indiretamente através das duas funções públicas que a chamam:
// createPaymentLinkForSession (link novo) e resolveCheckoutRedirect
// (reabertura). O cliente Stripe real (`require('stripe')`) é dublado via
// require.cache, já que getStripe() o resolve internamente por
// process.env.STRIPE_SECRET_KEY — não é passado por injeção como em
// stripe-refund.service.js.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

process.env.STRIPE_SECRET_KEY = 'sk_test_offline_fake_key_for_this_test_only';
process.env.PUBLIC_BASE_URL = 'https://doctorprescreve.example.com';

const base = path.join(__dirname, '..', 'src', 'services', 'typebot-payment-link.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

let upsertCalls = [];
let sessionsCreateCalls = [];
let sessionsRetrieveResult = null;

stub(resolveFrom('../db/tables'), { WHATSAPP_SESSIONS: 'whatsapp_sessions' });
stub(resolveFrom('../db/persistence'), { dbQuery: async () => null });
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  upsertSessionIdentity: async (args) => {
    upsertCalls.push(args);
    return {};
  },
  getSessionByPhone: async () => null
});
stub(resolveFrom('../store/integration-logs.store'), { createIntegrationError: async () => {} });
stub(resolveFrom('../store/payments.store'), {
  recordStripePaymentEvent: async () => {},
  deletePaymentEvent: async () => {}
});
stub(resolveFrom('./providers/meta.provider'), {});

// Dubla o pacote npm 'stripe' inteiro (não é injetado por parâmetro nesta
// função — getStripe() faz require('stripe')(secretKey) internamente).
// require.resolve('stripe') a partir deste script resolve para o mesmo
// node_modules/stripe que o serviço usa (mesma árvore, mdoctor-backend/).
function fakeStripeFactory(secretKey) {
  fakeStripeFactory.lastSecretKey = secretKey;
  return {
    checkout: {
      sessions: {
        create: async (params) => {
          sessionsCreateCalls.push(params);
          return { id: `cs_test_fake_${sessionsCreateCalls.length}`, url: 'https://checkout.stripe.com/fake-session' };
        },
        retrieve: async () => sessionsRetrieveResult
      }
    }
  };
}
stub('stripe', fakeStripeFactory);

delete require.cache[require.resolve(base)];
const { createPaymentLinkForSession, resolveCheckoutRedirect } = require(base);

function resetState() {
  upsertCalls = [];
  sessionsCreateCalls = [];
  sessionsRetrieveResult = null;
}

async function main() {
  const results = {};

  // 1) Criação de link novo (createPaymentLinkForSession -> createCheckoutSession):
  //    cartão E Pix habilitados, cartão primeiro na lista, Pix expira em
  //    1800s (30 min), valor/moeda mantidos em R$49,90/BRL — sem regressão
  //    no fluxo de cartão.
  {
    resetState();
    const link = await createPaymentLinkForSession({
      identity: { phone: '5511999990000', bsuid: 'bsuid-1' },
      typebotSessionId: 'tb-session-1',
      runtimeOptions: {},
      existingSession: null
    });

    assert.equal(sessionsCreateCalls.length, 1);
    const params = sessionsCreateCalls[0];

    assert.deepEqual(params.payment_method_types, ['card', 'pix'], 'cartão e Pix habilitados simultaneamente, cartão primeiro');
    assert(params.payment_method_options, 'payment_method_options presente');
    assert(params.payment_method_options.pix, 'opções de Pix presentes');
    assert.equal(params.payment_method_options.pix.expires_after_seconds, 1800, 'Pix expira em exatamente 30 minutos (1800s)');

    assert.equal(params.mode, 'payment');
    assert.equal(params.line_items[0].price_data.unit_amount, 4990, 'valor mantido em R$49,90 (4990 centavos)');
    assert.equal(params.line_items[0].price_data.currency, 'brl', 'moeda mantida em BRL');
    assert.equal(params.line_items.length, 1);
    assert.equal(params.metadata.payment_token, link.token, 'metadata do checkout carrega o mesmo token do link');
    assert.equal(params.metadata.typebot_session_id, 'tb-session-1');
    assert(params.success_url.includes('{CHECKOUT_SESSION_ID}'), 'success_url mantém o placeholder de session id');

    assert.equal(link.paymentStatus, 'pending');
    assert(link.checkoutUrl, 'URL de checkout retornada');
    assert.equal(upsertCalls.length, 1, 'sessão do WhatsApp é persistida com o registro de pagamento pendente');
    assert.equal(upsertCalls[0].metadataPatch.typebot_payment.checkout_session_id, 'cs_test_fake_1');

    results.checkoutNovoTemCartaoEPixComExpiracaoDe30Min = 'ok';
  }

  // 2) Reabertura de checkout (resolveCheckoutRedirect -> createCheckoutSession
  //    de novo, pois a sessão anterior não está mais "open"): mesma
  //    configuração de cartão+Pix é aplicada também no caminho de reabertura,
  //    não só na criação inicial.
  {
    resetState();
    const fakeExistingSession = {
      id: 'sess-1',
      phone: '5511999990000',
      metadata: {
        typebot_payment: {
          token: 'tok-reopen-1',
          payment_status: 'pending',
          status: 'pending',
          checkout_session_id: 'cs_old_expired',
          checkout_url: 'https://checkout.stripe.com/old',
          amount_cents: 4990,
          amount_label: 'R$ 49,90',
          typebot_session_id: 'tb-session-2',
          expires_at: new Date(Date.now() + 60_000).toISOString()
        }
      }
    };
    // A sessão antiga (cs_old_expired) não está mais "open" ao ser
    // consultada -> força a criação de uma NOVA Checkout Session.
    sessionsRetrieveResult = { status: 'expired', payment_status: 'unpaid' };

    const result = await resolveCheckoutRedirect('tok-reopen-1', {
      findSessionByPaymentToken: async () => fakeExistingSession
    });

    assert.equal(result.ok, true);
    assert.equal(sessionsCreateCalls.length, 1, 'reabertura cria uma nova Checkout Session quando a anterior não está mais aberta');
    const params = sessionsCreateCalls[0];
    assert.deepEqual(params.payment_method_types, ['card', 'pix'], 'reabertura também mantém cartão+Pix');
    assert.equal(params.payment_method_options.pix.expires_after_seconds, 1800, 'reabertura também mantém a expiração de 30 min do Pix');

    results.reaberturaDeCheckoutTambemMantemCartaoEPix = 'ok';
  }

  // 3) Sanidade: a ordem do array não foi invertida por engano (Pix nunca
  //    deve vir antes de cartão, para não mudar a UI padrão do Checkout
  //    hospedado pela Stripe).
  {
    resetState();
    await createPaymentLinkForSession({
      identity: { phone: '5511999990001', bsuid: 'bsuid-2' },
      typebotSessionId: 'tb-session-3',
      runtimeOptions: {},
      existingSession: null
    });
    assert.equal(sessionsCreateCalls[0].payment_method_types[0], 'card', 'cartão continua sendo o primeiro método exibido');
    assert.equal(sessionsCreateCalls[0].payment_method_types[1], 'pix');
    results.cartaoContinuaComoPrimeiroMetodoNaLista = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
