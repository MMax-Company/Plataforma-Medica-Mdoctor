// Teste offline (17/10/2026) do reenvio de link de pagamento no painel admin.
// Achado da auditoria: o botão só reenviava o link bruto salvo em
// dados_clinicos.stripe_checkout_url, sem checar se a Checkout Session da
// Stripe ainda estava "open" — reenviava link morto quando expirado. Agora
// tryRegeneratePaymentLink() reusa createPaymentLinkForSession (mesma lógica
// já validada do fluxo "abrir pagamento" via WhatsApp). Stripe e WhatsApp
// são 100% mockados aqui via injeção de dependências — nenhuma chamada real.
const assert = require('assert');
const path = require('path');

const routesPath = path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js');
const { tryRegeneratePaymentLink } = require(routesPath);

// tryRegeneratePaymentLink só checa Boolean(process.env.STRIPE_SECRET_KEY) —
// qualquer valor truthy serve pra simular "Stripe configurado" neste teste.
// Deliberadamente NUNCA usa um valor com o formato real de chave da Stripe
// (prefixo de chave secreta de teste/produção), pra não disparar o scanner
// de segredo do CI (scripts/check-ci-secrets.js) com um falso positivo.
const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const FAKE_STRIPE_CONFIGURED_VALUE = 'stripe-configured-placeholder-for-offline-test';
process.env.STRIPE_SECRET_KEY = FAKE_STRIPE_CONFIGURED_VALUE;

const results = {};

function baseAtendimento(overrides = {}) {
  return {
    id: 'atd-resend-1',
    paciente_telefone: '5511988887777',
    dados_clinicos: {},
    ...overrides,
  };
}

async function main() {
  // 1) Sem telefone: nunca tenta regenerar — cannotVerify, sem link.
  {
    const r = await tryRegeneratePaymentLink(baseAtendimento({ paciente_telefone: null }));
    assert.equal(r.regenerated, false);
    assert.equal(r.cannotVerify, true);
    assert.equal(r.link, null);
    assert.equal(r.alreadyPaid, false);
    results.semTelefoneNuncaTentaRegenerar = 'ok';
  }

  // 2) STRIPE_SECRET_KEY não configurada: cannotVerify, nunca chama Stripe.
  {
    delete process.env.STRIPE_SECRET_KEY;
    const r = await tryRegeneratePaymentLink(baseAtendimento());
    assert.equal(r.cannotVerify, true);
    assert.equal(r.regenerated, false);
    process.env.STRIPE_SECRET_KEY = FAKE_STRIPE_CONFIGURED_VALUE;
    results.semStripeConfiguradaCannotVerifyNuncaChamaStripe = 'ok';
  }

  // 3) Sem sessão WhatsApp viva para o telefone: cannotVerify, mantém o
  //    comportamento antigo (fallback pro link estático) sem derrubar nada.
  {
    const r = await tryRegeneratePaymentLink(baseAtendimento(), {
      getSessionByPhone: async () => null,
    });
    assert.equal(r.cannotVerify, true);
    assert.equal(r.regenerated, false);
    results.semSessaoWhatsappCannotVerify = 'ok';
  }

  // 4) Sessão já paga: createPaymentLinkForSession (mockado) retorna
  //    alreadyPaid — nunca deve reenviar nada nem fabricar link.
  {
    const r = await tryRegeneratePaymentLink(baseAtendimento(), {
      getSessionByPhone: async () => ({ phone: '5511988887777', bsuid: 'bsuid-1' }),
      createPaymentLinkForSession: async () => ({ alreadyPaid: true, token: 'tok-paid' }),
    });
    assert.equal(r.alreadyPaid, true);
    assert.equal(r.regenerated, false);
    assert.equal(r.link, null);
    results.sessaoJaPagaNuncaReenviaNadaEMarcaAlreadyPaid = 'ok';
  }

  // 5) Checkout expirado: createPaymentLinkForSession (mockado) simula a
  //    criação de uma NOVA session (sem cobrar nada) e devolve o redirect
  //    novo — regenerated=true, link presente.
  {
    const r = await tryRegeneratePaymentLink(baseAtendimento(), {
      getSessionByPhone: async () => ({ phone: '5511988887777', bsuid: 'bsuid-1' }),
      createPaymentLinkForSession: async ({ existingSession }) => {
        assert.equal(existingSession.phone, '5511988887777');
        return {
          token: 'tok-new',
          checkoutRedirectUrl: 'https://backend.example/api/typebot-payment/tok-new/checkout',
          paymentStatus: 'pending',
        };
      },
    });
    assert.equal(r.regenerated, true);
    assert.equal(r.alreadyPaid, false);
    assert.equal(r.link, 'https://backend.example/api/typebot-payment/tok-new/checkout');
    results.checkoutExpiradoRegeneraSemCobrarDeNovo = 'ok';
  }

  // 6) Falha ao consultar Stripe/sessão (erro simulado): nunca propaga a
  //    falha — cai pro fallback estático com cannotVerify=true.
  {
    const r = await tryRegeneratePaymentLink(baseAtendimento(), {
      getSessionByPhone: async () => ({ phone: '5511988887777', bsuid: 'bsuid-1' }),
      createPaymentLinkForSession: async () => {
        throw new Error('falha simulada na API da Stripe');
      },
    });
    assert.equal(r.cannotVerify, true);
    assert.equal(r.regenerated, false);
    results.falhaNaStripeNuncaPropagaCaiNoFallback = 'ok';
  }

  if (ORIGINAL_STRIPE_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY;

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
