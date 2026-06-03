#!/usr/bin/env node
/**
 * @deprecated Use o spec Playwright Test (trace, vídeo, highlight de cliques):
 *   npm run tour-visual          # na raiz do repo
 *   npm run tour-visual --prefix ..   # a partir de mdoctor-panel
 *
 * Este script permanece como fallback legado (tour-visual-legacy).
 *
 *   node scripts/painel-tour-visual.js
 *   HEADLESS=1 node scripts/painel-tour-visual.js   # CI only
 */
/* eslint-disable no-console */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const PANEL_URL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const BACKEND_URL = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const LOGIN_USER = process.env.TOUR_LOGIN_USER || 'drmax.matos';
const LOGIN_PASS = process.env.TOUR_LOGIN_PASS || process.env.MEDICO_PASS || '';
const HEADLESS = process.env.HEADLESS === '1' || process.env.HEADLESS === 'true';
const SLOW_MO = Number(process.env.SLOW_MO || 350);
const STRICT = process.env.ALLOW_SESSION_INJECT !== '1';

const ROOT = path.resolve(__dirname, '../..');
const HARDENING_REPORT_PATH = path.join(ROOT, 'docs/PAINEL-HARDENING-FINAL.md');
const SCREENSHOT_DIR = path.join(ROOT, 'docs/screenshots/painel-tour');
const REPORT_PATH = path.join(ROOT, 'docs/PAINEL-TOUR-VISUAL-RELATORIO.md');
const NETWORK_JSON = path.join(SCREENSHOT_DIR, 'network-log.json');
const CONSOLE_JSON = path.join(SCREENSHOT_DIR, 'console-log.json');

const report = {
  generated_at: new Date().toISOString(),
  mode: 'playwright-headed-real',
  panel_url: PANEL_URL,
  backend_url: BACKEND_URL,
  login_user: LOGIN_USER,
  strict: STRICT,
  login: { ok: false, steps: [] },
  console_log: [],
  console_errors: [],
  network: [],
  screens: [],
  tour: [],
  blockers: [],
  notes: ['Screenshots capturados por Playwright Chromium headed — não são mockups nem IA.'],
};

function ensureDirs() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function slug(name) {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

async function screenshot(page, name) {
  const file = `${String(report.screens.length + 1).padStart(2, '0')}-${slug(name)}.png`;
  const fullPath = path.join(SCREENSHOT_DIR, file);
  await page.screenshot({ path: fullPath, fullPage: true });
  const rel = `docs/screenshots/painel-tour/${file}`;
  report.screens.push({ name, file: rel, url: page.url() });
  console.log(`📸 ${name} → ${rel}`);
  return rel;
}

async function waitStable(page, ms = 1800) {
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(ms);
}

function recordNetwork(entry) {
  report.network.push(entry);
}

async function describePage(page) {
  return page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1,h2')?.textContent?.trim() || null,
    token: localStorage.getItem('mdoctor_auth_token') ? 'present' : 'absent',
    user: localStorage.getItem('mdoctor_auth_user'),
    bodyPreview: (document.body?.innerText || '').slice(0, 500),
  }));
}

async function waitLoginPost(page, timeout = 15000) {
  return page
    .waitForResponse((res) => res.url().includes('/api/auth/login') && res.request().method() === 'POST', {
      timeout,
    })
    .catch(() => null);
}

async function parseLoginResponse(loginResponse) {
  if (!loginResponse) return null;
  let responseBody = null;
  try {
    responseBody = await loginResponse.json();
  } catch {
    responseBody = { raw: (await loginResponse.text()).slice(0, 400) };
  }
  const entry = {
    url: loginResponse.url(),
    method: loginResponse.request().method(),
    status: loginResponse.status(),
    requestBody: loginResponse.request().postDataJSON?.()
      ? {
          ...loginResponse.request().postDataJSON(),
          password: loginResponse.request().postDataJSON()?.password ? '***' : undefined,
        }
      : null,
    responseBody,
  };
  recordNetwork({ phase: 'login', ...entry });
  return entry;
}

