#!/usr/bin/env node
/**
 * Valida docs/n8n-workflows/evolution-webhook-staging.json (conexões + nós).
 * Uso: node scripts/validate-evolution-webhook-json.js
 */
const fs = require('fs');
const path = require('path');
const {
  isEvolutionWebhookWorkflow,
  validateEvolutionWorkflowContent
} = require('./lib/n8n-deploy-validate');

const file =
  process.env.N8N_WORKFLOW_FILE ||
  path.join(__dirname, '../../docs/n8n-workflows/evolution-webhook-staging.json');
const payload = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

if (!isEvolutionWebhookWorkflow(payload)) {
  console.error(JSON.stringify({ ok: false, error: 'não é workflow Evolution' }, null, 2));
  process.exit(1);
}

const check = validateEvolutionWorkflowContent(
  { nodes: payload.nodes, connections: payload.connections },
  payload
);

if (check.ok) {
  console.log(JSON.stringify({ ok: true, file, ...check }, null, 2));
  process.exit(0);
}

console.error(JSON.stringify({ ok: false, file, ...check }, null, 2));
process.exit(1);
