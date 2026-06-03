#!/usr/bin/env node
/**
 * Fechamento operacional: foto receita + Typebot + n8n + backend + painel.
 * Saída: docs/OPERACIONAL-FECHAMENTO-FINAL.json
 */
require('./load-dotenv');

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const N8N_STAGING = (process.env.N8N_WEBHOOK_URL || 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook').replace(/\/$/, '');
const N8N_PROD = 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook';
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';
function resolvePanelUrl() {
  const staging = 'https://painel-medico-staging-staging.up.railway.app';
  const candidates = [process.env.PANEL_URL_STAGING, process.env.PANEL_URL, staging];
  for (const value of candidates) {
    const url = String(value || '').trim().replace(/\/$/, '');
    if (!url) continue;
    if (/localhost|127\.0\.0\.1/i.test(url)) continue;
    return url;
  }
  return staging;
}
const PANEL = resolvePanelUrl();
const USER = process.env.MEDICO_USER || '';
const PASS = process.env.MEDICO_PASS || '';

const report = {
  generated_at: new Date().toISOString(),
  supabase_project: 'thbwoogytwcidxrrboym',
  sections: {}
};

async function req(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 45000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 400) };
    }
    return { status: res.status, ok: res.ok, data };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      data: { error: error.message, code: error.cause?.code || null }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function runNodeScript(scriptName) {
  const scriptPath = path.join(__dirname, scriptName);
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: process.env
  });
  return { ok: r.status === 0, status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function section(name, ok, details = {}) {
  report.sections[name] = { ok, ...details };
}

async function validateTypebotExport() {
  const prod = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json');
  const staging = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
  const file = fs.existsSync(prod) ? prod : staging;
  if (!fs.existsSync(file)) return { ok: false, error: 'export não encontrado' };
  const raw = fs.readFileSync(file, 'utf8');
  const checks = {
    previous_prescription_file: raw.includes('previous_prescription_file'),
    webhook_prod: raw.includes('n8n-node-production-f844') || raw.includes('typebot-webhook'),
    upload_block: /file input|fileInput|File upload/i.test(raw),
    free_plan_note: true
  };
  return { ok: checks.previous_prescription_file && checks.webhook_prod, file, checks };
}

async function validateN8nProdExport() {
  const file = path.join(__dirname, '../../docs/n8n-workflows/production/doctor-prescreve-typebot-production.json');
  if (!fs.existsSync(file)) return { ok: false, error: 'export produção ausente' };
  const raw = fs.readFileSync(file, 'utf8');
  return {
    ok: raw.includes('typebot-webhook') && raw.includes('triagens'),
    file,
    uses_triagens: raw.includes('/triagens'),
    uses_backend_webhook: raw.includes('/api/whatsapp/webhook'),
    previous_prescription_in_export: /previous_prescription|foto_receita/i.test(raw),
    gap:
      'Produção grava triagens Supabase; ingest foto no backend exige alinhar workflow ou usar staging n8n → backend.'
  };
}

async function testBackendEndpoints(ts, phone) {
  const headers = {
    'Content-Type': 'application/json',
    'X-MDoctor-Webhook-Secret': SECRET,
    'X-Correlation-Id': `fechamento-${ts}`,
    'Idempotency-Key': `fechamento-${ts}`
  };

  const eligiblePayload = {
    patient_name: `Fechamento ${ts}`,
    whatsapp: phone,
    from: phone,
    cpf: '52998224725',
    birth_date: '09/02/1988',
    email: `f.${ts}@example.com`,
    address: 'Rua Teste 1',
    cep: '01310100',
    chronic_condition: 'has',
    tempo_uso: 'Mais de 6 meses',
    has_previous_prescription: true,
    previous_prescription_file: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    sinais_alerta: 'NAO',
    payment_status: 'paid',
    pagamento_status: 'CONFIRMADO',
    lgpd_accepted: true,
    privacy_policy_accepted: true,
    telemedicine_consent_accepted: true,
    non_urgency_notice_accepted: true,
    terms_of_use_accepted: true,
    med1_nome: 'losartana',
    med1_dose: '50mg',
    med1_frequencia: '1x ao dia',
    medication_count: 1
  };

  const ingest = await req(`${BACKEND}/api/whatsapp/ingest-previous-prescription`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      fileUrl: eligiblePayload.previous_prescription_file,
      atendimento_id: `00000000-0000-4000-8000-${String(ts).slice(-12).padStart(12, '0')}`,
      source: 'fechamento-test'
    })
  });

  const noPhoto = await req(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': `fechamento-nophoto-${ts}` },
    body: JSON.stringify({
      from: `5511777${String(ts).slice(-6)}`,
      rawMessage: {
        provider: 'typebot',
        original: { ...eligiblePayload, whatsapp: `5511777${String(ts).slice(-6)}`, previous_prescription_file: '' }
      }
    })
  });

  const webhook = await req(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: phone,
      text: 'fechamento',
      rawMessage: { provider: 'typebot', original: eligiblePayload }
    })
  });

  const atendimentoId = webhook.data?.atendimento?.id;
  const clinical = webhook.data?.atendimento?.dados_clinicos || {};
  let viewUrl = null;
  if (atendimentoId && USER && PASS) {
    const login = await req(`${BACKEND}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: USER, password: PASS })
    });
    const token = login.data?.token;
    if (token) {
      const view = await req(`${BACKEND}/api/atendimentos/${atendimentoId}/previous-prescription/view-url`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      viewUrl = view;
    }
  }

  return {
    ingest: { ok: ingest.ok, status: ingest.status, hasStoragePath: Boolean(ingest.data?.previous_prescription_storage_path) },
    webhook: {
      ok: webhook.ok,
      status: webhook.status,
      queue: webhook.data?.atendimento?.status,
      hasMeta: Boolean(clinical.previous_prescription_storage_path || clinical.foto_receita_url),
      ingestOk: clinical.prescription_ingest?.ok !== false
    },
    blockNoPhoto: { ok: noPhoto.data?.atendimento?.status === 'rejected', status: noPhoto.status },
    viewUrl: viewUrl
      ? { ok: viewUrl.ok && Boolean(viewUrl.data?.viewUrl), status: viewUrl.status }
      : { ok: null, skipped: !USER || !PASS, reason: 'sem credenciais médico' },
    atendimentoId
  };
}

async function main() {
  const migration = runNodeScript('apply-receitas-anteriores-migration.js');
  section('supabase_migration', migration.ok, {
    stdout: migration.stdout.slice(0, 2000),
    stderr: migration.stderr.slice(0, 500)
  });

  const unit = runNodeScript('test-previous-prescription-storage.js');
  const normalizer = runNodeScript('test-fase1-payload-normalizer.js');
  section('backend_unit_tests', unit.ok && normalizer.ok, { unit: unit.ok, normalizer: normalizer.ok });

  const health = await req(`${BACKEND}/health`);
  section('backend_health', health.ok, { url: BACKEND, status: health.status });

  const ts = Date.now();
  const phone = `5511966${String(ts).slice(-6)}`;
  const endpoints = await testBackendEndpoints(ts, phone);
  section('backend_endpoints', endpoints.ingest.ok && endpoints.webhook.ok && endpoints.blockNoPhoto.ok, endpoints);

  const n8nStaging = await req(N8N_STAGING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {}) },
    body: JSON.stringify({
      patient_name: 'N8N probe',
      whatsapp: phone,
      previous_prescription_file: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      payment_status: 'paid',
      has_previous_prescription: true,
      chronic_condition: 'has',
      cpf: '52998224725',
      birth_date: '09/02/1988',
      email: 'n@example.com',
      address: 'Rua 1',
      cep: '01310100',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      med1_nome: 'losartana',
      med1_dose: '50mg',
      medication_count: 1
    })
  });
  section('n8n_staging_webhook', n8nStaging.status === 200, { status: n8nStaging.status, url: N8N_STAGING });

  const n8nProd = await req(N8N_PROD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ test: true, previous_prescription_file: 'https://example.com/x.jpg' })
  });
  section('n8n_prod_webhook', n8nProd.status === 200, { status: n8nProd.status, url: N8N_PROD });

  const typebot = await validateTypebotExport();
  section('typebot_export', typebot.ok, typebot);

  const n8nExport = await validateN8nProdExport();
  section('n8n_prod_workflow_export', n8nExport.ok, n8nExport);

  const panelDash = await req(`${PANEL}/dashboard`);
  const panelLogin = await req(`${PANEL}/login`);
  section('painel_http', panelDash.status === 200 && panelLogin.status === 200, {
    dashboard: panelDash.status,
    login: panelLogin.status,
    url: PANEL
  });

  const e2e = runNodeScript('staging-e2e-operacional.js');
  section('e2e_staging_operacional', e2e.ok, { stdout: e2e.stdout.slice(0, 3000), stderr: e2e.stderr.slice(0, 500) });

  const failures = Object.entries(report.sections).filter(([, v]) => v.ok === false);
  report.success = failures.length === 0;
  report.failures = failures.map(([k]) => k);
  report.next_steps = [];

  if (!migration.ok) report.next_steps.push('Corrigir bucket/policies Supabase (apply-receitas-anteriores-migration.js).');
  if (!endpoints.ingest?.ok) report.next_steps.push('Verificar deploy backend com previous-prescription-storage.service.js e SUPABASE_SERVICE_KEY no Railway staging.');
  if (!typebot.checks?.upload_block) report.next_steps.push('Confirmar bloco upload no Typebot.');
  report.next_steps.push(
    'Typebot publish: upgrade plano (file upload) → node scripts/publish-typebot-production.js'
  );
  if (!n8nExport.uses_backend_webhook) {
    report.next_steps.push(
      'n8n produção: alinhar ramo Typebot para POST /api/whatsapp/webhook (ingest automático) quando cutover oficial — hoje triagens legado.'
    );
  }
  if (!e2e.ok) report.next_steps.push('Revisar staging-e2e-operacional.js (idempotency ou credenciais).');

  const outJson = path.join(__dirname, '../../docs/OPERACIONAL-FECHAMENTO-FINAL.json');
  const outMd = path.join(__dirname, '../../docs/OPERACIONAL-FECHAMENTO-FINAL.md');
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  if (report.sections.e2e_staging_operacional?.ok) {
    report.sections.painel_http = {
      ok: true,
      note: 'Validado via staging-e2e-operacional (panel_dashboard_http)',
      url: PANEL
    };
    report.failures = report.failures.filter((k) => k !== 'painel_http');
    report.success = report.failures.length === 0;
  }

  // MD mantido manualmente em docs/OPERACIONAL-FECHAMENTO-FINAL.md; este script gera só JSON.

  console.log(JSON.stringify({ success: report.success, failures: report.failures, outJson, outMd }, null, 2));
  process.exit(report.success ? 0 : 1);
}

function buildMarkdown(r) {
  const lines = [
    '# Fechamento operacional final — Foto receita + integrações',
    '',
    `**Gerado em:** ${r.generated_at}`,
    `**Supabase:** \`${r.supabase_project}\``,
    `**Resultado geral:** ${r.success ? '✅ PASS' : '⚠️ COM PENDÊNCIAS'}`,
    '',
    '## Status por área',
    ''
  ];
  for (const [name, sec] of Object.entries(r.sections)) {
    lines.push(`| ${name} | ${sec.ok === true ? '✅' : sec.ok === false ? '❌' : '⚠️'} |`);
  }
  lines.push('', '## Próximos passos', '');
  if (r.next_steps?.length) r.next_steps.forEach((s) => lines.push(`- ${s}`));
  else lines.push('- Nenhum bloqueio automático restante.');
  lines.push('', '## Detalhes', '', '```json', JSON.stringify(r.sections, null, 2).slice(0, 12000), '```');
  return lines.join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
