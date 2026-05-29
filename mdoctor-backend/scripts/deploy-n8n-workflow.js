/**
 * Import/update an n8n workflow JSON via REST API.
 *
 * Env:
 *   N8N_BASE_URL (default https://n8n-staging-staging-2dfe.up.railway.app)
 *   N8N_API_KEY (required)
 *   N8N_WORKFLOW_FILE (required path to workflow json)
 */

const fs = require('fs');
const path = require('path');

const baseUrl = String(process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(/\/$/, '');
const apiKey = String(process.env.N8N_API_KEY || '').trim();
const workflowFile = process.env.N8N_WORKFLOW_FILE;

if (!apiKey) {
  console.error('N8N_API_KEY is required');
  process.exit(1);
}
if (!workflowFile) {
  console.error('N8N_WORKFLOW_FILE is required');
  process.exit(1);
}

const workflowPath = path.resolve(workflowFile);
const payload = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

async function request(method, urlPath, body) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': apiKey
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${urlPath} -> ${response.status}: ${text}`);
  }
  return data;
}

async function main() {
  const existing = await request('GET', '/api/v1/workflows?limit=100');
  const list = Array.isArray(existing?.data) ? existing.data : existing;
  const found = list.find((w) => w.name === payload.name);

  let saved;
  if (found?.id) {
    saved = await request('PATCH', `/api/v1/workflows/${found.id}`, {
      ...payload,
      id: found.id
    });
    if (payload.active) {
      await request('POST', `/api/v1/workflows/${found.id}/activate`);
    }
    console.log(JSON.stringify({ action: 'updated', id: found.id, name: payload.name, active: payload.active }, null, 2));
  } else {
    saved = await request('POST', '/api/v1/workflows', payload);
    if (payload.active && saved?.id) {
      await request('POST', `/api/v1/workflows/${saved.id}/activate`);
    }
    console.log(JSON.stringify({ action: 'created', id: saved?.id, name: payload.name, active: payload.active }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
