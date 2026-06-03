#!/usr/bin/env node
/**
 * Exporta workflows n8n de produção para docs/backups/ (sem secrets).
 *
 * Env: N8N_BASE_URL, N8N_API_KEY
 * Uso: node scripts/backup-n8n-workflows-production.js
 */
const fs = require('fs');
const path = require('path');

const base = String(process.env.N8N_BASE_URL || 'https://n8n-node-production-f844.up.railway.app').replace(
  /\/$/,
  ''
);
const apiKey = String(process.env.N8N_API_KEY || '').trim();
const outDir = path.join(__dirname, '../docs/backups');
const date = new Date().toISOString().slice(0, 10);

const TARGETS = [
  { match: /evolution\s+webhook/i, file: `${date}-evolution-webhook-production.json` },
  { match: /typebot/i, file: `${date}-typebot-webhook-production.json`, pathHint: 'typebot-webhook' }
];

function sanitizeWorkflow(wf) {
  const copy = JSON.parse(JSON.stringify(wf));
  delete copy.shared;
  if (Array.isArray(copy.nodes)) {
    for (const node of copy.nodes) {
      if (node.credentials) {
        for (const key of Object.keys(node.credentials)) {
          node.credentials[key] = { id: node.credentials[key]?.id, name: node.credentials[key]?.name };
        }
      }
    }
  }
  return copy;
}

async function listWorkflows() {
  const res = await fetch(`${base}/api/v1/workflows?limit=250`, {
    headers: { 'X-N8N-API-KEY': apiKey, accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`list workflows HTTP ${res.status}`);
  const data = await res.json();
  return data.data || data || [];
}

async function exportOne(id) {
  const res = await fetch(`${base}/api/v1/workflows/${id}`, {
    headers: { 'X-N8N-API-KEY': apiKey, accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`get workflow ${id} HTTP ${res.status}`);
  const data = await res.json();
  return data.data || data;
}

function workflowHasPath(wf, pathHint) {
  if (!pathHint) return true;
  return (wf.nodes || []).some(
    (n) => n.type === 'n8n-nodes-base.webhook' && String(n.parameters?.path || '').includes(pathHint)
  );
}

async function main() {
  if (!apiKey) {
    console.error('N8N_API_KEY obrigatória');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const list = await listWorkflows();
  const exported = [];

  for (const target of TARGETS) {
    const candidates = list.filter((w) => target.match.test(w.name));
    if (!candidates.length) {
      exported.push({ target: target.file, ok: false, error: 'workflow não encontrado' });
      continue;
    }

    let full = null;
    let pick = null;
    for (const c of candidates.sort((a, b) => Number(b.active) - Number(a.active))) {
      const wf = await exportOne(c.id);
      if (!target.pathHint || workflowHasPath(wf, target.pathHint)) {
        full = wf;
        pick = c;
        break;
      }
    }
    if (!full) {
      full = await exportOne(candidates[0].id);
      pick = candidates[0];
    }

    const safe = sanitizeWorkflow(full);
    const outPath = path.join(outDir, target.file);
    fs.writeFileSync(outPath, `${JSON.stringify(safe, null, 2)}\n`, 'utf8');
    exported.push({
      target: target.file,
      ok: true,
      id: safe.id,
      name: safe.name,
      active: safe.active,
      path: outPath
    });
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    baseUrl: base,
    exported
  };
  fs.writeFileSync(path.join(outDir, `${date}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
  if (!exported.every((e) => e.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
