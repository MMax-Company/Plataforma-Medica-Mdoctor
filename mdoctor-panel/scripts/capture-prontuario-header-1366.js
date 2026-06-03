#!/usr/bin/env node
/** Captura prontuário pós-ajuste header + comparação antes/depois @ 1366×768 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://localhost:3002').replace(/\/$/, '');
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const BEFORE = path.join(OUT, 'prontuario-medico-validacao-atual.png');
const CAPTURE = path.join(OUT, 'prontuario-header-ajustado.png');
const COMPARE = path.join(OUT, 'prontuario-header-comparacao.png');
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

async function waitProntuarioReady(page) {
  await page.locator('.prontuario-header').first().waitFor({ timeout: 60000 });
  await page.locator('.panel-gold-band').first().waitFor({ timeout: 30000 });
  await page.getByText('PRONTUÁRIO MÉDICO').first().waitFor({ timeout: 60000 });
  await page.getByText('REPROVAR', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.locator('.prontuario-footer').first().waitFor({ timeout: 30000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(2500);
}

async function compositeBeforeAfter(browser) {
  if (!fs.existsSync(BEFORE)) {
    console.warn(`Aviso: antes não encontrado → ${BEFORE}`);
    return;
  }
  const beforeB64 = fs.readFileSync(BEFORE).toString('base64');
  const afterB64 = fs.readFileSync(CAPTURE).toString('base64');
  const page = await browser.newPage({ viewport: { width: 2800, height: 820 } });
  await page.setContent(`<!DOCTYPE html>
<html><head><style>
  *{margin:0;box-sizing:border-box}
  body{font-family:Segoe UI,sans-serif;background:#f8fafc;padding:20px}
  h2{font-size:15px;color:#5b6475;margin-bottom:10px;font-weight:700}
  .row{display:flex;gap:28px;align-items:flex-start}
  img{display:block;width:1366px;height:768px;object-fit:contain;border:1px solid #d9e2f0}
</style></head><body>
  <div class="row">
    <div><h2>Versão anterior (header)</h2><img src="data:image/png;base64,${beforeB64}" width="1366" height="768"/></div>
    <div><h2>Versão nova — header ajustado</h2><img src="data:image/png;base64,${afterB64}" width="1366" height="768"/></div>
  </div>
</body></html>`);
  await page.screenshot({ path: COMPARE, fullPage: true });
  await page.close();
}

async function main() {
  if (!PASS) {
    console.error('MEDICO_PASS obrigatório');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
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
  await page.goto(`${PANEL}/fila?visualSim=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.goto(`${PANEL}/prontuario/${PRONTUARIO_ID}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitProntuarioReady(page);
  await page.screenshot({ path: CAPTURE, fullPage: false, type: 'png' });
  console.log(`OK captura → ${CAPTURE}`);
  await compositeBeforeAfter(browser);
  console.log(`OK comparação → ${COMPARE}`);
  console.log(
    JSON.stringify(
      {
        viewport: '1366x768',
        deviceScaleFactor: 1,
        beforeFile: BEFORE,
        captureFile: CAPTURE,
        compareFile: COMPARE,
        prontuarioUrl: `${PANEL}/prontuario/${PRONTUARIO_ID}`,
      },
      null,
      2,
    ),
  );
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
