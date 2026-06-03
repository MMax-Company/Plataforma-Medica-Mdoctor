import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { CLICK_HIGHLIGHT_INIT_SCRIPT } from './helpers/click-highlight';
import { NetworkCollector } from './helpers/network-collector';
import {
  ARTIFACTS_DIR,
  BACKEND_URL,
  LOGIN_PASS,
  LOGIN_USER,
  PANEL_URL,
  SCREENSHOT_DIR,
} from './helpers/panel-config';
import {
  ensureTourDirs,
  slug,
  writeTourArtifacts,
  type ConsoleEntry,
  type ScreenEntry,
  type TourEntry,
  type TourReportData,
} from './helpers/tour-report';

const isCI = process.env.CI === 'true' || process.env.CI === '1';
const slowMo = isCI ? 0 : Number(process.env.SLOW_MO || 300);

const report: TourReportData = {
  generated_at: new Date().toISOString(),
  mode: 'playwright-test-visual-tour',
  panel_url: PANEL_URL,
  backend_url: BACKEND_URL,
  login_user: LOGIN_USER,
  headless: isCI,
  slow_mo: slowMo,
  viewport: { width: 1366, height: 768 },
  playwright_artifacts: 'docs/playwright-artifacts',
  login: { ok: false, steps: [] },
  console_log: [],
  console_errors: [],
  network: [],
  screens: [],
  tour: [],
  blockers: [],
  notes: [
    'Tour via @playwright/test — trace, vídeo e screenshots automáticos em docs/playwright-artifacts/test-results/',
    'Screenshots numerados adicionais em docs/screenshots/painel-tour/',
  ],
  trace_hint:
    'Abrir trace: `npm run tour-trace -- docs/playwright-artifacts/test-results/<pasta-do-teste>/trace.zip`',
};

const networkCollector = new NetworkCollector();

test.describe.configure({ mode: 'serial' });

test.describe('Doctor Prescreve — tour visual do painel', () => {
  test.beforeAll(() => {
    if (!LOGIN_PASS) {
      test.skip(true, 'Defina TOUR_LOGIN_PASS ou MEDICO_PASS');
    }
    ensureTourDirs();
  });

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(CLICK_HIGHLIGHT_INIT_SCRIPT);
  });

  test('login → fila → atendimento → prontuário → receita', async ({ page }, testInfo) => {
    networkCollector.attach(page);

    page.on('console', (msg) => {
      const entry: ConsoleEntry = { type: msg.type(), text: msg.text() };
      report.console_log.push(entry);
      if (msg.type() === 'error') report.console_errors.push(msg.text());
    });
    page.on('pageerror', (err) => report.console_errors.push(err.message));

    const loggedIn = await attemptLogin(page);
    report.network = networkCollector.entries;

    if (!loggedIn) {
      report.network = networkCollector.entries;
      finalizeReport(testInfo);
      if (!isCI) await page.waitForTimeout(12_000);
      expect(loggedIn, 'Login falhou — ver screenshots e trace').toBe(true);
      return;
    }

    const token = await page.evaluate(() => localStorage.getItem('mdoctor_auth_token'));
    const atendimentoId =
      process.env.ATENDIMENTO_ID || (token ? await fetchFirstAtendimentoId(token) : null);
    await runTour(page, atendimentoId);

    report.network = networkCollector.entries;
    finalizeReport(testInfo);

    if (!isCI) {
      console.log('\n⏸️  Navegador aberto 10s — inspeção visual (trace/vídeo já gravados)...');
      await page.waitForTimeout(10_000);
    }

    expect(report.login.ok).toBe(true);
    expect(report.tour.length).toBeGreaterThanOrEqual(1);
  });
});

function finalizeReport(testInfo: { outputDir: string; status: string }) {
  report.generated_at = new Date().toISOString();
  report.headless = isCI;
  const traceZip = path.join(testInfo.outputDir, 'trace.zip');
  if (fs.existsSync(traceZip)) {
    report.trace_hint = `Trace desta execução: \`npm run tour-trace -- ${traceZip.replace(/\\/g, '/')}\``;
    report.notes.push(`Trace: ${traceZip}`);
  }
  writeTourArtifacts(report);
  console.log(`\n📄 Relatório: docs/PAINEL-TOUR-VISUAL-RELATORIO.md`);
  console.log(`📁 Artefatos: ${ARTIFACTS_DIR}/test-results/`);
  console.log(`📸 Screenshots tour: ${SCREENSHOT_DIR}/`);
}

async function tourScreenshot(page: Page, name: string) {
  const file = `${String(report.screens.length + 1).padStart(2, '0')}-${slug(name)}.png`;
  const fullPath = path.join(SCREENSHOT_DIR, file);
  await page.screenshot({ path: fullPath, fullPage: true });
  const entry: ScreenEntry = {
    name,
    file: `docs/screenshots/painel-tour/${file}`,
    url: page.url(),
  };
  report.screens.push(entry);
  console.log(`📸 ${name} → ${entry.file}`);
}

