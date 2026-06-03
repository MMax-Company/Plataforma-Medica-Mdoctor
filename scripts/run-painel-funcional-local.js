#!/usr/bin/env node
/** Carrega MEDICO_PASS de .env.local e roda Playwright painel-funcional. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const envLocal = path.join(__dirname, '../mdoctor-backend/.env.local');
const env = { ...process.env, MEDICO_USER: process.env.MEDICO_USER || 'drmax.matos' };

if (!env.MEDICO_PASS && fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^MEDICO_PASS=(.*)$/);
    if (m) env.MEDICO_PASS = m[1].trim().replace(/^["']|["']$/g, '');
  }
}

if (!env.MEDICO_PASS) {
  console.error('MEDICO_PASS obrigatório');
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['playwright', 'test', 'e2e/painel-funcional.spec.ts', '--project=painel-funcional-chromium'],
  { cwd: path.join(__dirname, '..'), env, stdio: 'inherit', shell: true },
);
process.exit(result.status ?? 1);
