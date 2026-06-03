#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const envLocal = path.join(__dirname, '../mdoctor-backend/.env.local');
const env = {
  ...process.env,
  MEDICO_USER: process.env.MEDICO_USER || 'drmax.matos',
  PANEL_URL: process.env.PANEL_URL || 'http://localhost:3010',
  HEADLESS: process.env.HEADLESS || '1',
};

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
  ['playwright', 'test', 'e2e/fila-atender-prontuario.spec.ts', '--project=fila-atender-chromium'],
  { cwd: path.join(__dirname, '..'), env, stdio: 'inherit', shell: true },
);
process.exit(result.status ?? 1);
