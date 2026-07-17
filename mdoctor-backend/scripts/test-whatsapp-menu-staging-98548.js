require('./load-dotenv');

const PHONE = '5511985485777';
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const MEDICO_USER = process.env.MEDICO_USER || process.env.MEDICO_OFFICIAL_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || process.env.MEDICO_OFFICIAL_PASS || '';

const report = { steps: [], errors: [] };

function step(name, ok, extra = {}) {
  report.steps.push({ name, ok, ...extra });
  if (!ok) report.errors.push(name);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function supabaseFetch(queryPath) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/${queryPath}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!res.ok) return null;
  return res.json();
}

async function getWaSession() {
  const rows = await supabaseFetch(`whatsapp_sessions?phone=eq.${PHONE}&select=id,phone,typebot_session_id,metadata,status`);
  return Array.isArray(rows) ? rows[0] : null;
}

async function clearWaSessionTypebot() {
  const session = await getWaSession();
  if (!session?.id) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const metadata = { ...(session.metadata || {}) };
  delete metadata.typebot_expected_input_id;
  delete metadata.typebot_payment;
  delete metadata.typebot_prescription_upload;
  await fetch(`${url}/rest/v1/whatsapp_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ typebot_session_id: null, metadata })
  });
  return getWaSession();
}

async function closeOpenSupport() {
  const secret = process.env.N8N_WEBHOOK_SECRET || '';
  await fetch(`${BACKEND}/api/whatsapp/support/close`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-N8N-Webhook-Secret': secret } : {})
    },
    body: JSON.stringify({ from: PHONE })
  }).catch(() => {});
}

async function sendWa(text, suffix = '') {
  const id = `wamid.menu.${Date.now()}${suffix}`;
  const res = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-menu-test',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ profile: { name: 'Teste Menu 98548' }, wa_id: PHONE }],
            messages: [{ id, type: 'text', from: PHONE, text: { body: text } }]
          }
        }]
      }]
    })
  });
  return { status: res.status, messageId: id };
}

async function loginPanel() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS })
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(`login painel falhou: ${res.status}`);
  return data.token;
}

async function getSupportQueue() {
  const token = await loginPanel();
  const res = await fetch(`${BACKEND}/api/atendimentos/support-queue`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.atendimentos || data || [];
}

async function main() {
  await closeOpenSupport();
  await clearWaSessionTypebot();
  await sleep(1000);

  const before = await getWaSession();
  step('session_cleared', Boolean(before && !before.typebot_session_id));

  const oi = await sendWa('Oi', 'a');
  step('webhook_oi_status', oi.status === 200, { status: oi.status });
  await sleep(3500);

  const afterOi = await getWaSession();
  const menuBlocksTypebot = !afterOi?.typebot_session_id;
  step('oi_no_autostart_typebot', menuBlocksTypebot, {
    typebotSessionId: afterOi?.typebot_session_id || null
  });

  const opt1 = await sendWa('1', 'b');
  step('webhook_opt1_status', opt1.status === 200, { status: opt1.status });
  await sleep(4500);

  const afterOpt1 = await getWaSession();
  step('opt1_starts_typebot', Boolean(afterOpt1?.typebot_session_id), {
    typebotSessionId: afterOpt1?.typebot_session_id || null,
    expectedInput: afterOpt1?.metadata?.typebot_expected_input_id || null
  });

  await clearWaSessionTypebot();
  await closeOpenSupport();
  await sleep(1000);

  const invalid = await sendWa('xyz', 'c');
  step('webhook_invalid_status', invalid.status === 200, { status: invalid.status });
  await sleep(3500);
  const afterInvalid = await getWaSession();
  step('invalid_no_typebot', !afterInvalid?.typebot_session_id);

  const opt2 = await sendWa('2', 'd');
  step('webhook_opt2_status', opt2.status === 200, { status: opt2.status });
  await sleep(3500);

  let supportVisible = false;
  try {
    const queue = await getSupportQueue();
    supportVisible = queue.some((item) => String(item.paciente_telefone || '').replace(/\D/g, '') === PHONE);
  } catch (error) {
    step('support_queue_auth', false, { error: error.message });
  }
  step('opt2_support_in_panel', supportVisible);

  await closeOpenSupport();
  await clearWaSessionTypebot();

  console.log(JSON.stringify({
    phone: PHONE,
    backend: BACKEND,
    opt1_typebot_started: report.steps.find((s) => s.name === 'opt1_starts_typebot')?.ok ? 'OK' : 'erro',
    opt2_support_panel: supportVisible ? 'OK' : 'erro',
    invalid_no_autostart: report.steps.find((s) => s.name === 'invalid_no_typebot')?.ok ? 'OK' : 'erro',
    oi_menu_no_autostart: menuBlocksTypebot ? 'OK' : 'erro',
    errors: report.errors,
    steps: report.steps
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }));
  process.exit(1);
});
