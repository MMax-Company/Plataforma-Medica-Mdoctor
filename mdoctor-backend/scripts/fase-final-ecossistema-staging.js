#!/usr/bin/env node
/**
 * Validação final do ecossistema staging (sem conectar WhatsApp).
 * Simula fluxo receita → entrega → pesquisa → resposta salva.
 */
require('./load-dotenv');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const N8N_BASE = String(process.env.N8N_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(/\/$/, '');
const EVOLUTION_URL = String(process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_KEY = String(process.env.EVOLUTION_API_KEY || '').trim();
const EVOLUTION_INSTANCE = String(process.env.EVOLUTION_INSTANCE || 'mdoctor-staging').trim();
const SECRET = process.env.N8N_WEBHOOK_SECRET || process.env.INGRESS_SERVICE_SECRET || '';
const MEDICO_USER = process.env.MEDICO_USER || 'staging-doctor';
const MEDICO_PASS = process.env.MEDICO_PASS || '';

const WEBHOOKS = {
  typebot: `${N8N_BASE}/webhook/typebot-webhook`,
  evolution: `${N8N_BASE}/webhook/evolution-webhook`
};

const report = {
  generated_at: new Date().toISOString(),
  targets: { BACKEND, PANEL, N8N_BASE, EVOLUTION_URL: EVOLUTION_URL || null, EVOLUTION_INSTANCE },
  validated: [],
  pending: [],
  blockers_whatsapp_only: [],
  simulation: null,
  endpoints: {},
  webhooks: {}
};

function mark(list, item, ok, detail = {}) {
  const entry = { item, ok, ...detail };
  list.push(entry);
  return entry;
}

async function request(url, options = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, data, latency_ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, error: error.message, latency_ms: Date.now() - started };
  }
}

