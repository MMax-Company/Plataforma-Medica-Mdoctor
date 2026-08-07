#!/usr/bin/env node
/** Gera .env.production.local — marcador obrigatório de deploy oficial staging. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..');
const out = path.join(root, '.env.production.local');

// Checa uma vez se o binário existe antes de tentar qualquer comando —
// evita o ruído "git: not found" no log de build em imagens sem git
// (ex.: node:20-alpine), sem precisar instalar git só para isso.
let hasGit = null;
function gitAvailable() {
  if (hasGit === null) {
    try {
      execSync('git --version', { stdio: 'ignore' });
      hasGit = true;
    } catch {
      hasGit = false;
    }
  }
  return hasGit;
}

function git(cmd, cwd) {
  if (!gitAvailable()) return '';
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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

// Distingue staging de produção pela env real do Railway — evita gravar
// valores de staging (backend, marcador de faixa) fixos num build de
// produção. RAILWAY_ENVIRONMENT_NAME é injetada pelo próprio Railway em
// todo build; fora do Railway (build local), cai no comportamento de
// staging já existente.
const isProduction = process.env.RAILWAY_ENVIRONMENT_NAME === 'production';

const appEnv = isProduction ? 'production' : 'staging';
const apiBaseUrl = isProduction
  ? 'https://web-production-5f178.up.railway.app'
  : 'https://mdoctor-backend-staging-staging.up.railway.app';
const stagingBuildMarker = isProduction ? 'false' : 'true';

const lines = [
  `NEXT_PUBLIC_BUILD_COMMIT=${commit}`,
  `NEXT_PUBLIC_BUILD_BRANCH=${branch}`,
  `NEXT_PUBLIC_BUILD_TIME=${builtAt}`,
  `NEXT_PUBLIC_BUILD_ID=${buildId}`,
  'NEXT_PUBLIC_PANEL_MARKER=DOCTOR-PRESCREVE-OFICIAL',
  `NEXT_PUBLIC_RAILWAY_SERVICE=${process.env.RAILWAY_SERVICE_NAME || 'painel-medico-staging'}`,
  'NEXT_PUBLIC_RAILWAY_PROJECT=Painel-MDoctor',
  `NEXT_PUBLIC_APP_ENV=${appEnv}`,
  // API_PROXY_TARGET é lida por next.config.mjs (destino do proxy /api/*
  // usado pelo navegador) — precisa vir daqui pela mesma razão que as
  // NEXT_PUBLIC_*: o Dockerfile não fixa mais isso com default de staging.
  `API_PROXY_TARGET=${apiBaseUrl}`,
  `NEXT_PUBLIC_API_BASE_URL=${apiBaseUrl}`,
  `NEXT_PUBLIC_API_URL=${apiBaseUrl}`,
  'NEXT_PUBLIC_MEMED_REAL_ENABLED=true',
  `NEXT_PUBLIC_STAGING_BUILD_MARKER=${stagingBuildMarker}`,
  'NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false',
];

fs.writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({
  ok: true,
  path: out,
  commit,
  branch,
  buildId,
  builtAt,
  railwayEnvironmentName: process.env.RAILWAY_ENVIRONMENT_NAME || null,
  isProduction,
  appEnv,
  apiBaseUrl,
  stagingBuildMarker,
}, null, 2));
