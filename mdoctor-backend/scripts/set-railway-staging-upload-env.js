#!/usr/bin/env node
/**
 * Define variáveis de upload externo no backend staging (Railway CLI).
 */
const { execSync } = require('child_process');
const path = require('path');

require('./load-dotenv');

const vars = {
  PRESCRIPTION_EXTERNAL_UPLOAD: 'true',
  UPLOAD_PAGE_BASE_URL: 'https://painel-medico-staging-staging.up.railway.app',
  PUBLIC_BASE_URL: 'https://mdoctor-backend-staging-staging.up.railway.app',
  PRESCRIPTION_UPLOAD_TOKEN_TTL_MS: '86400000',
  SUPABASE_BUCKET_RECEITAS_ANTERIORES: 'receitas-anteriores'
};

const service = process.env.RAILWAY_SERVICE || 'mdoctor-backend-staging';
const project = process.env.RAILWAY_PROJECT || '';
const cwd = path.join(__dirname, '..');

function run(cmd) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

const results = [];
for (const [key, value] of Object.entries(vars)) {
  try {
    const scope = project ? `-p ${project} ` : '';
    const out = run(`railway variables --set "${key}=${value}" ${scope}-s ${service}`.replace(/\s+/g, ' ').trim());
    results.push({ key, ok: true, out: (out || '').trim().slice(0, 120) });
  } catch (error) {
    results.push({ key, ok: false, error: (error.stderr || error.message || '').trim().slice(0, 200) });
  }
}

console.log(JSON.stringify({ service, project: project || null, results }, null, 2));
if (results.some((r) => !r.ok)) process.exit(1);
