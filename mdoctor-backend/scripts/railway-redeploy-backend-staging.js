#!/usr/bin/env node
/**
 * Redeploy mdoctor-backend-staging via Railway GraphQL.
 * Requer: ~/.railway/config.json (railway login) OU RAILWAY_TOKEN
 */
const fs = require('fs');
const path = require('path');

const PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const STAGING_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const STAGING_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

function resolveToken() {
  if (process.env.RAILWAY_TOKEN) return String(process.env.RAILWAY_TOKEN).trim();
  const cfgPath = path.join(process.env.HOME || '', '.railway/config.json');
  if (!fs.existsSync(cfgPath)) return null;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  return cfg.user?.accessToken || cfg.token || null;
}

async function gql(token, query, variables) {
  const headers = { 'Content-Type': 'application/json' };
  if (/^[0-9a-f-]{36}$/i.test(token)) {
    headers['Project-Access-Token'] = token;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function main() {
  const token = resolveToken();
  if (!token) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Railway token ausente. Rode railway login ou export RAILWAY_TOKEN.'
    }));
    process.exit(1);
  }

  const query = `
    mutation serviceInstanceDeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `;
  const data = await gql(token, query, {
    serviceId: STAGING_SERVICE,
    environmentId: STAGING_ENV
  });

  console.log(JSON.stringify({
    ok: true,
    service: 'mdoctor-backend-staging',
    projectId: PROJECT,
    deploy: data.serviceInstanceDeploy || true
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
