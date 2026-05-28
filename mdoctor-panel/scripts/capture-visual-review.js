/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const BACKEND_STAGING = 'https://mdoctor-backend-staging-staging.up.railway.app';
const OUTPUT_DIR = path.resolve(__dirname, '../../docs/screenshots');

const CREDENTIALS = [
  { user: process.env.MDOCTOR_LOGIN_USER, pass: process.env.MDOCTOR_LOGIN_PASS },
  { user: 'staging-doctor', pass: 'Stg-ZUT9Ln6MbsQv4cn4M6kqTguBCrNGzSKs' }
].filter((item) => item.user && item.pass);

const ROUTES = [
  { url: '/login', file: 'login.png' },
  { url: '/dashboard', file: 'dashboard.png' },
  { url: '/prontuario/ef3f07ba-1d8e-4734-a3a6-8a56dd70dfe4', file: 'prontuario-elegivel.png' },
  { url: '/prontuario/b429636b-eb86-4de6-908e-9ef5bbdb5fd5', file: 'prontuario-inelegivel.png' },
  { url: '/memed/ef3f07ba-1d8e-4734-a3a6-8a56dd70dfe4', file: 'memed-elegivel.png' }
];

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function waitForStable(page, timeout = 12000) {
  await page.waitForLoadState('domcontentloaded', { timeout });
  await page.waitForLoadState('networkidle', { timeout }).catch(() => null);
  await page.waitForTimeout(1200);
}

async function tryUiLogin(page) {
  for (const cred of CREDENTIALS) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await waitForStable(page);

    await page.getByLabel('E-mail ou CPF').fill(cred.user);
    await page.getByLabel('Senha').fill(cred.pass);
    await page.getByRole('button', { name: /acessar painel/i }).click();

    try {
      await page.waitForURL('**/dashboard', { timeout: 12000 });
      await waitForStable(page);
      return { ok: true, mode: 'ui-login' };
    } catch {
      // try next credentials
    }
  }
  return { ok: false, mode: 'ui-login-failed' };
}

async function injectStagingSession(page) {
  const loginCred = CREDENTIALS[0];
  if (!loginCred) return { ok: false, mode: 'session-fallback-no-cred' };

  const loginRes = await page.request.post(`${BACKEND_STAGING}/api/auth/login`, {
    data: {
      user: loginCred.user,
      username: loginCred.user,
      email: loginCred.user,
      password: loginCred.pass
    }
  });
  if (!loginRes.ok()) return { ok: false, mode: 'session-fallback-login-failed' };

  const body = await loginRes.json();
  if (!body?.token) return { ok: false, mode: 'session-fallback-missing-token' };

  await page.addInitScript((token, user) => {
    localStorage.setItem('mdoctor_auth_token', token);
    localStorage.setItem('mdoctor_auth_user', JSON.stringify(user));
    localStorage.setItem(
      'mdoctor_panel_mock_session',
      JSON.stringify({
        token,
        user,
        mode: 'jwt-fallback',
        authenticatedAt: new Date().toISOString()
      })
    );
  }, body.token, body.user || { id: loginCred.user, username: loginCred.user, name: loginCred.user, role: 'admin' });

  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
  await waitForStable(page);
  return { ok: /\/dashboard/.test(page.url()), mode: 'session-fallback' };
}

async function captureScreens(page) {
  for (const route of ROUTES) {
    await page.goto(`${BASE_URL}${route.url}`, { waitUntil: 'domcontentloaded' });
    await waitForStable(page);
    await page.screenshot({ path: path.join(OUTPUT_DIR, route.file), fullPage: true });
    console.log(`captured ${route.file}`);
  }
}

async function main() {
  ensureOutputDir();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await waitForStable(page);
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'login.png'), fullPage: true });

  let auth = await tryUiLogin(page);
  if (!auth.ok) auth = await injectStagingSession(page);
  if (!auth.ok) throw new Error(`Authentication failed: ${auth.mode}`);

  console.log(`auth mode: ${auth.mode}`);
  await captureScreens(page);

  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
