#!/usr/bin/env node
/** Captura 4 screenshots estáticas 1366×768 — estado visual atual do painel (staging). */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PANEL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || process.env.TOUR_LOGIN_PASS || '';
const OUT = path.resolve(
  __dirname,
  '../../docs/screenshots/descricao-estatica'
);
const VIEWPORT = { width: 1366, height: 768 };

async function apiLogin() {
  const r = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  });
  const data = await r.json();
  if (!r.ok || !data?.token) throw new Error(`Login API falhou: ${r.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function pickAtendimentoId(token) {
  const r = await fetch(`${BACKEND}/api/atendimentos`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = await r.json();
  const rows = Array.isArray(list) ? list : list?.data || list?.atendimentos || [];
  const hit = rows.find((a) => a.id || a.atendimento_id);
  const id = hit?.id || hit?.atendimento_id;
  if (!id) throw new Error('Nenhum atendimento encontrado na API');
  return String(id);
}

async function shot(page, filename) {
  const full = path.join(OUT, filename);
  await page.screenshot({ path: full, fullPage: false });
  console.log(`OK ${filename} → ${full}`);
  return full;
}

async function injectSession(page, token, user) {
  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('mdoctor_auth_token', t);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
    },
    { t: token, u: user }
  );
}

async function main() {
  if (!PASS) {
    console.error('MEDICO_PASS ou TOUR_LOGIN_PASS obrigatório');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const session = await apiLogin();
  const atendimentoId = await pickAtendimentoId(session.token);

  const browser = await chromium.launch({ headless: true });

  // 1 — Login (sem sessão)
  const pLogin = await browser.newPage({ viewport: VIEWPORT });
  await pLogin.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 90000 });
  await pLogin.waitForTimeout(1200);
  await shot(pLogin, '01-login.png');
  await pLogin.close();

  // Sessão autenticada
  const auth = { token: session.token, user: session.user || { name: USER } };

  // 2 — Fila
  const pFila = await browser.newPage({ viewport: VIEWPORT });
  await injectSession(pFila, auth.token, auth.user);
  await pFila.goto(`${PANEL}/fila`, { waitUntil: 'networkidle', timeout: 90000 });
  await pFila.waitForTimeout(1500);
  await shot(pFila, '02-fila.png');
  await pFila.close();

  // 3 — Prontuário (rota /prontuario — tela clínica completa no staging atual)
  const pPront = await browser.newPage({ viewport: VIEWPORT });
  await injectSession(pPront, auth.token, auth.user);
  await pPront.goto(`${PANEL}/prontuario/${atendimentoId}`, { waitUntil: 'networkidle', timeout: 90000 });
  await pPront.waitForTimeout(2000);
  await shot(pPront, '03-atendimento-prontuario.png');
  await pPront.close();

  // 4 — Memed / prescrição
  const pMemed = await browser.newPage({ viewport: VIEWPORT });
  await injectSession(pMemed, auth.token, auth.user);
  await pMemed.goto(`${PANEL}/receita?atendimentoId=${encodeURIComponent(atendimentoId)}`, {
    waitUntil: 'networkidle',
    timeout: 90000,
  });
  await pMemed.waitForTimeout(2500);
  await shot(pMemed, '04-memed.png');
  await pMemed.close();

  await browser.close();
  console.log(JSON.stringify({ out: OUT, atendimentoId, panel: PANEL }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
