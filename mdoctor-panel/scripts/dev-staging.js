#!/usr/bin/env node
/**
 * Dev local opcional — UI aponta direto ao backend Railway staging.
 * Ambiente operacional oficial: https://painel-medico-staging-staging.up.railway.app
 */
const { spawn } = require('node:child_process');

const backendStagingUrl = 'https://mdoctor-backend-staging-staging.up.railway.app';
const panelStagingUrl = 'https://painel-medico-staging-staging.up.railway.app';

console.warn('[dev:staging] Ambiente operacional oficial:', panelStagingUrl + '/login');
console.warn('[dev:staging] Dev local é apenas para debug de UI.');
console.log('[dev:staging] Backend API →', backendStagingUrl);

const child = spawn('npx', ['next', 'dev', '-p', '3000'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    NEXT_PUBLIC_API_URL: backendStagingUrl,
    NEXT_PUBLIC_APP_ENV: 'staging',
    NEXT_PUBLIC_ENABLE_MOCK_FALLBACK: 'false',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
