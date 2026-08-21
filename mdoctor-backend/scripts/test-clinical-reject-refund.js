#!/usr/bin/env node
/**
 * Valida em staging a rota de reprovação médica com estorno Stripe:
 *   1. cria PaymentIntent de teste (test mode) e confirma com pm_card_visa;
 *   2. cria atendimento com stripe_payment.payment_intent vinculado;
 *   3. reprova → espera estorno succeeded + refund_id + memed_bloqueado;
 *   4. reprova de novo → espera duplicate:true e nenhum refund novo no Stripe;
 *   5. atendimento sem pagamento vinculado → espera estorno payment_not_found.
 *
 * Uso:
 *   BASE_URL=... MEDICO_USER=... MEDICO_PASS=... STRIPE_SECRET_KEY=sk_test_... \
 *     node scripts/test-clinical-reject-refund.js
 *
 * Exige chave Stripe de TESTE (sk_test_). Recusa rodar com chave live.
 */

const BASE_URL = String(process.env.BASE_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const STRIPE_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim();
const MEDICO_USER = String(process.env.MEDICO_USER || '').trim();
const MEDICO_PASS = String(process.env.MEDICO_PASS || '').trim();
const TEST_PHONE = String(process.env.TEST_PHONE || '5511990000042').trim();

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
}

async function stripeApi(path, params = null) {
  const options = {
    method: params ? 'POST' : 'GET',
    headers: { Authorization: `Basic ${Buffer.from(`${STRIPE_KEY}:`).toString('base64')}` }
  };
  if (params) {
    options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = new URLSearchParams(params).toString();
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Stripe ${path}: ${data?.error?.message || response.status}`);
  }
  return data;
}

async function backendApi(path, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function main() {
  if (!STRIPE_KEY.startsWith('sk_test_')) {
    throw new Error('STRIPE_SECRET_KEY precisa ser chave de TESTE (sk_test_). Abortando.');
  }
  if (!MEDICO_USER || !MEDICO_PASS) {
    throw new Error('MEDICO_USER/MEDICO_PASS obrigatórios.');
  }

  const login = await backendApi('/api/auth/login', {
    method: 'POST',
    body: { username: MEDICO_USER, password: MEDICO_PASS }
  });
  const token = login.data?.token || login.data?.access_token;
  if (!token) throw new Error(`Login falhou: ${JSON.stringify(login.data)}`);

  // 1. Pagamento de teste real (test mode)
  const intent = await stripeApi('/payment_intents', {
    amount: '4990',
    currency: 'brl',
    confirm: 'true',
    payment_method: 'pm_card_visa',
    'automatic_payment_methods[enabled]': 'true',
    'automatic_payment_methods[allow_redirects]': 'never',
    'metadata[teste]': 'reject-refund-e2e'
  });
  record('pagamento de teste confirmado', intent.status === 'succeeded', intent.id);

  // 2. Atendimento vinculado ao pagamento
  const createPaid = await backendApi('/api/atendimentos', {
    method: 'POST',
    token,
    body: {
      paciente_nome: 'Teste Estorno Reprovacao',
      paciente_telefone: TEST_PHONE,
      condicao: 'hipertensao',
      medicacao_em_uso: 'losartana 50mg',
      pagamento: true,
      dados_clinicos: {
        teste_e2e: 'reject-refund',
        stripe_payment: {
          payment_intent: intent.id,
          confirmed_at: new Date().toISOString()
        }
      }
    }
  });
  const paidId = createPaid.data?.atendimento?.id;
  record('atendimento com pagamento vinculado criado', Boolean(paidId), paidId);

  // 3. Reprovação → estorno
  const reject1 = await backendApi(`/api/atendimentos/${paidId}/clinical/reject`, {
    method: 'POST',
    token,
    body: { reason_code: 'FORA_DO_PROTOCOLO', observacao_medica: 'Teste controlado de estorno' }
  });
  const estorno1 = reject1.data?.estorno || {};
  record(
    'reprovação retorna estorno iniciado',
    reject1.status === 200 && estorno1.status === 'succeeded' && Boolean(estorno1.refund_id),
    `status=${estorno1.status} refund=${estorno1.refund_id || 'nenhum'}`
  );
  record(
    'status do atendimento = rejected + memed bloqueado',
    String(reject1.data?.atendimento?.status).toLowerCase() === 'rejected' &&
      reject1.data?.atendimento?.dados_clinicos?.memed_bloqueado === true
  );
  record(
    'notificação ao paciente enviada via provider real',
    reject1.data?.notification?.sent === true,
    `provider=${reject1.data?.notification?.provider} msg=${reject1.data?.notification?.providerMessageId || '-'}`
  );

  // 4. Duplo clique → sem novo estorno
  const reject2 = await backendApi(`/api/atendimentos/${paidId}/clinical/reject`, {
    method: 'POST',
    token,
    body: { reason_code: 'FORA_DO_PROTOCOLO' }
  });
  record(
    'segunda reprovação é idempotente (duplicate)',
    reject2.status === 200 && reject2.data?.duplicate === true,
    `estorno=${reject2.data?.estorno?.status}`
  );

  const refunds = await stripeApi(`/refunds?payment_intent=${intent.id}&limit=10`);
  record(
    'Stripe registra exatamente 1 refund para o pagamento',
    Array.isArray(refunds.data) && refunds.data.length === 1,
    `refunds=${refunds.data.length}`
  );

  // 5. Atendimento sem pagamento localizável
  const createUnpaid = await backendApi('/api/atendimentos', {
    method: 'POST',
    token,
    body: {
      paciente_nome: 'Teste Estorno Sem Pagamento',
      paciente_telefone: TEST_PHONE,
      condicao: 'hipertensao',
      medicacao_em_uso: 'losartana 50mg',
      pagamento: true,
      dados_clinicos: { teste_e2e: 'reject-refund-sem-pagamento' }
    }
  });
  const unpaidId = createUnpaid.data?.atendimento?.id;
  const reject3 = await backendApi(`/api/atendimentos/${unpaidId}/clinical/reject`, {
    method: 'POST',
    token,
    body: { reason_code: 'FORA_DO_PROTOCOLO' }
  });
  record(
    'sem pagamento vinculado → estorno payment_not_found e reprovação mantida',
    reject3.status === 200 &&
      reject3.data?.estorno?.status === 'payment_not_found' &&
      String(reject3.data?.atendimento?.status).toLowerCase() === 'rejected',
    `estorno=${reject3.data?.estorno?.status}`
  );

  console.log('\natendimentos de teste criados:', paidId, unpaidId);
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error('ERRO:', error.message);
  process.exit(1);
});