async function probeInfrastructure() {
  const health = await request(`${BACKEND}/health`);
  mark(report.validated, 'backend_health', health.ok, { status: health.status });

  const readyz = await request(`${BACKEND}/readyz`);
  const supabaseOk = readyz.data?.supabase?.connected === true;
  mark(report.validated, 'backend_readyz', readyz.ok, { status: readyz.status, supabase: supabaseOk });
  if (!supabaseOk) mark(report.pending, 'supabase_connection', false, { reason: readyz.data?.storage });

  const panel = await request(`${PANEL}/login`);
  mark(report.validated, 'panel_login_page', panel.ok, { status: panel.status });

  const n8n = await request(`${N8N_BASE}/healthz`);
  mark(report.validated, 'n8n_health', n8n.ok, { status: n8n.status });

  const waStatus = await request(`${BACKEND}/api/whatsapp/provider-status`);
  report.endpoints.whatsapp_provider_status = waStatus;
  mark(
    report.validated,
    'backend_whatsapp_provider_status',
    waStatus.ok,
    {
      provider: waStatus.data?.provider,
      evolution_configured: waStatus.data?.evolution?.configured,
      evolution_connected: waStatus.data?.evolution?.connected
    }
  );

  if (waStatus.data?.evolution?.connected === false) {
    mark(report.blockers_whatsapp_only, 'evolution_instance_not_open', false, {
      state: waStatus.data?.evolution?.state || waStatus.data?.evolution?.instanceState,
      note: 'Requer escaneamento de QR quando houver número dedicado'
    });
  }

  if (EVOLUTION_URL && EVOLUTION_KEY) {
    const evoState = await request(`${EVOLUTION_URL}/instance/connectionState/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
      headers: { apikey: EVOLUTION_KEY }
    });
    const state = evoState.data?.instance?.state || evoState.data?.state || 'unknown';
    report.endpoints.evolution_connection = { ok: evoState.ok, state, status: evoState.status };
    if (state === 'open') {
      mark(report.validated, 'evolution_instance_open', true, { state });
    } else {
      mark(
        report.blockers_whatsapp_only,
        'evolution_instance_not_open',
        false,
        { state, note: 'Requer escaneamento de QR quando houver número dedicado' }
      );
    }
  } else {
    mark(report.pending, 'evolution_probe_skipped', false, { reason: 'EVOLUTION_API_URL/KEY ausentes localmente' });
  }
}

async function probeWebhooks() {
  for (const [name, url] of Object.entries(WEBHOOKS)) {
    const probe = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {})
      },
      body: JSON.stringify({ probe: true, from: '5511999990001', text: 'PROBE' })
    });
    report.webhooks[name] = { url, status: probe.status, ok: probe.status !== 404, body: probe.data };
    if (probe.status === 404) {
      mark(report.pending, `n8n_webhook_${name}`, false, { status: 404, url, fix: 'Ativar workflow n8n correspondente' });
    } else if (probe.status === 401 && !SECRET) {
      mark(report.pending, `n8n_webhook_${name}_auth`, false, { status: 401, reason: 'N8N_WEBHOOK_SECRET ausente no runner' });
    } else {
      mark(report.validated, `n8n_webhook_${name}_reachable`, probe.status !== 404, { status: probe.status });
    }
  }

  const backendWh = await request(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {})
    },
    body: JSON.stringify({ from: '5511999990001', text: 'PROBE', payment_status: 'unpaid' })
  });
  report.endpoints.backend_whatsapp_webhook = { status: backendWh.status, ok: backendWh.ok };
  mark(report.validated, 'backend_whatsapp_webhook', backendWh.status !== 404 && backendWh.status !== 503, {
    status: backendWh.status
  });
}

async function probePatientOutcomesModule() {
  const routes = [
    { name: 'survey_inbound', method: 'POST', path: '/api/patient-outcomes/survey/inbound', body: { from: '5511999887766', text: '1' } }
  ];

  for (const route of routes) {
    const res = await request(`${BACKEND}${route.path}`, {
      method: route.method,
      headers: {
        'Content-Type': 'application/json',
        ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {})
      },
      body: JSON.stringify(route.body)
    });
    report.endpoints[route.name] = { status: res.status, ok: res.ok, snippet: res.data };
    if (res.status === 404) {
      mark(report.pending, `endpoint_${route.name}`, false, {
        status: 404,
        fix: 'Deploy do backend com módulo patient-outcomes'
      });
    } else {
      mark(report.validated, `endpoint_${route.name}`, res.status !== 404, { status: res.status });
    }
  }
}

async function simulateEvidenceFlow() {
  if (!SECRET) {
    report.simulation = { skipped: true, reason: 'N8N_WEBHOOK_SECRET ausente' };
    mark(report.pending, 'simulation_evidence_flow', false, { reason: 'secret_missing' });
    return;
  }

  let attendanceId = null;
  let patientId = null;
  let phone = `55119${String(Date.now()).slice(-8)}`;

  if (MEDICO_PASS) {
    const login = await request(`${BACKEND}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS })
    });
    if (login.data?.token) {
      const list = await request(`${BACKEND}/api/atendimentos`, {
        headers: { Authorization: `Bearer ${login.data.token}` }
      });
      const rows = list.data?.atendimentos || [];
      const pick =
        rows.find((a) => String(a.status || '').toLowerCase() === 'delivered') ||
        rows.find((a) => String(a.status || '').toLowerCase() === 'ready') ||
        rows[0];
      if (pick?.id) {
        attendanceId = pick.id;
        patientId = pick.patient_id || null;
        phone = pick.paciente_telefone || phone;
      }
    }
  }

  if (!attendanceId) {
    report.simulation = { skipped: true, reason: 'Nenhum atendimento real disponível para simulação' };
    mark(report.pending, 'simulation_evidence_flow', false, { reason: 'no_real_attendance' });
    return;
  }

  const correlationId = `fase-final-${Date.now()}`;

  const trigger = await request(`${BACKEND}/api/patient-outcomes/survey/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'X-Correlation-Id': correlationId
    },
    body: JSON.stringify({ attendance_id: attendanceId, patient_id: patientId, phone })
  });

  if (trigger.status === 404) {
    report.simulation = { ok: false, step: 'trigger', status: 404, note: 'Módulo não deployado' };
    mark(report.pending, 'simulation_trigger_survey', false, { status: 404 });
    return;
  }

  const steps = [];
  for (const [label, text] of [
    ['q1', '2'],
    ['q2', '1'],
    ['q3', '1']
  ]) {
    const inbound = await request(`${BACKEND}/api/patient-outcomes/survey/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MDoctor-Webhook-Secret': SECRET,
        'X-Correlation-Id': correlationId
      },
      body: JSON.stringify({ from: phone, text })
    });
    steps.push({ step: label, status: inbound.status, handled: inbound.data?.handled, completed: inbound.data?.completed });
  }

  const saved = await request(`${BACKEND}/api/patient-outcomes/${attendanceId}`, {
    headers: { 'X-MDoctor-Webhook-Secret': SECRET }
  });

  const outcome = saved.data?.outcome;
  const alreadyComplete =
    outcome?.q1_access_alternative &&
    outcome?.q2_avoided_interruption &&
    outcome?.q3_would_use_again;
  const flowOk =
    alreadyComplete ||
    (trigger.ok &&
      (trigger.data?.triggered || trigger.data?.skipped) &&
      steps.every((s) => s.handled) &&
      steps[2]?.completed === true &&
      outcome?.q1_access_alternative === 'ubs' &&
      outcome?.q2_avoided_interruption === 'sim' &&
      outcome?.q3_would_use_again === 'sim');

  report.simulation = {
    ok: flowOk,
    attendance_id: attendanceId,
    phone_masked: phone.replace(/\d(?=\d{4})/g, '*'),
    trigger: { status: trigger.status, triggered: trigger.data?.triggered },
    steps,
    saved: outcome || saved.data
  };

  mark(report.validated, 'simulation_evidence_flow', flowOk, report.simulation);
  if (!flowOk) {
    mark(report.pending, 'simulation_evidence_flow_incomplete', false, report.simulation);
  }
}

