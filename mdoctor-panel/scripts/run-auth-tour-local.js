#!/usr/bin/env node
/** Carrega MEDICO_* de mdoctor-backend/.env.local e executa auth-tour-tecnico.js */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const envLocal = path.join(__dirname, '../../mdoctor-backend/.env.local');
if (!fs.existsSync(envLocal)) {
  console.error('mdoctor-backend/.env.local não encontrado');
  process.exit(1);
}

const env = { ...process.env };
for (const line of fs.readFileSync(envLocal, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const idx = trimmed.indexOf('=');
  const key = trimmed.slice(0, idx).trim();
  let value = trimmed.slice(idx + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (key === 'MEDICO_PASS' && !env.MEDICO_PASS) env.MEDICO_PASS = value;
}

// Staging Railway usa drmax.matos; .env.local costuma ter admin (dev local).
if (!env.MEDICO_USER) env.MEDICO_USER = 'drmax.matos';

if (!env.MEDICO_PASS) {
  console.error('MEDICO_PASS ausente em .env.local');
  process.exit(1);
}

const result = spawnSync(process.execPath, [path.join(__dirname, 'auth-tour-tecnico.js')], {
  env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
