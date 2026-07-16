#!/usr/bin/env node
/**
 * Publica workflows n8n staging via REST (cookie owner). Um login por execução.
 * Env: N8N_OWNER_EMAIL, N8N_OWNER_PASSWORD, N8N_BASE_URL
 */
const fs = require('fs');
const path = require('path');

const base = String(
  process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app'
).replace(/\/$/, '');
const email = String(process.env.N8N_OWNER_EMAIL || 'staging-n8n@example.com');
const password = String(process.env.N8N_OWNER_PASSWORD || 'TempPass123!');

const workflows = [
  'docs/n8n-workflows/typebot-webhook-staging.json',
  'docs/n8n-workflows/clinical-rejection-notify-staging.json',
  'docs/n8n-workflows/stripe-payment-staging.json',
  'docs/n8n-workflows/prescription-delivery-staging.json',
  'docs/n8n-workflows/doctor-prescreve-staging-safe.json'
];

const root = path.join(__dirname, '../..');

function cookieFrom(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers
      .getSetCookie()
      .map((part) => part.split(';')[0])
      .join('; ');
  }
  const raw = response.headers.get('set-cookie') || '';
  if (!raw) return '';
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((part) => part.trim().split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function parseJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function login() {
  const loginRes = await fetch(`${base}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrLdapLoginId: email, password })
  });
  const cookie = cookieFrom(loginRes);
  if (!cookie) {
    throw new Error(`n8n login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  return cookie;
}

async function deployOne(cookie, workflowFile) {
  const abs = path.resolve(root, workflowFile);
  const workflow = JSON.parse(fs.readFileSync(abs, 'utf8'));

  const listRes = await fetch(`${base}/rest/workflows?limit=200`, { headers: { Cookie: cookie } });
  const listJson = await parseJson(listRes);
  const existing = (listJson.data || []).filter((wf) => wf.name === workflow.name);
  for (const wf of existing) {
    await fetch(`${base}/rest/workflows/${wf.id}/deactivate`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    await fetch(`${base}/rest/workflows/${wf.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie }
    });
  }

  const createRes = await fetch(`${base}/rest/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(workflow)
  });
  const created = await parseJson(createRes);
  if (!createRes.ok) {
    throw new Error(`create failed ${workflow.name}: ${createRes.status} ${JSON.stringify(created)}`);
  }

  const id = created?.data?.id;
  const versionId = created?.data?.versionId;
  const activateRes = await fetch(`${base}/rest/workflows/${id}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ versionId })
  });
  const activated = await parseJson(activateRes);
  if (!activateRes.ok) {
    throw new Error(`activate failed ${workflow.name}: ${activateRes.status} ${JSON.stringify(activated)}`);
  }

  return { name: workflow.name, id, workflowFile };
}

async function main() {
  const cookie = await login();
  const results = [];
  for (const wf of workflows) {
    process.stdout.write(`>> ${wf} ... `);
    try {
      const r = await deployOne(cookie, wf);
      results.push({ ...r, ok: true });
      console.log('OK');
    } catch (e) {
      results.push({ workflowFile: wf, ok: false, error: e.message });
      console.log('ERRO');
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(JSON.stringify({ results }, null, 2));
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
