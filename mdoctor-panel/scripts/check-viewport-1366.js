#!/usr/bin/env node
/** Verificação leve 1366×768 — sem tour completo. */
const { chromium } = require('playwright');

const BASE = (process.env.PANEL_URL || 'http://localhost:3000').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const USER = 'drmax.matos';
const PASS = process.env.MEDICO_PASS || 'Gr@tid@0';

async function main() {
  const issues = [];
  const ok = [];

  const loginRes = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  if (!token) {
    console.log(JSON.stringify({ ok: [], issues: ['login falhou'] }, null, 2));
    process.exit(1);
  }

  const q = await fetch(`${BACKEND}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const qData = await q.json();
  const id = qData.atendimentos?.[0]?.id;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

  await page.addInitScript((t, u) => {
    localStorage.setItem('mdoctor_auth_token', t);
    localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
  }, token, loginData.user);

  await page.goto(`${BASE}/fila`, { waitUntil: 'networkidle', timeout: 60000 });

  const cols = await page.locator('.grid.grid-cols-3 > section').count();
  if (cols >= 3) ok.push('fila: 3 colunas visíveis');
  else issues.push(`fila: ${cols} colunas (esperado 3)`);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  if (!overflow) ok.push('fila: sem overflow horizontal');
  else issues.push('fila: overflow horizontal');

  const logoBox = await page.locator('header img[alt="Doctor Prescreve"]').boundingBox();
  if (logoBox && logoBox.height <= 36) ok.push('logo: escala compacta');
  else issues.push(`logo: altura ${logoBox?.height ?? '?'}px`);

  if (id) {
    await page.goto(`${BASE}/atendimento/${id}`, { waitUntil: 'networkidle', timeout: 60000 });

    const reprovar = page.getByRole('button', { name: /^reprovar$/i }).first();
    const aprovar = page.getByRole('button', { name: /^aprovar$/i }).first();
    if (await reprovar.isVisible()) ok.push('prontuário: Reprovar visível');
    else issues.push('prontuário: Reprovar oculto');
    if (await aprovar.isVisible()) ok.push('prontuário: Aprovar visível');
    else issues.push('prontuário: Aprovar oculto');

    const bodyText = await page.locator('main').innerText();
    if (bodyText.length > 200 && !bodyText.includes('Atendimento não encontrado')) {
      ok.push('prontuário: dados carregados');
    } else {
      issues.push('prontuário: dados insuficientes');
    }
  }

  await browser.close();
  console.log(JSON.stringify({ viewport: '1366x768', base: BASE, ok, issues }, null, 2));
  process.exit(issues.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
