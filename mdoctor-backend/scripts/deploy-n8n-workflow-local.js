#!/usr/bin/env node
/**
 * Entrypoint Node para deploy local (equivalente ao .ps1).
 * Carrega docker/n8n/.env e delega para deploy-n8n-workflow.js
 *
 * Uso:
 *   node mdoctor-backend/scripts/deploy-n8n-workflow-local.js docs/n8n-workflows/typebot-webhook-staging.json
 */

const path = require('path');
const { applyDockerN8nEnv } = require('./lib/load-docker-n8n-env');
const log = require('./lib/n8n-deploy-log');

const workflowArg = process.argv[2];
if (!workflowArg) {
  log.fail('Informe o caminho do workflow JSON.');
  log.info('Exemplo: node deploy-n8n-workflow-local.js docs/n8n-workflows/typebot-webhook-staging.json');
  process.exit(1);
}

const loaded = applyDockerN8nEnv();
if (!loaded.found) {
  log.fail(`docker/n8n/.env não encontrado (${loaded.file})`);
  process.exit(1);
}
if (loaded.applied.length) {
  log.info(`Variáveis carregadas de .env: ${loaded.applied.join(', ')}`);
}

process.env.N8N_TARGET = 'local';
process.env.N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5678';
process.env.N8N_WORKFLOW_FILE = workflowArg;

require('./deploy-n8n-workflow.js');
