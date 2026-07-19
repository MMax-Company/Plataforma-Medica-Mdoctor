#!/usr/bin/env node
/**
 * Sincroniza credenciais Meta WhatsApp do ambiente → Railway staging backend.
 * Não imprime valores de token/secret completos.
 *
 * Uso:
 *   RAILWAY_TOKEN=... \
 *   WHATSAPP_ACCESS_TOKEN=... \
 *   WHATSAPP_PHONE_NUMBER_ID=1030563506816702 \
 *   WHATSAPP_BUSINESS_ACCOUNT_ID=1293601975703284 \
 *   node mdoctor-backend/scripts/railway-sync-whatsapp-staging-env.js
 *
 * Requer: RAILWAY_TOKEN (Project Access Token do ambiente staging) ou railway login.
 * Opcional: REDEPLOY=1 para disparar redeploy após setar variáveis.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

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

const defaults = {
  WHATSAPP_PROVIDER: 'meta',
  WHATSAPP_ENABLED: 'true'
};

function resolveToken() {
  if (process.env.RAILWAY_TOKEN) return String(process.env.RAILWAY_TOKEN).trim();
  const cfgPath = path.join(process.env.HOME || '', '.railway/config.json');
  if (!fs.existsSync(cfgPath)) return null;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  return cfg.user?.accessToken || cfg.token || null;
}

function buildHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (/^[0-9a-f-]{36}$/i.test(token)) {
    headers['Project-Access-Token'] = token;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function gql(token, query, variables) {
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function assertStagingAccess(token) {
  try {
    await gql(token, `
      query($projectId: String!, $environmentId: String!, $serviceId: String!) {
        variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
      }
    `, { projectId: PROJECT, environmentId: STAGING_ENV, serviceId: STAGING_SERVICE });
  } catch (error) {
    const message = String(error.message || error);
    if (/Not Authorized/i.test(message)) {
      throw new Error(
        'RAILWAY_TOKEN sem acesso ao ambiente staging. Gere um Project Access Token ' +
        'em Backend-Mdoctor → environment staging → Settings → Tokens (nao use token so de production).'
      );
    }
    throw error;
  }
}

async function upsertVar(token, name, value) {
  const query = `
    mutation variableUpsert($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `;
  return gql(token, query, {
    input: {
      projectId: PROJECT,
      environmentId: STAGING_ENV,
      serviceId: STAGING_SERVICE,
      name,
      value: String(value),
      skipDeploys: process.env.REDEPLOY !== '1'
    }
  });
}

async function triggerDeploy(token) {
  const query = `
    mutation serviceInstanceDeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `;
  return gql(token, query, { serviceId: STAGING_SERVICE, environmentId: STAGING_ENV });
}

async function main() {
  const token = resolveToken();
  if (!token) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Railway token ausente. Export RAILWAY_TOKEN (Project Access Token) ou rode railway login.'
    }));
    process.exit(1);
  }

  const vars = {};
  const applied = [];
  for (const key of KEYS) {
    const val = process.env[key] ?? defaults[key];
    if (!val) continue;
    vars[key] = val;
    applied.push(key);
  }

  if (!vars.WHATSAPP_ACCESS_TOKEN) {
    console.error(JSON.stringify({ ok: false, error: 'WHATSAPP_ACCESS_TOKEN é obrigatório.' }));
    process.exit(1);
  }

  await assertStagingAccess(token);
  for (const [key, value] of Object.entries(vars)) {
    await upsertVar(token, key, value);
  }

  const result = { ok: true, applied, service: 'mdoctor-backend-staging', environmentId: STAGING_ENV };
  if (process.env.REDEPLOY === '1') {
    await triggerDeploy(token);
    result.redeploy = true;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
