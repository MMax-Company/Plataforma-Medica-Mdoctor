#!/usr/bin/env node
/**
 * Publica todos os workflows staging Doctor Prescreve via deploy-n8n-workflow.js
 * Requer N8N_API_KEY válida para https://n8n-staging-staging-2dfe.up.railway.app
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const stagingEnv = path.join(root, 'docker/n8n.staging.env');

if (!process.env.N8N_API_KEY && fs.existsSync(stagingEnv)) {
  const text = fs.readFileSync(stagingEnv, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^N8N_API_KEY=(.+)$/);
    if (m) process.env.N8N_API_KEY = m[1].trim();
  }
}

const workflows = [
  'docs/n8n-workflows/typebot-webhook-staging.json',
  'docs/n8n-workflows/clinical-rejection-notify-staging.json',
  'docs/n8n-workflows/prescription-delivery-staging.json'
  // stripe-payment-staging e doctor-prescreve-staging-safe: históricos desativados — não redeployar ativos
];

if (!process.env.N8N_API_KEY) {
  console.error('N8N_API_KEY ausente. Rode: node mdoctor-backend/scripts/ensure-n8n-staging-api-key.js');
  process.exit(1);
}

const results = [];
for (const wf of workflows) {
  const abs = path.join(root, wf).replace(/\\/g, '/');
  console.log(`\n>> deploy ${wf}`);
  try {
    execSync('node mdoctor-backend/scripts/deploy-n8n-workflow.js', {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        N8N_WORKFLOW_FILE: abs,
        N8N_BASE_URL: process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app'
      }
    });
    results.push({ file: wf, ok: true });
  } catch {
    results.push({ file: wf, ok: false });
  }
}

console.log(JSON.stringify({ results }, null, 2));
if (results.some((r) => !r.ok)) process.exit(1);
