#!/usr/bin/env node
/** Entrega final réplica 1:1 — captura + cópia referência + comparação lado a lado */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://localhost:3002').replace(/\/$/, '');
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const REF_SRC = path.join(REF_DIR, 'Replica prontiario 1-1.png');
const REF_DIR = path.join(ROOT, 'docs/REPLICAÇÃO VISUAL DOCTOR PRESCREVE');
const REF_COPY = path.join(REF_DIR, 'Replica prontiario 1-1-COPIA-EXATA.png');
const CAPTURE = path.join(OUT, 'Replica prontiario 1-1-IMPLEMENTACAO.png');
const COMPARE = path.join(OUT, 'Replica prontiario 1-1-COMPARACAO.png');
const PRONTUARIO_ID = process.env.PRONTUARIO_ID || 'vis-sim-p01';
const VIEWPORT = { width: 1366, height: 768 };

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

[path.join(__dirname, '../.env.local'), path.join(__dirname, '../.env')].forEach(loadEnvFile);
for (const envPath of [path.join(ROOT, 'mdoctor-backend/.env.local'), path.join(ROOT, 'mdoctor-backend/.env')]) {
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('MEDICO_USER=')) process.env.MEDICO_USER = trimmed.slice('MEDICO_USER='.length).trim();
    if (trimmed.startsWith('MEDICO_PASS=')) process.env.MEDICO_PASS = trimmed.slice('MEDICO_PASS='.length).trim();
  }
}

const USER = process.env.MEDICO_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || process.env.TOUR_LOGIN_PASS || '';

async function tryApiLogin() {
  const backend = (process.env.NEXT_PUBLIC_API_URL || process.env.API_PROXY_TARGET || '').replace(/\/$/, '');
  for (const url of [`${PANEL}/api/auth/login`, backend ? `${backend}/api/auth/login` : null].filter(Boolean)) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: USER, password: PASS }),
      });
      const data = await r.json();
      const token = data?.token || data?.data?.token;
      if (r.ok && token) return { token, user: data?.user || data?.data?.user };
    } catch {
      /* próximo */
    }
  }
  return null;
}

async function waitReady(page) {
  const texts = [
    'PRONTUÁRIO MÉDICO',
    'MVXZ',
    'CONDUTA MÉDICA',
    'Paciente assinou os termos de eletividade',
    'REPROVAR',
    'APROVAR',
    '45.123.678/0001-90',
  ];
  for (const t of texts) await page.getByText(t, { exact: false }).first().waitFor({ timeout: 90000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(2500);
}

async function compositeCompare(browser, refPath, capPath, destPath) {
  const refB64 = fs.readFileSync(refPath).toString('base64');
  const capB64 = fs.readFileSync(capPath).toString('base64');
  const page = await browser.newPage({ viewport: { width: 2800, height: 820 } });
  await page.setContent(`<!DOCTYPE html>
<html><head><style>
  *{margin:0;box-sizing:border-box}
  body{font-family:Segoe UI,sans-serif;background:#f0f4f8;padding:16px}
  h2{font-size:14px;color:#5b6475;margin-bottom:8px;font-weight:700}
  .row{display:flex;gap:20px;align-items:flex-start}
  img{display:block;width:1366px;height:768px;object-fit:contain;border:1px solid #d9e2f0;background:#fff}
</style></head><body>
  <div class="row">
    <div><h2>Referência oficial — Replica prontiario 1-1.png</h2><img src="data:image/png;base64,${refB64}" width="1366" height="768"/></div>
    <div><h2>Implementação — réplica 1:1 final</h2><img src="data:image/png;base64,${capB64}" width="1366" height="768"/></div>
  </div>
</body></html>`);
  await page.screenshot({ path: destPath, fullPage: true });
  await page.close();
}

async function main() {
  if (!fs.existsSync(REF_SRC)) {
    console.error(`Referência ausente: ${REF_SRC}`);
    process.exit(1);
  }
  if (!PASS) {
    console.error('MEDICO_PASS obrigatório');
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(REF_SRC, REF_COPY);
  const refBytes = fs.readFileSync(REF_COPY);
  fs.writeFileSync(REF_COPY, refBytes);
  console.log(`OK referência copiada → ${REF_COPY}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const session = await tryApiLogin();
  if (!session?.token) {
    console.error('Login API falhou');
    process.exit(1);
  }

  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('mdoctor_auth_token', t);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
    },
    { t: session.token, u: session.user || { name: 'Max Matos', role: 'admin' } },
  );

  await page.goto(`${PANEL}/prontuario/${PRONTUARIO_ID}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitReady(page);
  await page.screenshot({ path: CAPTURE, fullPage: false, type: 'png' });
  console.log(`OK captura implementação → ${CAPTURE}`);

  const check = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const box = el.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= 768;
    };
    const text = document.body.innerText;
    return {
      header: r('.prontuario-header'),
      gold: r('.panel-gold-band'),
      conduct: text.includes('Paciente assinou os termos de eletividade'),
      reprovar: r('.prontuario-decision-bar__reject'),
      aprovar: r('.prontuario-decision-bar__approve'),
      footer: r('.prontuario-footer'),
      allergies: text.includes('Nega alergias medicamentosas'),
      medications: text.includes('Já declarado na teletriagem'),
    };
  });

  await compositeCompare(browser, REF_COPY, CAPTURE, COMPARE);
  console.log(`OK comparação → ${COMPARE}`);
  console.log(JSON.stringify({ viewport: '1366x768', check, reference: REF_SRC }, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