async function attemptLogin(page) {
  const loginUrl = `${PANEL_URL}/login`;
  report.login.steps.push({ step: 'goto_login', url: loginUrl });

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => {
    localStorage.removeItem('mdoctor_auth_token');
    localStorage.removeItem('mdoctor_auth_user');
    localStorage.removeItem('mdoctor_login_remember');
    localStorage.removeItem('mdoctor_panel_mock_session');
  });
  await waitStable(page);
  await screenshot(page, 'login-inicial');

  const userField = page.locator('input[autocomplete="username"], input[type="text"]').first();
  const passField = page.locator('input[type="password"]').first();
  const submitBtn = page.getByRole('button', { name: /acessar painel/i });
  const form = page.locator('form').first();

  await userField.click({ clickCount: 3 });
  await userField.fill('');
  await passField.click({ clickCount: 3 });
  await passField.fill('');
  await userField.fill(LOGIN_USER, { force: true });
  await passField.fill(LOGIN_PASS, { force: true });
  report.login.steps.push({
    step: 'filled_credentials',
    user: LOGIN_USER,
    password_length: LOGIN_PASS.length,
    password_preview: `${LOGIN_PASS.slice(0, 2)}***`,
  });

  // 1) Clique real no botão
  let loginResponsePromise = waitLoginPost(page, 12000);
  await submitBtn.click();
  report.login.steps.push({ step: 'clicked_submit_button' });
  let loginResponse = await loginResponsePromise;

  // 2) Se deploy antigo (type=button), dispara submit nativo do form
  if (!loginResponse) {
    loginResponsePromise = waitLoginPost(page, 12000);
    await form.evaluate((f) => {
      if (typeof f.requestSubmit === 'function') f.requestSubmit();
      else f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    report.login.steps.push({ step: 'form_requestSubmit_fallback' });
    loginResponse = await loginResponsePromise;
  }

  // 3) Enter no campo senha
  if (!loginResponse) {
    loginResponsePromise = waitLoginPost(page, 12000);
    await passField.press('Enter');
    report.login.steps.push({ step: 'pressed_enter' });
    loginResponse = await loginResponsePromise;
  }

  const net = await parseLoginResponse(loginResponse);

  if (!loginResponse || !net) {
    report.login.steps.push({ step: 'login_request', ok: false, error: 'POST /api/auth/login não capturado' });
    report.blockers.push(
      'Nenhum POST /api/auth/login — painel Railway pode estar sem proxy /api/* (redeploy necessário) ou JS quebrado.',
    );
    await screenshot(page, 'login-sem-request');
    return false;
  }

  report.login.steps.push({ step: 'login_request', ok: loginResponse.ok(), ...net });

  await page.waitForTimeout(2000);
  const token = await page.evaluate(() => localStorage.getItem('mdoctor_auth_token'));
  const currentUrl = page.url();
  const redirectOk = /\/(fila|dashboard)/.test(currentUrl);

  report.login.token_saved = Boolean(token);
  report.login.redirect_url = currentUrl;
  report.login.redirect_ok = redirectOk;

  if (loginResponse.status() === 200 && token && redirectOk) {
    report.login.ok = true;
    await screenshot(page, 'login-sucesso');
    return true;
  }

  report.login.visible_error = await page
    .locator('[class*="FFECEC"], [class*="B91C1C"], text=/credenciais|erro|falha/i')
    .first()
    .textContent()
    .catch(() => null);

  if (loginResponse.status() === 401) {
    report.blockers.push(
      `401 Credenciais inválidas — backend staging ainda não tem MEDICO_USER=${LOGIN_USER}. ` +
        'Execute: railway login && MEDICO_PASS=... node scripts/apply-painel-definitivo-railway.js',
    );
  }
  if (loginResponse.status() === 404) {
    report.blockers.push('404 em /api/auth/login no painel — redeploy com next.config rewrites (proxy /api/*).');
  }

  await screenshot(page, 'login-falha');
  return false;
}

async function fetchFirstAtendimentoId(token) {
  const res = await fetch(`${BACKEND_URL}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  const list = data.atendimentos || [];
  return list[0]?.id || null;
}

async function validateScreen(page, routeName, opts = {}) {
  const info = await describePage(page);
  const entry = {
    route: routeName,
    url: page.url(),
    ok: !info.bodyPreview.match(/credenciais inválidas|sessão expirada|erro ao buscar/i),
    heading: info.h1,
    token: info.token,
    issues: [],
  };
  if (opts.requireToken && info.token !== 'present') {
    entry.ok = false;
    entry.issues.push('Token ausente');
  }
  await screenshot(page, routeName);
  report.tour.push(entry);
  return entry;
}

async function runTour(page, atendimentoId) {
  await page.goto(`${PANEL_URL}/fila`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitStable(page, 2200);
  await validateScreen(page, 'fila', { requireToken: true });

  if (!atendimentoId) {
    atendimentoId = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/atendimento/"]');
      return a?.getAttribute('href')?.split('/').pop() || null;
    });
  }
  if (!atendimentoId) {
    const token = await page.evaluate(() => localStorage.getItem('mdoctor_auth_token'));
    if (token) atendimentoId = await fetchFirstAtendimentoId(token);
  }
  if (!atendimentoId) {
    report.blockers.push('Fila sem atendimentos — tour interrompido após /fila');
    return;
  }

  report.notes.push(`Atendimento tour (somente leitura): ${atendimentoId}`);

  await page.goto(`${PANEL_URL}/atendimento/${atendimentoId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitStable(page, 2200);
  await validateScreen(page, `atendimento-${atendimentoId.slice(0, 8)}`, { requireToken: true });

  await page.goto(`${PANEL_URL}/prontuario/${atendimentoId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitStable(page, 2200);
  await validateScreen(page, `prontuario-${atendimentoId.slice(0, 8)}`, { requireToken: true });

  await page.goto(`${PANEL_URL}/receita?atendimentoId=${atendimentoId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitStable(page, 2500);
  await validateScreen(page, `receita-${atendimentoId.slice(0, 8)}`, { requireToken: true });

  report.notes.push('Ações destrutivas (aprovar/reprovar/emitir/WhatsApp) não foram executadas.');
}

function writeReport() {
  fs.writeFileSync(NETWORK_JSON, JSON.stringify(report.network, null, 2), 'utf8');
  fs.writeFileSync(CONSOLE_JSON, JSON.stringify(report.console_log, null, 2), 'utf8');

  const lines = [
    '# Painel Médico — Tour Visual E2E (Playwright real)',
    '',
    `> ${report.generated_at}`,
    `> Navegador: Playwright Chromium ${HEADLESS ? 'headless' : '**headed (janela real)**'}`,
    `> Painel: ${PANEL_URL}`,
    `> Backend: ${BACKEND_URL}`,
    `> Login testado: \`${LOGIN_USER}\``,
    '',
    '## Resumo',
    '',
    '| Item | Resultado |',
    '|------|-----------|',
    `| Login UI real | ${report.login.ok ? '✅ OK' : '❌ FALHOU'} |`,
    `| POST /api/auth/login | ${report.login.steps.find((s) => s.step === 'login_request')?.status ?? '—'} |`,
    `| Token localStorage | ${report.login.token_saved ? '✅' : '❌'} |`,
    `| Redirect | ${report.login.redirect_ok ? report.login.redirect_url : '❌'} |`,
    `| Telas tour | ${report.tour.length} |`,
    `| Console errors | ${report.console_errors.length} |`,
    '',
  ];

  if (report.blockers.length) {
    lines.push('## Blockers', '');
    report.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push('');
  }

  lines.push('## Login (JSON)', '', '```json', JSON.stringify(report.login, null, 2), '```', '');

  if (report.console_errors.length) {
    lines.push('## Console errors', '');
    report.console_errors.forEach((e) => lines.push(`- \`${e}\``));
    lines.push('');
  }

  lines.push('## Screenshots reais', '');
  report.screens.forEach((s) => lines.push(`- [${path.basename(s.file)}](${s.file}) — \`${s.url}\``));
  lines.push('', `Logs: [network-log.json](screenshots/painel-tour/network-log.json) · [console-log.json](screenshots/painel-tour/console-log.json)`, '');

  if (!report.login.ok) {
    lines.push('## Correção necessária', '', '1. `railway login`', '2. `MEDICO_PASS=... node mdoctor-panel/scripts/apply-painel-definitivo-railway.js`', '3. Aguardar redeploy (~3 min)', '4. `TOUR_LOGIN_PASS=... npm run tour-visual`', '');
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
  writeHardeningReport();
  console.log(`\n📄 Relatório: ${REPORT_PATH}`);
  console.log(`📄 Hardening: ${HARDENING_REPORT_PATH}`);
}

function writeHardeningReport() {
  const loginOk = report.login.ok;
  const lines = [
    '# Painel Médico — Hardening Final',
    '',
    `> Gerado em: ${report.generated_at}`,
    `> Painel: ${PANEL_URL}`,
    `> Backend: ${BACKEND_URL}`,
    '',
    '## Objetivo',
    '',
    'Estabilização do fluxo médico: login → fila → atendimento → prontuário → approve/reject → Memed → persistência → validate → deliver.',
    '',
    '## Checklist operacional',
    '',
    '| Item | Status |',
    '|------|--------|',
    `| Login único (\`drmax.matos\`) | ${loginOk ? '✅' : '❌'} |`,
    `| JWT + redirect /fila | ${report.login.redirect_ok ? '✅' : '❌'} |`,
    `| Tour visual (${report.tour.length} telas) | ${report.tour.length >= 4 ? '✅' : '⚠️'} |`,
    `| Console errors | ${report.console_errors.length === 0 ? '✅ nenhum' : `⚠️ ${report.console_errors.length}`} |`,
    '',
    '## Alterações aplicadas (código)',
    '',
    '- Auth backend unificado: `MEDICO_USER` + `MEDICO_PASS` (sem alias/official fallback)',
    '- Endpoints de leitura protegidos com JWT (`/queue`, `/:id`, etc.)',
    '- Guards de sessão via `requireSession()` / `useRequireAuth()`',
    '- Mock fallbacks desligados quando `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false`',
    '- Dashboard legado redireciona para `/fila`',
    '- Escala visual: base 14px, max-width 1280px, widget Memed responsivo',
    '',
  ];

  if (report.blockers.length) {
    lines.push('## Blockers', '');
    report.blockers.forEach((b) => lines.push(`- ${b}`));
    lines.push('');
  }

  lines.push('## Screenshots', '');
  report.screens.forEach((s) => lines.push(`- [${path.basename(s.file)}](${s.file})`));
  lines.push('', `Detalhes: [PAINEL-TOUR-VISUAL-RELATORIO.md](PAINEL-TOUR-VISUAL-RELATORIO.md)`, '');

  fs.writeFileSync(HARDENING_REPORT_PATH, lines.join('\n'), 'utf8');
}

async function main() {
  ensureDirs();
  if (!LOGIN_PASS) {
    console.error('Defina TOUR_LOGIN_PASS ou MEDICO_PASS antes de executar o tour.');
    process.exit(1);
  }
  console.log(`\n🎬 Tour REAL — ${PANEL_URL}`);
  console.log(`   Headless: ${HEADLESS} | Strict (sem injeção): ${STRICT}\n`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOW_MO,
    devtools: !HEADLESS,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
    storageState: undefined,
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text() };
    report.console_log.push(entry);
    if (msg.type() === 'error') report.console_errors.push(msg.text());
  });
  page.on('pageerror', (err) => report.console_errors.push(err.message));
  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/')) {
      recordNetwork({ phase: 'request_failed', url: req.url(), method: req.method(), failure: req.failure()?.errorText });
    }
  });

  const loggedIn = await attemptLogin(page);

  if (!loggedIn) {
    console.log('\n❌ Login falhou — tour NÃO continua (modo strict). Evidências salvas.\n');
    if (!HEADLESS) {
      console.log('⏸️  Navegador aberto 12s para inspeção DevTools...');
      await page.waitForTimeout(12000);
    }
    await context.close();
    await browser.close();
    writeReport();
    process.exit(2);
  }

  const token = await page.evaluate(() => localStorage.getItem('mdoctor_auth_token'));
  const atendimentoId = process.env.ATENDIMENTO_ID || (await fetchFirstAtendimentoId(token));
  await runTour(page, atendimentoId);

  if (!HEADLESS) {
    console.log('\n⏸️  Navegador aberto 10s — inspeção visual...');
    await page.waitForTimeout(10000);
  }

  await context.close();
  await browser.close();
  writeReport();
}

main().catch((err) => {
  console.error(err);
  report.blockers.push(String(err.message || err));
  try {
    writeReport();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
