#!/usr/bin/env node
/** Diagnóstico visual /fila?visualSim=1 — screenshot + métricas */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || 'drmax.matos';
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const FILA_SIM = `${PANEL}/fila?visualSim=1`;
const VIEWPORT = { width: 1280, height: 720 };

function loadLocalEnv() {
  const envPath = path.join(__dirname, '../.env.local');
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

loadLocalEnv();
const PASS = process.env.MEDICO_PASS || process.env.TOUR_LOGIN_PASS || '';

async function tryApiLogin() {
  for (const url of [`${PANEL}/api/auth/login`]) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: USER, password: PASS }),
      });
      const data = await r.json();
      if (r.ok && data?.token) return data;
    } catch {
      /* */
    }
  }
  return null;
}

async function loginViaUi(page) {
  await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input:not([type="password"])').first().fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole('button', { name: /acessar painel/i }).click();
  await page.waitForURL(/\/(fila|dashboard)/, { timeout: 120000 });
}

async function diagnose(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.dp-patient-card'));
    const heights = cards.map((el) => Math.round(el.getBoundingClientRect().height));
    const styles = cards.slice(0, 3).map((el) => {
      const cs = getComputedStyle(el);
      return {
        height: cs.height,
        minHeight: cs.minHeight,
        maxHeight: cs.maxHeight,
        classes: el.className,
      };
    });
    const legacy = Array.from(document.querySelectorAll('[class*="patient"]')).filter(
      (el) => !el.className.includes('dp-patient-card'),
    );
    const dupHeaders = document.querySelectorAll('.panel-header').length;
    const dupFooters = document.querySelectorAll('.panel-footer').length;
    const ids = Array.from(document.querySelectorAll('.dp-patient-id')).map((el) => el.textContent?.trim());
    const simIds = ids.filter((t) => /vis-sim-/i.test(t || ''));
    const realLikeIds = ids.filter((t) => t && !/vis-sim-/i.test(t));
    const cols = ['FILA DE ESPERA', 'EM ATENDIMENTO', 'RECEITAS PRONTAS'].map((title) => ({
      title,
      visible: !!Array.from(document.querySelectorAll('h2')).find((h) => h.textContent?.includes(title)),
      count: (() => {
        const h2 = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent?.includes(title));
        if (!h2) return null;
        const section = h2.closest('section');
        return section?.querySelectorAll('.dp-patient-card').length ?? null;
      })(),
    }));
    const main = document.querySelector('main');
    const btnBottoms = {};
    for (const title of ['FILA DE ESPERA', 'EM ATENDIMENTO', 'RECEITAS PRONTAS']) {
      const h2 = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent?.includes(title));
      const card = h2?.closest('section')?.querySelector('.dp-patient-card');
      const slot = card?.querySelector('.dp-patient-card__actions-slot');
      btnBottoms[title] = slot ? Math.round(slot.getBoundingClientRect().bottom) : null;
    }
    return {
      url: location.href,
      visualSimParam: new URLSearchParams(location.search).get('visualSim'),
      dataVisualSim: main?.getAttribute('data-visual-sim') ?? null,
      mainHeight: main?.getBoundingClientRect().height ?? 0,
      primaryBtnBottoms: btnBottoms,
      filaVisible: !!document.body?.textContent?.includes('FILA DE ESPERA'),
      headerHeight: document.querySelector('.panel-header')?.getBoundingClientRect().height ?? 0,
      footerVisible: !!document.querySelector('.panel-footer')?.textContent?.includes('Prescrição'),
      footerInFlow: (() => {
        const f = document.querySelector('.panel-footer');
        if (!f) return false;
        const pos = getComputedStyle(f).position;
        return pos === 'static' || pos === 'relative';
      })(),
      mainOverflowX: main ? main.scrollWidth > main.clientWidth + 2 : false,
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      cardCount: cards.length,
      cardHeights: heights,
      cardHeightDelta: heights.length ? Math.max(...heights) - Math.min(...heights) : 0,
      cardStylesSample: styles,
      legacyPatientClasses: legacy.slice(0, 8).map((el) => el.className),
      dupHeaders,
      dupFooters,
      patientIdTotal: ids.length,
      simPatientIds: simIds.length,
      realLikePatientIds: realLikeIds.length,
      sampleIds: ids.slice(0, 5),
      columns: cols,
      supportBand: !!document.querySelector('.panel-support-band'),
      errorBanner: document.body?.textContent?.includes('Erro ao buscar') || false,
    };
  });
}

async function main() {
  if (!PASS) {
    console.error('MEDICO_PASS obrigatório');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const apiCalls = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/atendimentos')) apiCalls.push(u);
  });
  const session = await tryApiLogin();
  if (session?.token) {
    await page.addInitScript(
      ({ t, u }) => {
        localStorage.setItem('mdoctor_auth_token', t);
        localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
      },
      { t: session.token, u: session.user || { name: 'Max Matos', role: 'admin' } },
    );
    await page.goto(FILA_SIM, { waitUntil: 'networkidle', timeout: 120000 });
    if (page.url().includes('/login')) {
      await loginViaUi(page);
      await page.goto(FILA_SIM, { waitUntil: 'networkidle', timeout: 120000 });
    }
  } else {
    await loginViaUi(page);
    await page.goto(FILA_SIM, { waitUntil: 'networkidle', timeout: 120000 });
  }

  await page.getByText('FILA DE ESPERA').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);

  const shot = path.join(OUT, 'fila-visualsim-diagnostico-atual.png');
  await page.screenshot({ path: shot, fullPage: false });
  fs.copyFileSync(shot, path.join(OUT, '02-painel-medico-final.png'));

  const report = { ...(await diagnose(page)), apiCallsDuringLoad: apiCalls };
  const jsonPath = path.join(OUT, 'FILA-VISUALSIM-DIAGNOSTICO.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  console.log('Screenshot:', shot);
  console.log('Report:', jsonPath);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
