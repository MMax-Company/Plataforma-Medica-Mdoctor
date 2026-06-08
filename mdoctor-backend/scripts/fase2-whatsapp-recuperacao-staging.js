#!/usr/bin/env node
/**
 * Fase 2 — Recuperação ecossistema WhatsApp staging.
 * Não altera banco, frontend, painel ou instância Evolution.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const EVOLUTION = String(process.env.EVOLUTION_API_URL || 'https://evolution-api-staging-staging-40d1.up.railway.app').replace(/\/$/, '');
const N8N_STAGING = String(process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(/\/$/, '');
const N8N_PROD = 'https://n8n-node-production-f844.up.railway.app';
const N8N_EVO_WH_STAGING = `${N8N_STAGING}/webhook/evolution-webhook`;
const N8N_EVO_WH_PROD = `${N8N_PROD}/webhook/evolution-webhook`;
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'mdoctor-staging';
const EXPECTED_ID = 'aa0ac829-44ab-44ed-bbb5-e3bd840e7381';
const EVO_KEY = String(process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || 'mdoc_doctorprescreve_2026').trim();
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const OUT_JSON = path.join(ROOT, 'docs/FASE2-WHATSAPP-RECUPERACAO-RELATORIO.json');
const OUT_MD = path.join(ROOT, 'docs/FASE2-WHATSAPP-RECUPERACAO-RELATORIO.md');
const QR_PNG = path.join(ROOT, 'docs/FASE2-WHATSAPP-QR-mdoctor-staging.png');

const report = {
  generated_at: new Date().toISOString(),
  phase: 'FASE2-WHATSAPP-RECUPERACAO-STAGING',
  constraints: ['sem nova instancia', 'sem limpeza', 'sem alteracao banco', 'sem frontend'],
  instance: {},
  api_key: {},
  webhooks: { before: {}, after: {}, official_staging_endpoint: N8N_EVO_WH_STAGING },
  actions_executed: [],
  validation: {},
  qr: {},
  e2e: {},
};

async function req(url, options = {}) {
  const r = await fetch(url, options);
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: r.status, ok: r.ok, data };
}

function evoHeaders() {
  return { apikey: EVO_KEY, 'Content-Type': 'application/json' };
}

async function auditInstance() {
  const insts = await req(`${EVOLUTION}/instance/fetchInstances`, { headers: evoHeaders() });
  const rows = Array.isArray(insts.data) ? insts.data : [];
  const row = rows.find((x) => x.name === INSTANCE || x.id === EXPECTED_ID);
  const state = await req(`${EVOLUTION}/instance/connectionState/${encodeURIComponent(INSTANCE)}`, { headers: evoHeaders() });
  report.instance = {
    exists: Boolean(row),
    id: row?.id || null,
    id_matches_expected: row?.id === EXPECTED_ID,
    name: row?.name || null,
    connectionStatus: row?.connectionStatus || null,
    connectionState: state.data?.instance?.state || null,
    total_instances: rows.length,
    all_names: rows.map((x) => x.name),
  };
  return Boolean(row && row.id === EXPECTED_ID);
}

async function auditWebhooks(label) {
  const perInstance = await req(`${EVOLUTION}/webhook/find/${encodeURIComponent(INSTANCE)}`, { headers: evoHeaders() });
  const n8nStagingProbe = await req(`${N8N_EVO_WH_STAGING}/connection-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'CONNECTION_UPDATE', instance: INSTANCE, data: { state: 'open' } }),
  });
  const n8nProdProbe = await req(`${N8N_EVO_WH_PROD}/connection-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'CONNECTION_UPDATE', instance: INSTANCE, data: { state: 'open' } }),
  });
  report.webhooks[label] = {
    per_instance: perInstance.data,
    per_instance_url: perInstance.data?.url || null,
    per_instance_points_to_staging: (perInstance.data?.url || '').includes('n8n-staging'),
    per_instance_points_to_prod: (perInstance.data?.url || '').includes('n8n-node-production'),
    n8n_staging_webhook_probe: { status: n8nStagingProbe.status, ok: n8nStagingProbe.ok },
    n8n_prod_webhook_probe: { status: n8nProdProbe.status, ok: n8nProdProbe.ok },
    note_global_webhook: 'WEBHOOK_GLOBAL_URL no Railway evolution-api-staging → n8n staging (verificado read-only)',
    official_staging: N8N_EVO_WH_STAGING,
  };
}

async function fixInstanceWebhook() {
  const r = await req(`${EVOLUTION}/webhook/set/${encodeURIComponent(INSTANCE)}`, {
    method: 'POST',
    headers: evoHeaders(),
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: N8N_EVO_WH_STAGING,
        webhookByEvents: true,
        webhookBase64: false,
        events: ['CONNECTION_UPDATE', 'QRCODE_UPDATED', 'MESSAGES_UPSERT', 'SEND_MESSAGE'],
      },
    }),
  });
  report.actions_executed.push({
    action: 'webhook/set/mdoctor-staging',
    ok: r.ok,
    status: r.status,
    url: N8N_EVO_WH_STAGING,
  });
  return r.ok;
}

function syncBackendEvolutionKey() {
  const before = process.env._BACKEND_KEY_BEFORE || 'unknown';
  const target = EVO_KEY;
  const cmd = spawnSync(
    'railway',
    [
      'variable',
      'set',
      `EVOLUTION_API_KEY=${target}`,
      '--project',
      'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b',
      '--environment',
      'staging',
      '--service',
      'mdoctor-backend-staging',
    ],
    { encoding: 'utf8', shell: true }
  );
  report.api_key = {
    evolution_authentication_api_key: EVO_KEY,
    backend_key_before: before,
    backend_key_target: target,
    railway_set_ok: cmd.status === 0,
    railway_stdout: (cmd.stdout || '').slice(0, 300),
    railway_stderr: (cmd.stderr || '').slice(0, 300),
    aligned: cmd.status === 0,
  };
  report.actions_executed.push({
    action: 'railway variable set EVOLUTION_API_KEY on mdoctor-backend-staging',
    ok: cmd.status === 0,
  });
  return cmd.status === 0;
}

async function validateBackend() {
  const readyz = await req(`${BACKEND}/readyz`);
  let provider = null;
  if (MEDICO_PASS) {
    const login = await req(`${BACKEND}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
    });
    if (login.data?.token) {
      provider = await req(`${BACKEND}/api/whatsapp/provider-status`, {
        headers: { Authorization: `Bearer ${login.data.token}` },
      });
    }
  }
  report.validation.backend = {
    health: (await req(`${BACKEND}/health`)).ok,
    readyz: readyz.data?.supabase || {},
    provider_status: provider?.data?.evolution || provider?.data || null,
    provider_fetch_instances_ok: provider?.data?.evolution?.probes?.fetchInstances?.ok ?? null,
    provider_connection_state: provider?.data?.evolution?.instanceState ?? null,
  };
}

async function validateN8n() {
  const health = await req(`${N8N_STAGING}/healthz`);
  const evoWh = await req(`${N8N_EVO_WH_STAGING}/messages-upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'MESSAGES_UPSERT',
      instance: INSTANCE,
      data: { key: { remoteJid: '5511999999999@s.whatsapp.net' }, message: { conversation: 'probe fase2' } },
    }),
  });
  report.validation.n8n = {
    healthz: health.status,
    evolution_webhook_messages_upsert: evoWh.status,
    evolution_webhook_ok: evoWh.status === 200,
  };
}

async function validateSupabase() {
  const readyz = await req(`${BACKEND}/readyz`);
  report.validation.supabase = readyz.data?.supabase || {};
}

async function generateQr() {
  const connect = await req(`${EVOLUTION}/instance/connect/${encodeURIComponent(INSTANCE)}`, { headers: evoHeaders() });
  const b64 = connect.data?.base64 || '';
  report.qr = {
    http: connect.status,
    ok: connect.ok && Boolean(b64),
    pairingCode: connect.data?.pairingCode || null,
    count: connect.data?.count || null,
    png_saved: QR_PNG,
  };
  if (b64.startsWith('data:image/png;base64,')) {
    fs.writeFileSync(QR_PNG, Buffer.from(b64.replace(/^data:image\/png;base64,/, ''), 'base64'));
    report.qr.file_written = true;
  } else if (b64) {
    fs.writeFileSync(QR_PNG, Buffer.from(b64, 'base64'));
    report.qr.file_written = true;
  }
  const state = await req(`${EVOLUTION}/instance/connectionState/${encodeURIComponent(INSTANCE)}`, { headers: evoHeaders() });
  report.qr.connection_state_after_connect = state.data?.instance?.state || null;
}

async function runE2eProbe() {
  if (!MEDICO_PASS || !process.env.N8N_WEBHOOK_SECRET) {
    report.e2e = { skipped: true, reason: 'MEDICO_PASS ou N8N_WEBHOOK_SECRET ausente para E2E completo' };
    return;
  }
  const e2e = spawnSync(process.execPath, [path.join(__dirname, 'e2e-typebot-n8n-evolution-staging.js')], {
    env: {
      ...process.env,
      BACKEND_URL: BACKEND,
      N8N_WEBHOOK_URL: `${N8N_STAGING}/webhook/typebot-webhook`,
    },
    encoding: 'utf8',
    timeout: 120000,
  });
  report.e2e = {
    exit: e2e.status,
    ok: e2e.status === 0,
    stdout_tail: (e2e.stdout || '').slice(-1200),
    stderr_tail: (e2e.stderr || '').slice(-400),
  };
}

async function getBackendKeyBefore() {
  const cmd = spawnSync(
    'railway',
    [
      'variable',
      'list',
      '--project',
      'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b',
      '--environment',
      'staging',
      '--service',
      'mdoctor-backend-staging',
      '--json',
    ],
    { encoding: 'utf8', shell: true }
  );
  try {
    const j = JSON.parse(cmd.stdout);
    process.env._BACKEND_KEY_BEFORE = j.EVOLUTION_API_KEY || '(nao definida)';
  } catch {
    process.env._BACKEND_KEY_BEFORE = '(leitura falhou)';
  }
}

function writeMd() {
  const i = report.instance;
  const w = report.webhooks.after;
  const lines = [
    '# Fase 2 — Recuperação WhatsApp Staging',
    '',
    `**Gerado:** ${report.generated_at}`,
    '',
    '## Instância mdoctor-staging',
    `- Existe: **${i.exists}**`,
    `- ID: \`${i.id}\` (esperado \`${EXPECTED_ID}\`)`,
    `- Estado: \`${i.connectionStatus}\` / \`${i.connectionState}\``,
    '',
    '## API Key alinhada',
    `- Backend \`EVOLUTION_API_KEY\` → \`${report.api_key.backend_key_target}\``,
    `- Evolution \`AUTHENTICATION_API_KEY\` → mesma chave`,
    `- Railway set: **${report.api_key.railway_set_ok ? 'OK' : 'FALHA'}**`,
    '',
    '## Webhooks',
    `- Oficial staging: \`${N8N_EVO_WH_STAGING}\``,
    `- Por instância (após correção): \`${w?.per_instance_url || '—'}\``,
    '',
    '## QR Code',
    `- Gerado: **${report.qr.ok ? 'sim' : 'não'}**`,
    `- Arquivo: \`docs/FASE2-WHATSAPP-QR-mdoctor-staging.png\``,
    `- Estado pós-connect: \`${report.qr.connection_state_after_connect}\``,
    '',
    '## Validação',
    `- Backend provider fetchInstances: **${report.validation.backend?.provider_fetch_instances_ok}**`,
    `- n8n evolution webhook: **${report.validation.n8n?.evolution_webhook_ok}** (${report.validation.n8n?.evolution_webhook_messages_upsert})`,
    `- Supabase connected: **${report.validation.supabase?.connected}**`,
    `- E2E: **${report.e2e.ok ? 'OK' : report.e2e.skipped ? 'skipped' : 'FALHA'}**`,
    '',
    '## Ações executadas',
    ...report.actions_executed.map((a) => `- ${a.action}: ${a.ok ? 'OK' : 'FALHA'}`),
  ];
  fs.writeFileSync(OUT_MD, lines.join('\n'), 'utf8');
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });

  const intact = await auditInstance();
  if (!intact) {
    report.error = 'Instância não íntegra — abortando sem criar nova';
    fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
    process.exit(1);
  }
  report.actions_executed.push({ action: 'confirmar instancia existente (sem create)', ok: true });

  await auditWebhooks('before');
  await getBackendKeyBefore();
  syncBackendEvolutionKey();
  await fixInstanceWebhook();
  await auditWebhooks('after');

  // Aguardar redeploy backend se key mudou
  if (report.api_key.railway_set_ok) {
    report.actions_executed.push({ action: 'aguardar redeploy backend (25s)', ok: true });
    await new Promise((r) => setTimeout(r, 25000));
  }

  await validateBackend();
  await validateN8n();
  await validateSupabase();
  await generateQr();
  await runE2eProbe();

  report.validation.evolution_to_n8n = {
    webhook_url: report.webhooks.after?.per_instance_url,
    n8n_probe_status: report.webhooks.after?.n8n_staging_webhook_probe?.status,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  writeMd();
  console.log(JSON.stringify({ ok: true, report: OUT_MD, qr: QR_PNG, instance: report.instance }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
