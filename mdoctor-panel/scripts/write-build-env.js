#!/usr/bin/env node
/** Gera .env.production.local — marcador obrigatório de deploy oficial staging. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..');
const out = path.join(root, '.env.production.local');

function git(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const commit =
  git('git rev-parse HEAD', repoRoot) ||
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  'unknown';
const branch = git('git rev-parse --abbrev-ref HEAD', repoRoot) || 'unknown';
const builtAt = new Date().toISOString();
const buildId = crypto.createHash('sha256').update(`${commit}:${builtAt}`).digest('hex').slice(0, 12);

const lines = [
  `NEXT_PUBLIC_BUILD_COMMIT=${commit}`,
  `NEXT_PUBLIC_BUILD_BRANCH=${branch}`,
  `NEXT_PUBLIC_BUILD_TIME=${builtAt}`,
  `NEXT_PUBLIC_BUILD_ID=${buildId}`,
  'NEXT_PUBLIC_PANEL_MARKER=DOCTOR-PRESCREVE-OFICIAL',
  'NEXT_PUBLIC_RAILWAY_SERVICE=painel-medico-staging',
  'NEXT_PUBLIC_RAILWAY_PROJECT=Painel-MDoctor',
  'NEXT_PUBLIC_APP_ENV=staging',
  'NEXT_PUBLIC_API_BASE_URL=https://mdoctor-backend-staging-staging.up.railway.app',
  'NEXT_PUBLIC_API_URL=https://mdoctor-backend-staging-staging.up.railway.app',
  'NEXT_PUBLIC_MEMED_REAL_ENABLED=true',
  'NEXT_PUBLIC_STAGING_BUILD_MARKER=true',
  'NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false',
];

fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, path: out, commit, branch, buildId, builtAt }, null, 2));
