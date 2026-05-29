/**
 * Carrega variáveis de docker/n8n/.env para deploy local.
 * Não sobrescreve variáveis já definidas no processo (exceto com override: true).
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.resolve(__dirname, '../../../docker/n8n/.env');

const DEFAULT_KEYS = [
  'N8N_BASIC_AUTH_USER',
  'N8N_BASIC_AUTH_PASSWORD',
  'N8N_API_KEY',
  'N8N_BASE_URL',
  'N8N_HOST',
  'N8N_PORT'
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, vars: {} };
  }
  const vars = {};
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return { exists: true, vars };
}

function applyDockerN8nEnv(options = {}) {
  const keys = options.keys || DEFAULT_KEYS;
  const override = Boolean(options.override);
  const { exists, vars } = parseEnvFile(ENV_FILE);
  const applied = [];

  for (const key of keys) {
    const value = vars[key];
    if (value === undefined || value === '') continue;
    if (!override && process.env[key]) continue;
    process.env[key] = value;
    applied.push(key);
  }

  return { file: ENV_FILE, found: exists, applied, vars };
}

function maskSecret(value) {
  const s = String(value || '');
  if (s.length <= 4) return '****';
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

module.exports = {
  ENV_FILE,
  DEFAULT_KEYS,
  parseEnvFile,
  applyDockerN8nEnv,
  maskSecret
};
