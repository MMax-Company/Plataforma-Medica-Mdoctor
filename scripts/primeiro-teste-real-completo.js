#!/usr/bin/env node
/**
 * Primeiro teste operacional real — WhatsApp → Evolution → n8n → backend → painel.
 * Usa os mesmos webhooks/URLs de produção assistida (sem mocks de fluxo).
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  const p = path.resolve(__dirname, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (v && process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile('../mdoctor-backend/.env.local');
loadEnvFile('../mdoctor-backend/.env');
loadEnvFile('../mdoctor-backend/.env.evolution-staging');

const EVOLUTION_URL = String(process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_KEY = String(process.env.EVOLUTION_API_KEY || '').trim();
const INSTANCE = String(process.env.EVOLUTION_INSTANCE || 'mdoctor-staging').trim();
const N8N = String(process.env.N8N_BASE_URL || 'https://n8n-node-production-f844.up.railway.app').replace(
  /\/$/,
  ''
);
const N8N_EVO = `${N8N}/webhook/evolution-webhook`;
const N8N_TYPEBOT = `${N8N}/webhook/typebot-webhook`;
const BACKEND = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');
const PANEL = String(
  process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app'
).replace(/\/$/, '');
const SECRET = String(process.env.N8N_WEBHOOK_SECRET || '').trim();
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';

const ts = Date.now();
const runId = `REAL-${ts}`;
const patientPhone = `55119${String(ts).slice(-8)}`;
const jid = `${patientPhone}@s.whatsapp.net`;

const report = { runId, patientPhone, phases: [], fixes: [], success: false };

async function req(url, options = {}) {
  const started = Date.now();
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, data, latency_ms: Date.now() - started };
}

function phase(name, steps) {
  report.phases.push({ name, steps, ok: steps.every((s) => s.ok !== false) });
}

function inboundBody(text, messageId) {
  return {
    event: 'MESSAGES_UPSERT',
    instance: INSTANCE,
    data: {
      key: { remoteJid: jid, fromMe: false, id: messageId || `msg-${ts}-${Math.random()}` },
      message: { conversation: text }
    }
  };
}

async function postEvolutionWebhook(text, label, messageId) {
  const correlationId = `${runId}-${label}`;
  const r = await req(N8N_EVO, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'Idempotency-Key': `${runId}-${messageId || label}`
    },
    body: JSON.stringify(inboundBody(text, messageId))
  });
  return {
    label,
    ok: r.ok && r.status < 500,
    status: r.status,
    route: r.data?.route,
    menuAction: r.data?.log?.menuAction || r.data?.menuAction,
    sentMessages: r.data?.sentMessages,
    latency_ms: r.latency_ms
  };
}

async function runInfrastructure() {
  const steps = [];

  const state = await req(`${EVOLUTION_URL}/instance/connectionState/${encodeURIComponent(INSTANCE)}`, {
    headers: { apikey: EVOLUTION_KEY }
  });
  const open = state.data?.instance?.state === 'open';
  steps.push({ name: 'evolution_open', ok: open, state: state.data?.instance?.state });

  const inst = await req(`${EVOLUTION_URL}/instance/fetchInstances`, { headers: { apikey: EVOLUTION_KEY } });
  const row = Array.isArray(inst.data) ? inst.data.find((i) => i.name === INSTANCE) : null;
  const counts = row?._count || {};
  const discrete =
    Number(counts.Message || 0) === 0 &&
    Number(counts.Contact || 0) === 0 &&
    Number(counts.Chat || 0) === 0;
  steps.push({ name: 'evolution_discrete_counts', ok: discrete, counts });

  for (const wh of ['evolution-webhook', 'typebot-webhook']) {
    const w = await req(`${N8N}/webhook/${wh}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    steps.push({ name: `webhook_${wh}`, ok: w.status !== 404 && w.status < 500, status: w.status });
  }

  const health = await req(`${BACKEND}/health`);
  const readyz = await req(`${BACKEND}/readyz`);
  steps.push({ name: 'backend_health', ok: health.ok });
  steps.push({
    name: 'backend_readyz_supabase',
    ok: readyz.ok && readyz.data?.supabase?.connected === true
  });

  phase('infrastructure', steps);
}

async function runPatientConversation() {
  const steps = [];

  const m1 = await postEvolutionWebhook('oi', 'menu_greeting', `${runId}-m1`);
  steps.push({ name: 'whatsapp_menu_greeting', ...m1, ok: m1.ok && m1.route === 'INBOUND_MESSAGE' });

  const m2 = await postEvolutionWebhook('1', 'menu_medical', `${runId}-m2`);
  steps.push({
    name: 'whatsapp_menu_medical',
    ...m2,
    ok: m2.ok && ['medical_typebot', 'typebot_link', 'typebot_reminder', 'menu_shown'].includes(m2.menuAction)
  });

  const triageText = [
    `STAGING_E2E_COMPLETE Nome: Paciente Real ${runId}`,
    `Telefone: ${patientPhone}`,
    'CPF: 52998224725',
    'Condicao: hipertensao',
    'Medicacao: losartana 50mg',
    'Uso continuo: sim',
    'Receita anterior: sim',
    'Tempo uso: 180 dias',
    'Sinais alerta: NAO',
    'LGPD: sim',
    'Consentimento: sim'
  ].join('\n');

  const m3 = await postEvolutionWebhook(triageText, 'triage_relay', `${runId}-m3`);
  steps.push({
    name: 'whatsapp_triage_relay',
    ...m3,
    ok: m3.ok && m3.route === 'INBOUND_MESSAGE'
  });

  const m4 = await postEvolutionWebhook('2', 'menu_support', `${runId}-m4`);
  steps.push({ name: 'whatsapp_support_option', ...m4, ok: m4.ok });

  phase('patient_whatsapp_n8n', steps);
}

async function runTypebotBackend() {
  const steps = [];
  const correlationId = `${runId}-typebot`;
  const idempotencyKey = `${runId}-triagem`;

  const payload = {
    paciente: {
      nome: `Paciente Real ${runId}`,
      telefone: patientPhone,
      cpf: '52998224725',
      email: `real.${patientPhone}@staging.invalid`
    },
    triagem: {
      doencas: 'hipertensao arterial',
      medicacao_em_uso: 'losartana 50mg',
      tempo_uso: '180 dias',
      receita_anterior: 'sim',
      sinais_alerta: 'nao',
      observacoes: `Primeiro teste real ${runId}`
    },
    pagamento_status: 'CONFIRMADO',
    payment_status: 'paid',
    from: patientPhone,
    run_id: runId
  };

  const n8n = await req(N8N_TYPEBOT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(payload)
  });

  const atendimentoId =
    n8n.data?.atendimentoId ||
    n8n.data?.atendimento_id ||
    n8n.data?.atendimento?.id ||
    n8n.data?.body?.atendimentoId;

  steps.push({
    name: 'typebot_webhook_n8n',
    ok: n8n.ok,
    status: n8n.status,
    atendimentoId: atendimentoId || null,
    duplicate: n8n.data?.duplicate
  });

  let resolvedId = atendimentoId;
  if (!resolvedId && SECRET) {
    const direct = await req(`${BACKEND}/api/webhook/triagem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MDoctor-Webhook-Secret': SECRET,
        'X-Correlation-Id': correlationId,
        'Idempotency-Key': `${idempotencyKey}-direct`
      },
      body: JSON.stringify(payload)
    });
    resolvedId = direct.data?.atendimentoId;
    steps.push({
      name: 'backend_triagem_direct_fallback',
      ok: direct.ok && Boolean(resolvedId),
      status: direct.status,
      atendimentoId: resolvedId
    });
  }

  report.atendimentoId = resolvedId;

  const dup = await req(N8N_TYPEBOT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  steps.push({
    name: 'typebot_idempotency_no_duplicate_storm',
    ok: dup.status === 200,
    status: dup.status,
    duplicate: dup.data?.duplicate
  });

  phase('typebot_backend', steps);
  return resolvedId;
}

async function runPanel(atendimentoId) {
  const steps = [];
  if (!MEDICO_PASS) {
    steps.push({ name: 'panel_skipped', ok: false, error: 'MEDICO_PASS ausente' });
    phase('panel', steps);
    return;
  }

  const login = await req(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS })
  });
  const token = login.data?.token;
  steps.push({ name: 'medico_login', ok: Boolean(token), status: login.status });

  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const queue = await req(`${BACKEND}/api/atendimentos/queue`, { headers: auth });
  const rows = queue.data?.atendimentos || queue.data?.items || [];
  const found = rows.find(
    (a) =>
      a.id === atendimentoId ||
      String(a.paciente_telefone || a.telefone || '').replace(/\D/g, '') === patientPhone
  );
  steps.push({
    name: 'panel_queue_has_patient',
    ok: Boolean(found),
    queueSize: rows.length,
    status: found?.status,
    pagamento: found?.pagamento_status
  });

  const panelLogin = await req(`${PANEL}/login`);
  steps.push({ name: 'panel_login_page', ok: panelLogin.status === 200, status: panelLogin.status });

  const fila = await req(`${PANEL}/fila`);
  steps.push({ name: 'panel_fila_page', ok: fila.status === 200, status: fila.status });

  if (atendimentoId && token) {
    const detail = await req(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: auth });
    steps.push({
      name: 'atendimento_detail',
      ok: detail.ok,
      status: detail.status,
      elegivel: detail.data?.elegibilidade?.eligible ?? detail.data?.eligible
    });
  }

  phase('panel', steps);
}

async function runOutboundWhatsApp() {
  const steps = [];
  const text = `Doctor Prescreve (${runId}): teste operacional. Digite 1 para atendimento medico ou 2 para suporte.`;
  const send = await req(
    `${EVOLUTION_URL}/message/sendText/${encodeURIComponent(INSTANCE)}`,
    {
      method: 'POST',
      headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: patientPhone, text })
    }
  );
  steps.push({
    name: 'evolution_sendText_real',
    ok: send.status === 201 || send.ok,
    status: send.status
  });
  phase('outbound_whatsapp', steps);
}

async function runRecoveryProbe() {
  const steps = [];
  const h1 = await req(`${N8N}/healthz`);
  steps.push({ name: 'n8n_health_after_flow', ok: h1.ok || h1.status === 200 });
  const w = await req(N8N_EVO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inboundBody('0', `${runId}-recovery`))
  });
  steps.push({ name: 'webhook_after_flow', ok: w.status !== 404 && w.status < 500, status: w.status });
  phase('recovery_probe', steps);
}

async function main() {
  if (!EVOLUTION_KEY) {
    console.error(JSON.stringify({ success: false, error: 'EVOLUTION_API_KEY ausente' }));
    process.exit(1);
  }

  await runInfrastructure();
  await runPatientConversation();
  const atendimentoId = await runTypebotBackend();
  await runPanel(atendimentoId);
  await runOutboundWhatsApp();
  await runRecoveryProbe();

  report.fixes = report.fixes || [];
  if (process.env.APPLIED_BACKEND_BASE_URL_FIX === '1') {
    report.fixes.push({
      issue: 'n8n BACKEND_BASE_URL apontava para backend incorreto',
      action: 'Railway n8n Node BACKEND_BASE_URL → mdoctor-backend-staging'
    });
  }

  report.success = report.phases.every((p) => p.ok);
  report.failures = report.phases
    .filter((p) => !p.ok)
    .flatMap((p) => p.steps.filter((s) => s.ok === false).map((s) => `${p.name}/${s.name}`));

  const outPath = path.join(__dirname, '../docs/PRIMEIRO-TESTE-REAL-RELATORIO.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
