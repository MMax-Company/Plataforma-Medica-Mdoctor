#!/usr/bin/env node
/** Screenshots oficiais — painel + prontuário @ 1366×768 (somente captura) */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3002').replace(/\/$/, '');
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const VIEWPORT = { width: 1366, height: 768 };
const FILA_URL = `${PANEL}/fila?visualSim=1`;
const PRONTUARIO_ID = process.env.PRONTUARIO_ID || 'vis-sim-p01';
const PAINEL_OUT = path.join(OUT, 'painel-medico-oficial-atual.png');
const PRONT_OUT = path.join(OUT, 'prontuario-medico-oficial-atual.png');

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

[
  path.join(__dirname, '../.env.local'),
  path.join(__dirname, '../.env'),
].forEach((p) => loadEnvFile(p));

function loadAuthFromBackendEnv() {
  for (const envPath of [path.join(ROOT, 'mdoctor-backend/.env.local'), path.join(ROOT, 'mdoctor-backend/.env')]) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('MEDICO_USER=')) {
        process.env.MEDICO_USER = trimmed.slice('MEDICO_USER='.length).trim();
      }
      if (trimmed.startsWith('MEDICO_PASS=')) {
        process.env.MEDICO_PASS = trimmed.slice('MEDICO_PASS='.length).trim();
      }
    }
  }
}

loadAuthFromBackendEnv();

const USER = process.env.MEDICO_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || process.env.TOUR_LOGIN_PASS || '';

async function tryApiLogin() {
  const backend = (process.env.NEXT_PUBLIC_API_URL || process.env.API_PROXY_TARGET || '').replace(/\/$/, '');
  const urls = [`${PANEL}/api/auth/login`, backend ? `${backend}/api/auth/login` : null].filter(Boolean);
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: USER, password: PASS }),
      });
      const data = await r.json();
      const token = data?.token || data?.data?.token;
      if (r.ok && token) return { token, user: data?.user || data?.data?.user };
      console.warn(`Login sem token em ${url}: HTTP ${r.status}`, data?.error || data?.message || '');
    } catch (err) {
      console.warn(`Login falhou em ${url}:`, err.message);
    }
  }
  return null;
}

async function loginViaUi(page) {
  await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input:not([type="password"])').first().fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole('button', { name: /acessar painel/i }).click();
  await page.waitForURL(/\/(fila|dashboard|prontuario)/, { timeout: 120000 });
}

async function waitFonts(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.waitForTimeout(2000);
}

async function waitPainel(page) {
  await page.getByText('FILA DE ESPERA').first().waitFor({ timeout: 60000 });
  await page.getByText('EM ATENDIMENTO').first().waitFor({ timeout: 60000 });
  await page.getByText('RECEITAS PRONTAS').first().waitFor({ timeout: 60000 });
  await page.getByText('SUPORTE MÉDICO VIA WHATSAPP').first().waitFor({ timeout: 60000 });
  await page.locator('.panel-gold-band').first().waitFor({ timeout: 30000 });
  await page.locator('.panel-footer').first().waitFor({ timeout: 30000 });
  await waitFonts(page);
}

async function waitProntuario(page) {
  await page.getByText('PRONTUÁRIO MÉDICO').first().waitFor({ timeout: 60000 });
  await page.getByText('DADOS DO PACIENTE').first().waitFor({ timeout: 60000 });
  await waitFonts(page);
}

async function main() {
  if (!PASS) {
    console.error('MEDICO_PASS obrigatório (mdoctor-backend/.env)');
    process.exit(1);
  }
  console.log(`Auth: user=${USER}, passLen=${PASS.length}, panel=${PANEL}`);

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  const session = await tryApiLogin();
  if (!session?.token) {
    console.error('Login API falhou — verifique MEDICO_USER/MEDICO_PASS');
    process.exit(1);
  }
  console.log('OK login API');
  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('mdoctor_auth_token', t);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
    },
    { t: session.token, u: session.user || { name: 'Max Matos', role: 'admin' } },
  );

  await page.goto(FILA_URL, { waitUntil: 'networkidle', timeout: 120000 });
  if (page.url().includes('/login')) {
    await loginViaUi(page);
    await page.goto(FILA_URL, { waitUntil: 'networkidle', timeout: 120000 });
  }
  await waitPainel(page);
  await page.screenshot({ path: PAINEL_OUT, fullPage: false, type: 'png' });
  console.log(`OK painel → ${PAINEL_OUT}`);

  const prontUrl = `${PANEL}/prontuario/${PRONTUARIO_ID}`;
  await page.goto(prontUrl, { waitUntil: 'networkidle', timeout: 120000 });
  if (page.url().includes('/login')) {
    await loginViaUi(page);
    await page.goto(prontUrl, { waitUntil: 'networkidle', timeout: 120000 });
  }
  await waitProntuario(page);
  await page.screenshot({ path: PRONT_OUT, fullPage: false, type: 'png' });
  console.log(`OK prontuário → ${PRONT_OUT}`);
  console.log(
    JSON.stringify(
      {
        viewport: '1366x768',
        deviceScaleFactor: 1,
        painelUrl: FILA_URL,
        prontuarioUrl: prontUrl,
        painelFile: PAINEL_OUT,
        prontuarioFile: PRONT_OUT,
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
