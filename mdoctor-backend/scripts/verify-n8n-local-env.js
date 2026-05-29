#!/usr/bin/env node
/**
 * Valida leitura de docker/n8n/.env e healthcheck do container local.
 */

const { applyDockerN8nEnv, ENV_FILE, maskSecret } = require('./lib/load-docker-n8n-env');
const log = require('./lib/n8n-deploy-log');

const LOCAL_URL = 'http://localhost:5678';

async function main() {
  const loaded = applyDockerN8nEnv({ override: false });
  if (!loaded.found) {
    log.fail(`Arquivo não encontrado: ${ENV_FILE}`);
    process.exit(1);
  }

  log.ok(`Arquivo .env encontrado: ${ENV_FILE}`);
  if (loaded.applied.length) {
    log.info(`Variáveis aplicadas: ${loaded.applied.join(', ')}`);
  } else {
    log.warn('Nenhuma variável nova aplicada (já definidas no ambiente ou vazias no .env)');
  }

  const user = process.env.N8N_BASIC_AUTH_USER || '(ausente)';
  const hasPass = Boolean(process.env.N8N_BASIC_AUTH_PASSWORD);
  const hasKey = Boolean(process.env.N8N_API_KEY);
  log.info(`N8N_BASIC_AUTH_USER=${user}`);
  log.info(`N8N_BASIC_AUTH_PASSWORD=${hasPass ? maskSecret(process.env.N8N_BASIC_AUTH_PASSWORD) : '(ausente)'}`);
  log.info(`N8N_API_KEY=${hasKey ? maskSecret(process.env.N8N_API_KEY) : '(ausente — criar na UI)'}`);

  try {
    const res = await fetch(`${LOCAL_URL}/healthz`);
    if (res.ok) {
      log.ok(`Healthcheck ${LOCAL_URL}/healthz → HTTP ${res.status}`);
    } else {
      log.fail(`Healthcheck falhou → HTTP ${res.status}`);
      process.exit(1);
    }
  } catch (error) {
    log.fail(`n8n local inacessível: ${error.message}`);
    log.info('Execute: cd docker/n8n && docker compose up -d');
    process.exit(1);
  }
}

main();
