/**
 * Verifica no backend staging remoto se rotas da PR #20 (pagamento bridge)
 * e PR #24 (upload status) estão ativas.
 *
 * Uso: node mdoctor-backend/scripts/probe-staging-payment-bridge.js
 */

const BASE = String(process.env.BACKEND_URL_STAGING || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');

async function probe(label, fn) {
  try {
    const result = await fn();
    return { label, ok: true, ...result };
  } catch (error) {
    return { label, ok: false, error: error.message };
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

async function main() {
  const checks = [];

  checks.push(await probe('health', async () => {
    const { status, data } = await get('/health');
    return { status, service: data?.service };
  }));

  checks.push(await probe('typebot_payment_checkout_route', async () => {
    const { status, data } = await get('/api/typebot-payment/probe-token/checkout');
    // PR #20+: JSON { success, code } — legado retornava HTML/Stripe.js ou 404 genérico
    const modern = data && typeof data === 'object' && 'code' in data;
    return { status, modern, body: data };
  }));

  checks.push(await probe('typebot_payment_status_route', async () => {
    const { status, data } = await get('/api/typebot-payment/probe-token/status');
    const modern = data?.error === 'Link de pagamento não encontrado';
    return { status, modern, body: data };
  }));

  checks.push(await probe('typebot_payment_page_js', async () => {
    const res = await fetch(`${BASE}/api/typebot-payment/page.js`);
    const text = await res.text();
    const modern = text.includes('checkout') && text.includes('webhook Stripe');
    return { status: res.status, modern, snippet: text.slice(0, 120).replace(/\s+/g, ' ') };
  }));

  checks.push(await probe('stripe_webhook_route', async () => {
    const { status, data } = await post('/api/webhooks/stripe', {});
    // 400 assinatura inválida = rota + secrets configurados; 503 = secrets ausentes
    return { status, configured: status === 400 && /Assinatura/i.test(data?.error || ''), body: data };
  }));

  checks.push(await probe('prescription_upload_status_route', async () => {
    const { status, data } = await get('/api/atendimentos/00000000-0000-0000-0000-000000000001/prescription-upload/status');
    const modern = data?.code === 'ATENDIMENTO_NOT_FOUND';
    return { status, modern, body: data };
  }));

  const backendModern =
    checks.find((c) => c.label === 'typebot_payment_checkout_route')?.modern &&
    checks.find((c) => c.label === 'stripe_webhook_route')?.configured &&
    checks.find((c) => c.label === 'prescription_upload_status_route')?.modern;

  const report = {
    base: BASE,
    checkedAt: new Date().toISOString(),
    backendHasPr20Routes: Boolean(backendModern),
    checks,
    interpretation: backendModern
      ? 'Backend staging parece ter PR #20/#24 deployadas. Se o WhatsApp ainda falha, verifique Typebot publicado + TYPEBOT_VIEWER_URL + WHATSAPP_* + webhook Stripe apontando para /api/webhooks/stripe.'
      : 'Backend staging ainda parece legado — dispare redeploy do serviço mdoctor-backend-staging a partir do main atual.'
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(backendModern ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
