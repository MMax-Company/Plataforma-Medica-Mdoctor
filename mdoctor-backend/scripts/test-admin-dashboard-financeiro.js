// Teste offline (17/10/2026) do indicador financeiro do painel admin, após a
// auditoria encontrar 2 atendimentos reais (não-teste) com payment_status
// CONFIRMADO sem clinical_data.stripe_amount_cents/stripe_payment/
// typebot_payment registrado. A tabela `payments` (fonte Stripe) tinha o
// valor real desses dois (R$ 69,90 cada, via phone+paid_at casando com o
// appointment) — diferente do preço vigente (R$ 49,90) — confirmando que
// usar o preço atual como fallback teria fabricado um valor histórico
// incorreto. Por isso computeFinanceiro() não tem mais fallback nenhum: um
// atendimento pago sem snapshot some da receita somada e aparece só em
// atendimentos_sem_valor_registrado.
const assert = require('assert');
const path = require('path');

const routesPath = path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js');
const { computeFinanceiro } = require(routesPath);

function baseAtendimento(overrides = {}) {
  return {
    id: `atd-${Math.random().toString(36).slice(2, 10)}`,
    status: 'delivered',
    pagamento_status: 'CONFIRMADO',
    dados_clinicos: {},
    ...overrides,
  };
}

const results = {};

// 1) Atendimento pago com stripe_amount_cents registrado entra na receita
//    somada normalmente.
{
  const a = baseAtendimento({ dados_clinicos: { stripe_amount_cents: 4990 } });
  const fin = computeFinanceiro([a]);
  assert.equal(fin.atendimentos_pagos, 1);
  assert.equal(fin.atendimentos_sem_valor_registrado, 0);
  assert.equal(fin.receita_total_centavos, 4990);
  results.pagoComValorRegistradoEntraNaReceita = 'ok';
}

// 2) Atendimento pago SEM nenhum snapshot de valor: conta como pago, mas
//    NUNCA usa o preço vigente como se fosse o valor histórico — fica fora
//    da receita somada e é contado em atendimentos_sem_valor_registrado.
{
  const a = baseAtendimento({ dados_clinicos: {} });
  const fin = computeFinanceiro([a]);
  assert.equal(fin.atendimentos_pagos, 1);
  assert.equal(fin.atendimentos_sem_valor_registrado, 1);
  assert.equal(fin.receita_total_centavos, 0, 'nunca deve fabricar valor com o preço vigente');
  results.pagoSemValorNuncaUsaPrecoVigenteComoFallback = 'ok';
}

// 3) Mistura: 1 com valor registrado + 1 sem — receita soma só o registrado,
//    e o total de "pagos" conta os dois.
{
  const comValor = baseAtendimento({ dados_clinicos: { stripe_amount_cents: 6990 } });
  const semValor = baseAtendimento({ dados_clinicos: {} });
  const fin = computeFinanceiro([comValor, semValor]);
  assert.equal(fin.atendimentos_pagos, 2);
  assert.equal(fin.atendimentos_sem_valor_registrado, 1);
  assert.equal(fin.receita_total_centavos, 6990);
  results.misturaDeComESemValorSomaApenasOConfirmado = 'ok';
}

// 4) Atendimento não pago nunca entra em nenhuma das contagens financeiras.
{
  const naoPago = baseAtendimento({ pagamento_status: 'PENDENTE', dados_clinicos: {} });
  const fin = computeFinanceiro([naoPago]);
  assert.equal(fin.atendimentos_pagos, 0);
  assert.equal(fin.atendimentos_sem_valor_registrado, 0);
  assert.equal(fin.receita_total_centavos, 0);
  results.naoPagoNuncaEntraNasContagens = 'ok';
}

// 5) stripe_payment.amount_cents e typebot_payment.amount_cents continuam
//    valendo como fontes de valor registrado (ordem de precedência mantida).
{
  const viaStripePayment = baseAtendimento({ dados_clinicos: { stripe_payment: { amount_cents: 5500 } } });
  const viaTypebotPayment = baseAtendimento({ dados_clinicos: { typebot_payment: { amount_cents: 6000 } } });
  const fin = computeFinanceiro([viaStripePayment, viaTypebotPayment]);
  assert.equal(fin.atendimentos_sem_valor_registrado, 0);
  assert.equal(fin.receita_total_centavos, 11500);
  results.fontesAlternativasDeValorContinuamFuncionando = 'ok';
}

console.log(JSON.stringify(results, null, 2));
