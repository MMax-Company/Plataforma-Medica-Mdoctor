#!/usr/bin/env node
/**
 * Sincroniza credenciais Supabase oficial do .env → Railway staging backend.
 * Não imprime valores de KEY/SECRET/URL completos.
 */
require('./load-dotenv');
const { execSync } = require('child_process');

const PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const STAGING_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const STAGING_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

const KEYS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_REQUIRED',
  'DISABLE_LOCAL_DB_FALLBACK',
  'ENVIRONMENT_NAME'
];

function setVar(key, value) {
  if (value == null || value === '') return;
  const sensitive = /KEY|SECRET|PASS|URL/i.test(key);
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

const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

const values = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  SUPABASE_SERVICE_KEY: serviceKey,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_REQUIRED: process.env.SUPABASE_REQUIRED || 'true',
  DISABLE_LOCAL_DB_FALLBACK: process.env.DISABLE_LOCAL_DB_FALLBACK || 'true',
  ENVIRONMENT_NAME: process.env.ENVIRONMENT_NAME || 'staging'
};

const applied = [];
for (const key of KEYS) {
  if (values[key] == null || values[key] === '') continue;
  setVar(key, values[key]);
  applied.push(key);
}

const ref = (values.SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase/)?.[1] || null;
console.log(JSON.stringify({ ok: true, applied, supabase_ref: ref }, null, 2));
