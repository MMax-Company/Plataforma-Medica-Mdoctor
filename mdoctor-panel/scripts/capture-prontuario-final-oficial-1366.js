#!/usr/bin/env node
/**
 * Imagem estática final do prontuário — 1366×768, conteúdo completo sem cortes.
 * Não altera código-fonte do app; apenas captura + composição no browser.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://localhost:3002').replace(/\/$/, '');
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const OUTPUT = path.join(OUT, 'prontuario-final-oficial.png');
const TEMP = path.join(OUT, '.prontuario-final-oficial-temp.png');
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

async function waitProntuarioComplete(page) {
  const required = [
    'PRONTUÁRIO MÉDICO',
    'CRITÉRIOS DE ELEGIBILIDADE',
    'DADOS DO PACIENTE',
    'HISTÓRIA CLÍNICA',
    'QUEIXA PRINCIPAL',
    'HISTÓRICO CLÍNICO',
    'EXAME FÍSICO',
    'ALERGIAS',
    'MEDICAÇÕES EM USO',
    'CONDUTA MÉDICA',
    'Realizado renovação da receita de uso contínuo',
    'Paciente assinou os termos de eletividade',
    'Nega alergias medicamentosas ou alimentares',
    'Já declarado na teletriagem',
  ];
  for (const text of required) {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 90000 });
  }
  await page.getByText('REPROVAR', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.getByText('APROVAR', { exact: true }).first().waitFor({ timeout: 30000 });
  await page.getByText('CONDUTA MÉDICA OPCIONAL').first().waitFor({ timeout: 30000 });
  await page.locator('.prontuario-footer').first().waitFor({ timeout: 30000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(2000);
}

async function unlockFullContent(page) {
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'visible';
    document.body.style.overflow = 'visible';
    document.body.style.background = '#f6f9fd';
    const layout = document.querySelector('.prontuario-shell')?.parentElement;
    if (layout) {
      layout.style.overflow = 'visible';
      layout.style.minHeight = 'auto';
      layout.style.height = 'auto';
    }
    const shell = document.querySelector('.prontuario-shell');
    if (shell) {
      shell.style.overflow = 'visible';
      shell.style.minHeight = 'auto';
      shell.style.height = 'auto';
      shell.style.maxHeight = 'none';
    }
    for (const sel of [
      '.prontuario-main-grid',
      '.prontuario-history-card',
      '.prontuario-history-card__body',
      '.prontuario-patient-card',
      '.prontuario-patient-card__body',
      '.panel-shell',
    ]) {
      document.querySelectorAll(sel).forEach((el) => {
        el.style.overflow = 'visible';
        el.style.maxHeight = 'none';
        el.style.minHeight = '0';
        el.style.height = 'auto';
        el.style.flex = 'none';
      });
    }
    const grid = document.querySelector('.prontuario-main-grid');
    if (grid) grid.style.alignItems = 'start';
  });
  await page.waitForTimeout(500);
}

async function compositeToViewport(browser, sourcePath, destPath) {
  const b64 = fs.readFileSync(sourcePath).toString('base64');
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.setContent(`<!DOCTYPE html>
<html><head><style>
  *{margin:0;box-sizing:border-box}
  html,body{width:1366px;height:768px;overflow:hidden;background:#f6f9fd}
  .frame{width:1366px;height:768px;display:flex;align-items:flex-start;justify-content:center;padding:0}
  img{display:block;max-width:1366px;max-height:768px;width:auto;height:auto;object-fit:contain;object-position:top center}
</style></head><body><div class="frame"><img src="data:image/png;base64,${b64}" alt="prontuario"/></div></body></html>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: destPath, fullPage: false, type: 'png' });
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
  await page.waitForTimeout(1000);
  await page.goto(`${PANEL}/prontuario/${PRONTUARIO_ID}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitProntuarioComplete(page);
  await unlockFullContent(page);

  const shell = page.locator('.prontuario-shell');
  await shell.screenshot({ path: TEMP, type: 'png' });
  await compositeToViewport(browser, TEMP, OUTPUT);
  if (fs.existsSync(TEMP)) fs.unlinkSync(TEMP);

  const meta = await page.evaluate(() => ({
    hasAllergies: document.body.innerText.includes('Nega alergias medicamentosas ou alimentares'),
    hasMedications: document.body.innerText.includes('Já declarado na teletriagem'),
    hasConductFull: document.body.innerText.includes('Paciente assinou os termos de eletividade'),
    hasReprovar: document.body.innerText.includes('REPROVAR'),
    hasAprovar: document.body.innerText.includes('APROVAR'),
    hasFooter: document.body.innerText.includes('45.123.678/0001-90'),
  }));

  console.log(`OK → ${OUTPUT}`);
  console.log(
    JSON.stringify(
      {
        viewport: '1366x768',
        deviceScaleFactor: 1,
        method: 'element-screenshot + contain composite',
        contentChecks: meta,
        url: `${PANEL}/prontuario/${PRONTUARIO_ID}`,
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
