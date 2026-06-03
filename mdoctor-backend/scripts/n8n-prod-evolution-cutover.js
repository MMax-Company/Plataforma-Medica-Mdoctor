#!/usr/bin/env node
/**
 * Pós-rotação N8N_API_KEY (produção): API → deploy evolution → webhook 200 → E2E.
 *
 * Env (Railway ou shell):
 *   N8N_BASE_URL=https://n8n-node-production-f844.up.railway.app
 *   N8N_API_KEY
 *   EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE (E2E)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const base = String(
  process.env.N8N_BASE_URL || 'https://n8n-node-production-f844.up.railway.app'
).replace(/\/$/, '');
const apiKey = String(process.env.N8N_API_KEY || '').trim();
const root = path.join(__dirname, '../..');
const stagingJson = path.join(root, 'docs/n8n-workflows/evolution-webhook-staging.json');
const os = require('os');
const prodJson = path.join(os.tmpdir(), 'evolution-webhook-production.json');

async function step1() {
  const res = await fetch(`${base}/api/v1/workflows?limit=3`, {
    headers: { 'X-N8N-API-KEY': apiKey, accept: 'application/json' }
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`step1 GET /api/v1/workflows → ${res.status} ${text.slice(0, 120)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  const count = Array.isArray(data?.data) ? data.data.length : '?';
  return { status: res.status, count };
}

function writeProductionWorkflowFile() {
  const payload = JSON.parse(fs.readFileSync(stagingJson, 'utf8'));
  payload.name = 'Evolution Webhook - Production';
  fs.writeFileSync(prodJson, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return prodJson;
}

function step2Deploy(workflowFile) {
  const env = {
    ...process.env,
    N8N_BASE_URL: base,
    N8N_API_KEY: apiKey,
    N8N_WORKFLOW_FILE: workflowFile,
    N8N_WEBHOOK_PATH: 'evolution-webhook'
  };
  const r = spawnSync('node', [path.join(__dirname, 'deploy-n8n-workflow.js')], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (r.status !== 0) {
    throw new Error(`step2 deploy failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

async function step3() {
  const url = `${base}/webhook/evolution-webhook`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const text = await res.text();
  if (res.status === 404 && text.includes('not registered')) {
    throw new Error(`step3 POST evolution-webhook → 404 (workflow inativo)`);
  }
  if (res.status >= 500) {
    throw new Error(`step3 POST evolution-webhook → ${res.status}`);
  }
  return { status: res.status, bodyPreview: text.slice(0, 200) };
}

function step4E2e() {
  const env = {
    ...process.env,
    N8N_EVOLUTION_WEBHOOK_URL: `${base}/webhook/evolution-webhook`,
    N8N_WEBHOOK_URL: `${base}/webhook/typebot-webhook`,
    BACKEND_URL:
      process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app',
    EVOLUTION_API_URL:
      process.env.EVOLUTION_API_URL ||
      'https://evolution-api-staging-staging-40d1.up.railway.app',
    EVOLUTION_INSTANCE: process.env.EVOLUTION_INSTANCE || 'mdoctor-staging'
  };
  const r = spawnSync('node', [path.join(__dirname, 'e2e-evolution-n8n-typebot-staging.js')], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (r.status !== 0) {
    throw new Error(`step4 e2e failed:\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

async function main() {
  if (!apiKey) {
    console.error('N8N_API_KEY obrigatória');
    process.exit(1);
  }

  const report = { baseUrl: base, steps: {} };

  report.steps.api = await step1();
  console.log(JSON.stringify({ step: 1, ok: true, ...report.steps.api }));

  const workflowFile = writeProductionWorkflowFile();
  report.steps.deploy = step2Deploy(workflowFile);
  console.log(JSON.stringify({ step: 2, ok: true, file: workflowFile }));

  report.steps.webhook = await step3();
  console.log(JSON.stringify({ step: 3, ok: true, ...report.steps.webhook }));

  report.steps.e2e = step4E2e();
  console.log(JSON.stringify({ step: 4, ok: true }));

  console.log(JSON.stringify({ success: true, ...report }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message }, null, 2));
  process.exit(1);
});
