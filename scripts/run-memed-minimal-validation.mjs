#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, 'mdoctor-panel', '.env.local');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

process.env.PANEL_URL = process.env.PANEL_URL || 'http://127.0.0.1:3003';
process.env.ATENDIMENTO_ID = process.env.ATENDIMENTO_ID || 'c302bd9e-060a-4ee8-b4cf-0c78392f60c6';

if (!process.env.MEDICO_PASS && !process.env.TOUR_LOGIN_PASS) {
  console.error('MEDICO_PASS ou TOUR_LOGIN_PASS obrigatório (.env.local ou env)');
  process.exit(1);
}

execSync(
  'npx playwright test e2e/memed-minimal-payload-validation.spec.ts --project=memed-minimal-payload-chromium --reporter=line',
  { stdio: 'inherit', env: process.env, cwd: root },
);
