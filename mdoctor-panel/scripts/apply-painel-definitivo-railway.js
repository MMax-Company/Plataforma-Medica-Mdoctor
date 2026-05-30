#!/usr/bin/env node
/**
 * Aplica credenciais e envs do painel definitivo no Railway staging.
 * Requer: railway login
 *
 * Uso:
 *   MEDICO_PASS='...' node scripts/apply-painel-definitivo-railway.js
 */
const { execSync } = require('child_process');

const BACKEND_PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const BACKEND_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const BACKEND_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

const PANEL_PROJECT = '3bec26a7-422e-40ae-8763-2a4c5158fef4';
const PANEL_ENV = 'staging';
const PANEL_SERVICE = 'painel-medico-staging';

const BACKEND_URL = 'https://mdoctor-backend-staging-staging.up.railway.app';
const PANEL_URL = 'https://painel-medico-staging-staging.up.railway.app';
const MEDICO_PASS = process.env.MEDICO_PASS || '';

function run(cmd) {
  console.log('>', cmd.replace(/MEDICO_PASS=[^\s"]+/g, 'MEDICO_PASS=***'));
  execSync(cmd, { stdio: 'inherit', shell: true });
}

function main() {
  if (!MEDICO_PASS) {
    console.error('Defina MEDICO_PASS antes de executar.');
    process.exit(1);
  }

  run(
    `railway variable set "MEDICO_USER=drmax.matos" "MEDICO_PASS=${MEDICO_PASS}" "MEDICO_NOME=Dr Max Matos" "MEDICO_ROLE=admin" "CORS_ORIGIN=${PANEL_URL}" -p ${BACKEND_PROJECT} -e ${BACKEND_ENV} -s ${BACKEND_SERVICE}`
  );

  run(
    `railway variable set "NEXT_PUBLIC_API_URL=${BACKEND_URL}" "API_PROXY_TARGET=${BACKEND_URL}" "NEXT_PUBLIC_APP_ENV=staging" "NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false" -p ${PANEL_PROJECT} -e ${PANEL_ENV} -s ${PANEL_SERVICE}`
  );

  run(`railway up --detach -p ${BACKEND_PROJECT} -e ${BACKEND_ENV} -s ${BACKEND_SERVICE}`);

  const panelDir = require('path').join(__dirname, '..');
  execSync(`railway up --detach -p ${PANEL_PROJECT} -e ${PANEL_ENV} -s ${PANEL_SERVICE}`, {
    stdio: 'inherit',
    shell: true,
    cwd: panelDir,
  });

  console.log('\nConcluído. Valide:');
  console.log(`  ${PANEL_URL}/login`);
  console.log('  node mdoctor-panel/scripts/validate-painel-definitivo.js');
}

main();
