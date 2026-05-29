/**
 * Create/activate an n8n staging workflow via REST API (owner login).
 * Uses n8n owner credentials (not committed). Env overrides supported.
 *
 * Env:
 *   N8N_WORKFLOW_FILE - path to workflow JSON (required)
 */

const fs = require('fs');
const path = require('path');

const base = String(process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(
  /\/$/,
  ''
);
const email = String(process.env.N8N_OWNER_EMAIL || 'staging-n8n@example.com');
const password = String(process.env.N8N_OWNER_PASSWORD || 'TempPass123!');
if (!process.env.N8N_WORKFLOW_FILE) {
  console.error('N8N_WORKFLOW_FILE is required');
  process.exit(1);
}
const workflowFile = process.env.N8N_WORKFLOW_FILE;

const workflow = JSON.parse(fs.readFileSync(path.resolve(workflowFile), 'utf8'));

async function parseJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw
    .split(',')
    .map((part) => part.trim().split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function login() {
  await fetch(`${base}/rest/owner/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, firstName: 'Staging', lastName: 'N8N', password })
  });

  const loginRes = await fetch(`${base}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrLdapLoginId: email, password })
  });
  const cookie = cookieFrom(loginRes);
  if (!cookie) throw new Error(`n8n login failed: ${loginRes.status}`);
  return cookie;
}

async function main() {
  const cookie = await login();

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
  if (!createRes.ok) throw new Error(`create workflow failed: ${createRes.status} ${JSON.stringify(created)}`);

  const id = created?.data?.id;
  const versionId = created?.data?.versionId;
  const activateRes = await fetch(`${base}/rest/workflows/${id}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ versionId })
  });
  const activated = await parseJson(activateRes);
  if (!activateRes.ok) throw new Error(`activate failed: ${activateRes.status} ${JSON.stringify(activated)}`);

  console.log(
    JSON.stringify(
      {
        success: true,
        workflowId: id,
        versionId,
        name: workflow.name,
        active: true,
        workflowFile: path.resolve(workflowFile)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
