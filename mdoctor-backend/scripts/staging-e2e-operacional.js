/**
 * E2E operacional staging via backend (n8n opcional).
 * Fluxo upload externo: webhook sem arquivo → upload por token → fila médica.
 */
require('./load-dotenv');

const FormData = require('form-data');

const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const N8N = (process.env.N8N_WEBHOOK_URL || 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook').replace(/\/$/, '');
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';
const USER =
  process.env.MEDICO_USER || process.env.MEDICO_OFFICIAL_USER || process.env.MEDICO_ALIAS_USER || '';
const PASS = process.env.MEDICO_PASS || process.env.MEDICO_OFFICIAL_PASS || '';

const report = { steps: [], errors: [] };

async function req(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, data };
}

function step(name, ok, extra = {}) {
  report.steps.push({ name, ok, ...extra });
  if (!ok) report.errors.push(name);
}

async function uploadPdfWithToken(uploadUrl) {
  const tokenMatch = String(uploadUrl).match(/upload-receita\/([^/?#]+)/i);
  if (!tokenMatch) throw new Error('token not found in upload_url');
  const token = decodeURIComponent(tokenMatch[1]);
  const pdf = await fetch('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');
  const buffer = Buffer.from(await pdf.arrayBuffer());
  const form = new FormData();
  form.append('file', buffer, { filename: 'receita-e2e.pdf', contentType: 'application/pdf' });
  const axios = require('axios');
  const res = await axios.post(`${BACKEND}/api/upload-receita/${encodeURIComponent(token)}`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    validateStatus: () => true
  });
  return { status: res.status, ok: res.status >= 200 && res.status < 300, data: res.data };
}

async function main() {
  const ts = Date.now();
  const phone = `5511988${String(ts).slice(-6)}`;
  const payload = {
    patient_name: `E2E Operacional ${ts}`,
    whatsapp: phone,
    from: phone,
    cpf: '52998224725',
    birth_date: '09/02/1988',
    email: `e2e.${ts}@example.com`,
    address: 'Rua E2E 1',
    cep: '01310100',
    chronic_condition: 'has',
    tempo_uso: 'Mais de 6 meses',
    has_previous_prescription: true,
    sinais_alerta: 'NAO',
    eligibility_status: 'eligible',
    payment_status: 'paid',
    pagamento_status: 'CONFIRMADO',
    lgpd_accepted: true,
    privacy_policy_accepted: true,
    telemedicine_consent_accepted: true,
    non_urgency_notice_accepted: true,
    terms_of_use_accepted: true,
    accepted_terms_at: new Date().toISOString(),
    typebot_public_id: 'doctor-prescreve-8rmljgu',
    med1_nome: 'losartana',
    med1_dose: '50mg',
    med1_frequencia: '1x ao dia',
    med1_via: 'oral',
    medication_count: 1
  };

  const health = await req(`${BACKEND}/health`);
  step('backend_health', health.ok, { status: health.status });

  const n8nRes = await req(N8N, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {})
    },
    body: JSON.stringify(payload)
  });
  step('n8n_webhook', n8nRes.status === 200, { status: n8nRes.status });

  const wh = await req(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'Idempotency-Key': `e2e-op-${ts}`
    },
    body: JSON.stringify({
      from: phone,
      text: 'E2E operacional',
      rawMessage: { provider: 'typebot', original: payload }
    })
  });
  let atendimentoId = wh.data?.atendimento?.id;
  const uploadUrl = wh.data?.upload_url;
  step('backend_webhook_awaiting_upload', wh.ok && wh.data?.atendimento?.status === 'awaiting_prescription_upload', {
    status: wh.status,
    atendimentoStatus: wh.data?.atendimento?.status,
    hasUploadUrl: Boolean(uploadUrl)
  });
  step('terms_acceptance_persisted', Boolean(wh.data?.atendimento?.dados_clinicos?.terms_acceptance), {
    hasField: Boolean(wh.data?.atendimento?.dados_clinicos?.terms_acceptance)
  });

  const uploadRes = uploadUrl ? await uploadPdfWithToken(uploadUrl) : { ok: false, data: {} };
  step('external_upload_post', uploadRes.ok && uploadRes.data?.success === true, {
    status: uploadRes.status,
    atendimentoStatus: uploadRes.data?.status
  });
  step('prescription_metadata', Boolean(uploadRes.data?.prescription?.storage_path), {
    storagePath: uploadRes.data?.prescription?.storage_path || null
  });

  const unpaid = await req(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'Idempotency-Key': `e2e-unpaid-${ts}`
    },
    body: JSON.stringify({
      from: `5511999${String(ts).slice(-6)}`,
      rawMessage: {
        provider: 'typebot',
        original: { ...payload, whatsapp: `5511999${String(ts).slice(-6)}`, payment_status: 'unpaid', pagamento_status: 'PENDENTE' }
      }
    })
  });
  step('block_unpaid', unpaid.data?.atendimento?.status === 'rejected');

  const support = await req(`${BACKEND}/api/whatsapp/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
    body: JSON.stringify({ from: `5511888${String(ts).slice(-6)}`, text: 'preciso de suporte' })
  });
  step('whatsapp_support', support.ok || support.status === 200, { status: support.status });

  if (!PASS) {
    report.warning = 'MEDICO_PASS not in .env — skipping panel flow';
    console.log(JSON.stringify({ success: report.errors.length === 0, ...report }, null, 2));
    process.exit(report.errors.length ? 1 : 0);
  }

  const login = await req(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS })
  });
  const token = login.data?.token;
  step('panel_login', Boolean(token), { status: login.status });

  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  atendimentoId = uploadRes.data?.atendimento_id || atendimentoId;

  if (token && atendimentoId) {
    const getOne = await req(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: auth });
    const dc = getOne.data?.atendimento?.dados_clinicos || getOne.data?.dados_clinicos;
    step('get_atendimento_terms', Boolean(dc?.terms_acceptance), { status: getOne.status });

    const viewRx = await req(`${BACKEND}/api/atendimentos/${atendimentoId}/previous-prescription/view-url`, {
      headers: auth
    });
    step('previous_prescription_view_url', viewRx.ok && Boolean(viewRx.data?.viewUrl), { status: viewRx.status });

    const supportQ = await req(`${BACKEND}/api/atendimentos/support-queue`, { headers: auth });
    step('support_queue_route', supportQ.ok, { status: supportQ.status });

    const dup = await req(`${BACKEND}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MDoctor-Webhook-Secret': SECRET,
        'Idempotency-Key': `e2e-op-${ts}`
      },
      body: JSON.stringify({
        from: phone,
        rawMessage: { provider: 'typebot', original: payload }
      })
    });
    step('webhook_idempotency', dup.data?.duplicate === true || dup.status === 409, { status: dup.status });
  }

  const panel = await fetch('https://painel-medico-staging-staging.up.railway.app/dashboard');
  step('panel_dashboard_http', panel.status === 200, { status: panel.status });

  report.success = report.errors.length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
