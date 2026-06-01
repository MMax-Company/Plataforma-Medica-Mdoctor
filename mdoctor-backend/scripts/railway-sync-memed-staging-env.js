#!/usr/bin/env node
/**
 * Sincroniza MEMED_* para mdoctor-backend-staging a partir do .env local.
 * NÃO copia mais de web/production (evita acoplar staging à produção Memed).
 *
 * Uso: LOAD_RAILWAY_VARS=0 node scripts/railway-sync-memed-staging-env.js
 */
require('./load-dotenv');
const { execSync } = require('child_process');
const { applyMemedEnvAliases } = require('../src/config/memed-runtime');

applyMemedEnvAliases();

const PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const STAGING_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const STAGING_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

const MEMED_PREFIX = /^MEMED_/;

function setVar(key, value) {
  if (value == null || value === '') return false;
  const sensitive = /KEY|SECRET|TOKEN|PASS/i.test(key);
  if (sensitive) {
    execSync(
      `railway variable set ${key} --stdin --skip-deploys -p ${PROJECT} -e ${STAGING_ENV} -s ${STAGING_SERVICE}`,
      { input: String(value), stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } else {
    execSync(
      `railway variable set ${key}=${JSON.stringify(String(value))} --skip-deploys -p ${PROJECT} -e ${STAGING_ENV} -s ${STAGING_SERVICE}`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
  }
  return true;
}

const defaults = {
  MEMED_ENABLED: 'true',
  MEMED_REAL_ENABLED: process.env.MEMED_REAL_ENABLED || 'true',
  MEMED_ALLOW_MOCK_FALLBACK: process.env.MEMED_ALLOW_MOCK_FALLBACK || 'false',
  MEMED_ENV: process.env.MEMED_ENV || process.env.MEMED_ENVIRONMENT || 'sandbox',
  MEMED_ENVIRONMENT: process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV || 'sandbox',
  MEMED_API_URL:
    process.env.MEMED_API_URL ||
    (String(process.env.MEMED_ENV || '').includes('production')
      ? 'https://api.memed.com.br/v1'
      : 'https://integrations.api.memed.com.br/v1'),
  MEMED_TIMEOUT_MS: process.env.MEMED_TIMEOUT_MS || '15000',
  MEMED_RETRY_ATTEMPTS: process.env.MEMED_RETRY_ATTEMPTS || '2'
};

const fromEnv = Object.keys(process.env).filter((k) => MEMED_PREFIX.test(k));
const keys = new Set([...fromEnv, ...Object.keys(defaults)]);
const applied = [];

for (const key of keys) {
  const value = Object.prototype.hasOwnProperty.call(defaults, key)
    ? defaults[key]
    : process.env[key];
  if (!value) continue;
  if (setVar(key, value)) {
    applied.push(/KEY|SECRET|TOKEN/i.test(key) ? `${key}=<redacted>` : `${key}=${value}`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      service: 'mdoctor-backend-staging',
      applied_count: applied.length,
      applied,
      note: 'Execute railway redeploy na service staging após sync.'
    },
    null,
    2
  )
);
