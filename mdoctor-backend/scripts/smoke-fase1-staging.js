/**
 * Smoke tests Fase 1 contra staging (n8n + backend).
 */
const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const N8N = String(process.env.N8N_WEBHOOK_URL || 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook').replace(
  /\/$/,
  ''
);
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';

function buildPayload(overrides = {}) {
  const phone = overrides.phone || `5511977${String(Date.now()).slice(-6)}`;
  return {
    patient_name: 'Smoke Fase1',
    whatsapp: phone,
    telefone: phone,
    from: phone,
    cpf: '52998224725',
    birth_date: '09/02/1988',
    email: 'smoke@example.com',
    address: 'Rua Smoke 1',
    cep: '01310100',
    chronic_condition: 'has',
    tempo_uso: 'Mais de 6 meses',
    has_previous_prescription: 'sim',
    sinais_alerta: 'NAO',
    eligibility_status: 'eligible',
    pagamento_status: 'paid',
    primeiro_medicamento: 'metformina 850 tomo 2x ao dia',
    ...overrides
  };
}

async function postBackendWebhook(body) {
  const phone = body.whatsapp || body.from;
  const headers = {
    'Content-Type': 'application/json',
    'X-MDoctor-Webhook-Secret': SECRET,
    'Idempotency-Key': `smoke-${phone}-${Date.now()}`
  };
  const payload = {
    from: phone,
    text: body.text || `Smoke ${body.patient_name}`,
    rawMessage: {
      provider: 'typebot',
      messageId: headers['Idempotency-Key'],
      channel: 'whatsapp',
      source: 'staging',
      original: body
    }
  };
  const res = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function postN8n(body) {
  const headers = { 'Content-Type': 'application/json' };
  if (SECRET) headers['X-MDoctor-Webhook-Secret'] = SECRET;
  const res = await fetch(N8N, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, emptyBody: !text };
}

async function main() {
  if (!SECRET) {
    console.error('N8N_WEBHOOK_SECRET is required for staging smoke tests');
    process.exit(1);
  }

  const report = [];

  const health = await fetch(`${BACKEND}/health`);
  report.push({ test: 'backend_health', ok: health.ok, status: health.status });

  const paid = await postBackendWebhook(buildPayload());
  const paidAtendimento = paid.data?.atendimento;
  report.push({
    test: 'backend_eligible_paid_awaiting_upload',
    ok:
      paid.status < 400 &&
      paidAtendimento?.status === 'awaiting_prescription_upload' &&
      paid.data?.decision?.eligible === true &&
      Boolean(paid.data?.upload_url),
    status: paid.status,
    atendimentoStatus: paidAtendimento?.status,
    pagamento: paidAtendimento?.pagamento_status
  });

  const unpaid = await postBackendWebhook(buildPayload({ pagamento_status: 'pending', payment_status: 'unpaid' }));
  const unpaidAt = unpaid.data?.atendimento;
  report.push({
    test: 'backend_unpaid_rejected',
    ok: unpaid.status < 400 && unpaidAt?.status === 'rejected',
    status: unpaid.status,
    atendimentoStatus: unpaidAt?.status
  });

  const noPhoto = await postBackendWebhook(buildPayload({ has_previous_prescription: false, receita_anterior: false }));
  const noPhotoAt = noPhoto.data?.atendimento;
  report.push({
    test: 'backend_no_rx_proof_rejected',
    ok: noPhoto.status < 400 && noPhotoAt?.status === 'rejected',
    atendimentoStatus: noPhotoAt?.status
  });

  const n8nPing = await postN8n(buildPayload());
  report.push({
    test: 'n8n_typebot_webhook_reachable',
    ok: n8nPing.status === 200,
    status: n8nPing.status,
    emptyBody: n8nPing.emptyBody
  });

  console.log(JSON.stringify({ success: report.every((r) => r.ok), report }, null, 2));
  if (!report.every((r) => r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