async function simulateDeliverHook() {
  if (!MEDICO_PASS) {
    mark(report.pending, 'simulation_deliver_hook', false, { reason: 'MEDICO_PASS ausente' });
    return;
  }

  const login = await request(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS })
  });
  if (!login.data?.token) {
    mark(report.pending, 'simulation_deliver_hook', false, { reason: 'login_failed', status: login.status });
    return;
  }

  const token = login.data.token;
  const list = await request(`${BACKEND}/api/atendimentos`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const candidates = (list.data?.atendimentos || list.data?.data || []).filter((a) => {
    const st = String(a.status || '').toLowerCase();
    return ['ready', 'receita_emitida', 'approved'].includes(st);
  });

  if (!candidates.length) {
    mark(report.pending, 'simulation_deliver_hook', false, { reason: 'no_ready_atendimento_in_queue' });
    report.simulation_deliver = { skipped: true, reason: 'Nenhum atendimento ready para testar deliver+survey hook' };
    return;
  }

  const at = candidates[0];
  const correlationId = `deliver-survey-${Date.now()}`;
  const deliver = await request(`${BACKEND}/api/atendimentos/${at.id}/deliver`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId
    },
    body: JSON.stringify({ channel: 'whatsapp' })
  });

  await new Promise((r) => setTimeout(r, 2500));

  const outcome = await request(`${BACKEND}/api/patient-outcomes/${at.id}`, {
    headers: { 'X-MDoctor-Webhook-Secret': SECRET }
  });

  report.simulation_deliver = {
    atendimento_id: at.id,
    deliver_status: deliver.status,
    deliver_ok: deliver.ok,
    outcome_status: outcome.status,
    outcome: outcome.data?.outcome || null
  };

  const hookOk = deliver.ok && (outcome.status === 200 || outcome.status === 404);
  mark(
    report.validated,
    'simulation_deliver_endpoint',
    deliver.ok,
    { status: deliver.status, provider: deliver.data?.delivery?.provider }
  );

  if (outcome.status === 200) {
    mark(report.validated, 'simulation_deliver_survey_hook', true, report.simulation_deliver);
  } else if (outcome.status === 404 && deliver.ok) {
    if (report.endpoints.survey_trigger?.status === 404) {
      mark(report.pending, 'simulation_deliver_survey_hook', false, { reason: 'module_not_deployed' });
    } else {
      mark(report.pending, 'simulation_deliver_survey_hook', false, { reason: 'hook_not_firing_or_disabled', ...report.simulation_deliver });
    }
  }
}

async function main() {
  await probeInfrastructure();
  await probeWebhooks();
  await probePatientOutcomesModule();
  await simulateEvidenceFlow();
  await simulateDeliverHook();

  report.summary = {
    validated_count: report.validated.filter((v) => v.ok).length,
    pending_count: report.pending.length,
    whatsapp_blockers_count: report.blockers_whatsapp_only.length,
    ready_for_number_only:
      report.pending.every((p) => String(p.item || '').includes('n8n_webhook') || String(p.reason || '').includes('QR')) &&
      report.blockers_whatsapp_only.length > 0
  };

  const outPath = path.join(__dirname, '../../docs/FASE-FINAL-ECOSSISTEMA-STAGING.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pending.some((p) => !String(p.item || '').includes('evolution_probe')) ? 1 : 0);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
