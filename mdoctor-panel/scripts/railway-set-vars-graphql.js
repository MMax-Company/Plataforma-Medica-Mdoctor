#!/usr/bin/env node
/** Set Railway variables via GraphQL (when CLI refresh fails). */
const fs = require('fs');
const path = require('path');

const CONFIG = path.join(process.env.USERPROFILE || process.env.HOME, '.railway/config.json');
const BACKEND_PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const BACKEND_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const BACKEND_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';
const PANEL_PROJECT = '3bec26a7-422e-40ae-8763-2a4c5158fef4';
const PANEL_ENV = 'faae345a-79ee-46e9-abf6-d2dedd08a538';
const PANEL_SERVICE = '626fc9d2-3f6a-417c-b3a7-e3e21846edb8';

const BACKEND_URL = 'https://mdoctor-backend-staging-staging.up.railway.app';
const PANEL_URL = 'https://painel-medico-staging-staging.up.railway.app';
const MEDICO_PASS = process.env.MEDICO_PASS || 'Gr@tid@0';

async function gql(token, query, variables) {
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function upsertVars(token, projectId, environmentId, serviceId, vars) {
  const input = Object.entries(vars).map(([name, value]) => ({ name, value }));
  const query = `
    mutation variableCollectionUpsert($projectId: String!, $environmentId: String!, $serviceId: String!, $variables: [VariableUpsertInput!]!) {
      variableCollectionUpsert(input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, variables: $variables }) {
        id
      }
    }
  `;
  return gql(token, query, { projectId, environmentId, serviceId, variables: input });
}

async function triggerDeploy(token, serviceId, environmentId) {
  const query = `
    mutation serviceInstanceDeploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
    }
  `;
  return gql(token, query, { serviceId, environmentId });
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const token = cfg.user?.accessToken;
  if (!token) throw new Error('No accessToken in ~/.railway/config.json — run railway login');

  console.log('Setting backend vars...');
  await upsertVars(token, BACKEND_PROJECT, BACKEND_ENV, BACKEND_SERVICE, {
    MEDICO_USER: 'drmax.matos',
    MEDICO_PASS: MEDICO_PASS,
    MEDICO_EXTERNAL_ID: 'drmax.matos',
    MEDICO_NOME: 'Dr Max Matos',
    MEDICO_ROLE: 'admin',
    CORS_ORIGIN: PANEL_URL,
  });

  console.log('Setting panel vars...');
  await upsertVars(token, PANEL_PROJECT, PANEL_ENV, PANEL_SERVICE, {
    NEXT_PUBLIC_API_URL: BACKEND_URL,
    API_PROXY_TARGET: BACKEND_URL,
    NEXT_PUBLIC_APP_ENV: 'staging',
    NEXT_PUBLIC_ENABLE_MOCK_FALLBACK: 'false',
  });

  console.log('Triggering redeploy backend + panel...');
  await triggerDeploy(token, BACKEND_SERVICE, BACKEND_ENV);
  await triggerDeploy(token, PANEL_SERVICE, PANEL_ENV);

  console.log('Done. Wait ~2-3 min for deploy, then run painel-tour-visual.js');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
