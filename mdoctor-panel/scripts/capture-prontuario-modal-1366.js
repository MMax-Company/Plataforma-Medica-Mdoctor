#!/usr/bin/env node
/** Captura modal prontuário sobre /fila — visualSim=1 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const OUT_1366 = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS/prontuario-modal-oficial-1366x768.png');
const OUT_1440 = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS/prontuario-modal-oficial-1440x900.png');

function loadEnv() {
  for (const p of [
    path.join(__dirname, '../../mdoctor-backend/.env.local'),
    path.join(__dirname, '../.env.local'),
  ]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}
loadEnv();

const USER = process.env.MEDICO_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || '';

async function main() {
  const localOnly = PANEL.includes('127.0.0.1') || PANEL.includes('localhost');
  if (!PASS && !localOnly) {
    console.error('MEDICO_PASS required for staging capture');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT_1366), { recursive: true });
  const browser = await chromium.launch({ headless: true });

  let token = null;
  let user = { name: 'Dr Max', role: 'admin' };
  if (PASS) {
    const loginRes = await fetch(`${PANEL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: USER, password: PASS }),
    });
    const login = await loginRes.json();
    if (loginRes.ok && login.token) {
      token = login.token;
      user = login.user || user;
    }
  }

  async function captureViewport(width, height, outPath) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript(
      ({ t, u }) => {
        localStorage.setItem('mdoctor_auth_token', t || 'visual-sim-local');
        localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
      },
      { t: token, u: user },
    );
    await page.goto(`${PANEL}/fila?visualSim=1&atendimentoId=vis-sim-p01`, {
      waitUntil: 'networkidle',
      timeout: 120000,
    });
    if (!page.url().includes('atendimentoId')) {
      await page.getByRole('button', { name: /ATENDER/i }).first().click();
    }
    await page.locator('.prontuario-modal-overlay').waitFor({ timeout: 30000 });
    await page.getByText('PRONTUÁRIO MÉDICO').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    const metrics = await page.evaluate(() => {
      const modal = document.querySelector('.prontuario-modal');
      const shell = document.querySelector('.prontuario-shell--modal');
      return {
        scrollInModal: shell ? shell.scrollHeight > shell.clientHeight + 2 : false,
        modalH: modal?.getBoundingClientRect().height ?? 0,
        vh: window.innerHeight,
      };
    });
    await page.screenshot({ path: outPath, fullPage: false });
    await page.close();
    return metrics;
  }

  const m1 = await captureViewport(1366, 768, OUT_1366);
  const m2 = await captureViewport(1440, 900, OUT_1440);
  await browser.close();
  const ok = !m1.scrollInModal && !m2.scrollInModal;
  console.log(
    JSON.stringify(
      { ok, out1366: OUT_1366, out1440: OUT_1440, metrics1366: m1, metrics1440: m2 },
      null,
      2,
    ),
  );
  if (!ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
