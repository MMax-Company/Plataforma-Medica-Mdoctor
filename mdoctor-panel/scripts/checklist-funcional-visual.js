#!/usr/bin/env node
/** Checklist funcional/visual prático — staging, 1366×768 e 1280×768. */
const { chromium } = require('playwright');

const PANEL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || '';

async function apiLogin(user, password) {
  const r = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password }),
  });
  return r.json();
}

async function probeViewport(browser, token, user, width, atendimentoId) {
  const page = await browser.newPage({ viewport: { width, height: 768 } });
  await page.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('mdoctor_auth_token', t);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
    },
    { t: token, u: user }
  );
  await page.goto(`${PANEL}/fila`, { waitUntil: 'networkidle', timeout: 60000 });
  const headerText = await page.locator('header').innerText();
  const result = {
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2),
    cols: await page.locator('.grid.grid-cols-3 > section, .grid.gap-4.md\\:grid-cols-3 > section').count(),
    hasLogout: (await page.getByRole('button', { name: /sair/i }).count()) > 0,
    hasLogo: (await page.locator('header img[alt="Doctor Prescreve"]').count()) > 0,
    hasDoctorName: /Max|Matos|drmax/i.test(headerText),
    hasAtender: (await page.getByRole('button', { name: /atender/i }).count()) > 0,
    hasWhatsapp: (await page.locator('a[href*="wa.me"], a[href*="whatsapp"]').count()) > 0,
    hasRefresh: (await page.getByRole('button', { name: /atualizar/i }).count()) > 0,
  };
  if (atendimentoId) {
    await page.goto(`${PANEL}/atendimento/${atendimentoId}`, { waitUntil: 'networkidle', timeout: 60000 });
    result.atendOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    result.reprovar = await page
      .getByRole('button', { name: /^reprovar$/i })
      .first()
      .isVisible()
      .catch(() => false);
    result.aprovar = await page
      .getByRole('button', { name: /^aprovar$/i })
      .first()
      .isVisible()
      .catch(() => false);
    result.salvar = (await page.getByText(/salvar prontuário/i).count()) > 0;
    result.emitirMemed = (await page.getByText(/emitir receita/i).count()) > 0;
    result.elegibilidade = (await page.getByText(/elegibilidade|elegível|baixo risco/i).count()) > 0;
    result.voltar = (await page.getByText(/voltar/i).count()) > 0;
    result.receitaAnexada = (await page.getByText(/receita anexada|visualizar imagem/i).count()) > 0;
    result.editar = (await page.getByRole('button', { name: /editar/i }).count()) > 0;
    const mainText = await page.locator('main').innerText();
    result.hasNome = /paciente|sim /i.test(mainText);
    result.hasMedicacao = /losartana|metformina|medica/i.test(mainText);
    result.hasQueixa = /queixa|solicita/i.test(mainText);
  }
  await page.close();
  return result;
}

async function main() {
  if (!PASS) {
    console.log(JSON.stringify({ error: 'MEDICO_PASS required' }));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const login = {};

  const pageLogin = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await pageLogin.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 60000 });
  login.overflow = await pageLogin.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  login.hasUser = (await pageLogin.locator('input:not([type="password"])').count()) > 0;
  login.hasPass = (await pageLogin.locator('input[type="password"]').count()) > 0;
  login.hasSubmit = (await pageLogin.getByRole('button', { name: /acessar painel/i }).count()) > 0;
  login.hasForgot = (await pageLogin.getByText(/esqueci|esqueceu/i).count()) > 0;
  login.hasRemember = (await pageLogin.getByText(/lembrar/i).count()) > 0;

  const userInput = pageLogin.locator('input[autocomplete="username"]').first();
  const passInput = pageLogin.locator('input[type="password"]').first();
  await userInput.fill(USER);
  await passInput.fill('senha-invalida');
  await pageLogin.getByRole('button', { name: /acessar painel/i }).click();
  await pageLogin.waitForTimeout(2000);
  login.wrongPassError = (await pageLogin.locator('[class*="red"], [class*="FFD1"], [class*="B91C"]').count()) > 0;
  login.wrongPassStaysLogin = pageLogin.url().includes('/login');

  await passInput.fill(PASS);
  await pageLogin.getByRole('button', { name: /acessar painel/i }).click();
  await pageLogin.waitForURL(/\/(fila|dashboard)/, { timeout: 25000 }).catch(() => null);
  login.correctRedirect = /\/(fila|dashboard)/.test(pageLogin.url());
  login.tokenSaved = await pageLogin.evaluate(() => Boolean(localStorage.getItem('mdoctor_auth_token')));
  await pageLogin.close();

  const session = await apiLogin(USER, PASS);
  const token = session.token;
  const queue = await fetch(`${BACKEND}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const atendimentoId = queue.atendimentos?.[0]?.id;

  const v1366 = await probeViewport(browser, token, session.user, 1366, atendimentoId);
  const v1280 = await probeViewport(browser, token, session.user, 1280, atendimentoId);

  const pageLo = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await pageLo.addInitScript(
    ({ t, u }) => {
      localStorage.setItem('mdoctor_auth_token', t);
      localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
    },
    { t: token, u: session.user }
  );
  await pageLo.goto(`${PANEL}/fila`, { waitUntil: 'domcontentloaded' });
  const logoutBtn = pageLo.getByRole('button', { name: /sair/i }).first();
  let logout = { clicked: false };
  if (await logoutBtn.count()) {
    await logoutBtn.click();
    await pageLo.waitForTimeout(1500);
    logout = {
      clicked: true,
      tokenCleared: await pageLo.evaluate(() => !localStorage.getItem('mdoctor_auth_token')),
      url: pageLo.url(),
    };
  }
  await pageLo.close();
  await browser.close();

  console.log(
    JSON.stringify(
      {
        panel: PANEL,
        queueCount: queue.atendimentos?.length ?? 0,
        atendimentoId,
        login,
        v1366,
        v1280,
        logout,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
