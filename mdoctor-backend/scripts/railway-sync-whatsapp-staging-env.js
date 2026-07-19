#!/usr/bin/env node
/**
 * Sincroniza credenciais Meta WhatsApp do ambiente → Railway staging backend.
 * Não imprime valores de token/secret completos.
 *
 * Uso:
 *   WHATSAPP_ACCESS_TOKEN=... \
 *   WHATSAPP_PHONE_NUMBER_ID=1030563506816702 \
 *   WHATSAPP_BUSINESS_ACCOUNT_ID=1293601975703284 \
 *   node mdoctor-backend/scripts/railway-sync-whatsapp-staging-env.js
 *
 * Requer: railway login (CLI) autenticado no projeto Backend-MDoctor-Staging.
 */
require('./load-dotenv');
const { execSync } = require('child_process');

const PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const STAGING_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const STAGING_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

const KEYS = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_PROVIDER',
  'WHATSAPP_ENABLED'
];

function setVar(key, value) {
  if (value == null || value === '') return;
  const sensitive = /TOKEN|SECRET|KEY/i.test(key);
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
}

const defaults = {
  WHATSAPP_PROVIDER: 'meta',
  WHATSAPP_ENABLED: 'true'
};

const applied = [];
for (const key of KEYS) {
  const val = process.env[key] ?? defaults[key];
  if (!val) continue;
  setVar(key, val);
  applied.push(key);
}

console.log(JSON.stringify({ ok: true, applied }, null, 2));
