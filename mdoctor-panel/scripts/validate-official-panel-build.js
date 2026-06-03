#!/usr/bin/env node
/**
 * Valida build local do painel oficial antes de deploy staging.
 * Uso: npm run build && node scripts/validate-official-panel-build.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nextDir = path.join(root, '.next');

const requiredStrings = [
  'PAINEL NOVO V2 — DOCTOR PRESCREVE OFICIAL',
  'doctor-prescreve-logo-transparent',
  'staging-audit-banner',
  'Pronto para emitir',
  'Emitir Receita',
];

const forbiddenStrings = ['logotipo-mdoctor.png'];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (/\.(js|html|css)$/.test(ent.name)) files.push(p);
  }
  return files;
}

function main() {
  const report = { ok: false, required: {}, forbidden: {}, filesScanned: 0 };
  if (!fs.existsSync(nextDir)) {
    console.error(JSON.stringify({ ok: false, error: 'Run npm run build first (.next missing)' }, null, 2));
    process.exit(1);
  }

  const files = walk(nextDir);
  report.filesScanned = files.length;
  let corpus = '';
  for (const f of files) {
    try {
      corpus += fs.readFileSync(f, 'utf8');
    } catch {
      /* ignore binary */
    }
  }

  for (const s of requiredStrings) {
    report.required[s] = corpus.includes(s);
  }
  for (const s of forbiddenStrings) {
    report.forbidden[s] = corpus.includes(s);
  }

  const envPath = path.join(root, '.env.production.local');
  report.buildEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;

  report.ok =
    Object.values(report.required).every(Boolean) &&
    !Object.values(report.forbidden).some(Boolean);

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