async function waitStable(page: Page, ms = 1800) {
  await page.waitForLoadState('domcontentloaded', { timeout: 45_000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(ms);
}

async function describePage(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1,h2')?.textContent?.trim() || null,
    token: localStorage.getItem('mdoctor_auth_token') ? 'present' : 'absent',
    bodyPreview: (document.body?.innerText || '').slice(0, 500),
  }));
}

function waitLoginPost(page: Page, timeout = 15_000) {
  return page
    .waitForResponse((res) => res.url().includes('/api/auth/login') && res.request().method() === 'POST', {
      timeout,
    })
    .catch(() => null);
}

async function parseLoginResponse(
  loginResponse: Awaited<ReturnType<typeof waitLoginPost>>,
) {
  if (!loginResponse) return null;
  let responseBody: unknown = null;
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
  networkCollector.record({ phase: 'login', ...entry });
  return entry;
}

async function attemptLogin(page: Page) {
  const loginUrl = `${PANEL_URL}/login`;
  report.login.steps.push({ step: 'goto_login', url: loginUrl });

  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(() => {
    localStorage.removeItem('mdoctor_auth_token');
    localStorage.removeItem('mdoctor_auth_user');
    localStorage.removeItem('mdoctor_login_remember');
    localStorage.removeItem('mdoctor_panel_mock_session');
  });
  await waitStable(page);
  await tourScreenshot(page, 'login-inicial');

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
  });

  let loginResponsePromise = waitLoginPost(page, 12_000);
  await submitBtn.click();
  report.login.steps.push({ step: 'clicked_submit_button' });
  let loginResponse = await loginResponsePromise;

  if (!loginResponse) {
    loginResponsePromise = waitLoginPost(page, 12_000);
    await form.evaluate((f) => {
      if (typeof f.requestSubmit === 'function') f.requestSubmit();
      else f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    report.login.steps.push({ step: 'form_requestSubmit_fallback' });
    loginResponse = await loginResponsePromise;
  }

  if (!loginResponse) {
    loginResponsePromise = waitLoginPost(page, 12_000);
    await passField.press('Enter');
    report.login.steps.push({ step: 'pressed_enter' });
    loginResponse = await loginResponsePromise;
  }

  const net = await parseLoginResponse(loginResponse);

  if (!loginResponse || !net) {
    report.login.steps.push({ step: 'login_request', ok: false, error: 'POST /api/auth/login não capturado' });
    report.blockers.push('Nenhum POST /api/auth/login capturado.');
    await tourScreenshot(page, 'login-sem-request');
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
    await tourScreenshot(page, 'login-sucesso');
    return true;
  }

  report.login.visible_error = await page
    .locator('[class*="FFECEC"], [class*="B91C1C"], text=/credenciais|erro|falha/i')
    .first()
    .textContent()
    .catch(() => null);

  if (loginResponse.status() === 401) {
    report.blockers.push(`401 — credenciais inválidas para ${LOGIN_USER}`);
  }
  if (loginResponse.status() === 404) {
    report.blockers.push('404 em /api/auth/login — verificar proxy /api/* no painel.');
  }

  await tourScreenshot(page, 'login-falha');
  return false;
}

async function fetchFirstAtendimentoId(token: string) {
  const res = await fetch(`${BACKEND_URL}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json().catch(() => ({}))) as { atendimentos?: { id: string }[] };
  return data.atendimentos?.[0]?.id || null;
}

async function validateScreen(page: Page, routeName: string, opts: { requireToken?: boolean } = {}) {
  const info = await describePage(page);
  const entry: TourEntry = {
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
  await tourScreenshot(page, routeName);
  report.tour.push(entry);
  return entry;
}

async function runTour(page: Page, atendimentoId: string | null) {
  await page.goto(`${PANEL_URL}/fila`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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

  await page.goto(`${PANEL_URL}/atendimento/${atendimentoId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await waitStable(page, 2200);
  await validateScreen(page, `atendimento-${atendimentoId.slice(0, 8)}`, { requireToken: true });

  await page.goto(`${PANEL_URL}/prontuario/${atendimentoId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await waitStable(page, 2200);
  await validateScreen(page, `prontuario-${atendimentoId.slice(0, 8)}`, { requireToken: true });

  await page.goto(`${PANEL_URL}/receita?atendimentoId=${atendimentoId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await waitStable(page, 2500);
  await validateScreen(page, `receita-${atendimentoId.slice(0, 8)}`, { requireToken: true });

  report.notes.push('Ações destrutivas (aprovar/reprovar/emitir/WhatsApp) não foram executadas.');
}
