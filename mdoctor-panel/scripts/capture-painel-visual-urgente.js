#!/usr/bin/env node
/** Captura /fila?visualSim=1 pós-correção visual — staging ou local. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || 'drmax.matos';
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const FILA_SIM = `${PANEL}/fila?visualSim=1`;
const ANTES = path.join(OUT, 'painel-medico-visualsim-atual-validacao.png');
const OUT_1366 = path.join(OUT, 'painel-visual-urgente-depois-1366.png');
const OUT_1280 = path.join(OUT, 'painel-visual-urgente-depois-1280.png');
const OUT_COMPARE = path.join(OUT, 'painel-visual-urgente-antes-depois.png');
const OUT_JSON = path.join(OUT, 'PAINEL-VISUAL-URGENTE-VALIDACAO.json');

function loadLocalEnv() {
  const backendEnv = path.join(__dirname, '../../mdoctor-backend/.env.local');
  if (fs.existsSync(backendEnv) && !process.env.MEDICO_PASS) {
    for (const line of fs.readFileSync(backendEnv, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key === 'MEDICO_PASS') process.env.MEDICO_PASS = value;
    }
  }
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

async function apiLogin() {
  const urls = [`${PANEL}/api/auth/login`, `${(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '')}/api/auth/login`];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: USER, password: PASS }),
      });
      const data = await r.json();
      if (r.ok && data?.token) return data;
    } catch {
      /* next */
    }
  }
  return null;
}

async function gotoFila(page) {
  await page.goto(FILA_SIM, { waitUntil: 'networkidle', timeout: 120000 });
  if (page.url().includes('/login')) {
    await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.locator('input:not([type="password"])').first().fill(USER);
    await page.locator('input[type="password"]').fill(PASS);
    await page.getByRole('button', { name: /acessar painel/i }).click();
    await page.waitForURL(/\/(fila|dashboard)/, { timeout: 120000 });
    await page.goto(FILA_SIM, { waitUntil: 'networkidle', timeout: 120000 });
  }
  await page.getByText('FILA DE ESPERA', { exact: false }).first().waitFor({ timeout: 60000 });
}

async function auditLayout(page) {
  return page.evaluate(() => {
    const debugFooter = !!document.querySelector('.staging-audit-footer');
    const debugFooterText = Array.from(document.querySelectorAll('footer, [class*="audit"]'))
      .map((el) => el.textContent || '')
      .some((t) => /commit unknown|branch unknown|build/i.test(t));

    function overlaps(a, b) {
      const r1 = a.getBoundingClientRect();
      const r2 = b.getBoundingClientRect();
      return !(r1.bottom <= r2.top + 1 || r2.bottom <= r1.top + 1 || r1.right <= r2.left + 1 || r2.right <= r1.left + 1);
    }

    const cards = Array.from(document.querySelectorAll('.dp-patient-card'));
    const overlapIssues = [];
    const buttonOverflow = [];

    for (const card of cards) {
      const cardBox = card.getBoundingClientRect();
      const buttons = Array.from(card.querySelectorAll('button, a.dp-btn'));
      for (const btn of buttons) {
        const b = btn.getBoundingClientRect();
        if (b.bottom > cardBox.bottom + 2 || b.right > cardBox.right + 2 || b.left < cardBox.left - 2) {
          buttonOverflow.push({ label: btn.textContent?.trim().slice(0, 24), card: card.className });
        }
      }
      const head = card.querySelector('.dp-patient-card__head');
      const actions = card.querySelector('.dp-patient-card__actions');
      if (head && actions && overlaps(head, actions)) {
        overlapIssues.push('head×actions');
      }
      const meta = card.querySelector('.dp-patient-card__meta');
      if (meta && meta.textContent?.trim() && actions && overlaps(meta, actions)) {
        overlapIssues.push('meta×actions');
      }
    }

    const columns = Array.from(document.querySelectorAll('.dp-fila-column'));
    const colHeights = columns.map((c) => c.getBoundingClientRect().height);
    const scroll = document.querySelector('.dp-fila-column__scroll');
    const firstColScroll = columns[0]?.querySelector('.dp-fila-column__scroll');
    const visibleCards = firstColScroll
      ? Array.from(firstColScroll.querySelectorAll('.dp-patient-card')).filter((card) => {
          const r = card.getBoundingClientRect();
          const s = firstColScroll.getBoundingClientRect();
          return r.top >= s.top - 2 && r.bottom <= s.bottom + 2;
        }).length
      : 0;

    const header = document.querySelector('.panel-header');
    return {
      debugFooter,
      debugFooterText,
      overlapIssues: [...new Set(overlapIssues)],
      buttonOverflowCount: buttonOverflow.length,
      buttonOverflowSample: buttonOverflow.slice(0, 5),
      columnHeightSpread: colHeights.length ? Math.max(...colHeights) - Math.min(...colHeights) : 0,
      columnHeights: colHeights,
      totalCards: cards.length,
      visibleCardsInQueueColumn: visibleCards,
      operationalHeader: header?.classList.contains('panel-header--operational') ?? false,
      headerHeight: header?.getBoundingClientRect().height ?? 0,
    };
  });
}

async function composite(browser) {
  if (!fs.existsSync(ANTES) || !fs.existsSync(OUT_1366)) return;
  const page = await browser.newPage({ viewport: { width: 2800, height: 820 } });
  const antesB64 = fs.readFileSync(ANTES).toString('base64');
  const depoisB64 = fs.readFileSync(OUT_1366).toString('base64');
  await page.setContent(`<!DOCTYPE html><html><head><style>
    body{font-family:Segoe UI,sans-serif;background:#f5f8fc;padding:16px}
    h2{font-size:13px;color:#5b6475;margin:8px 0}
    .row{display:flex;gap:20px}
    img{border:1px solid #d9e2f0;width:1366px;height:768px;object-fit:contain}
  </style></head><body><div class="row">
    <div><h2>Antes (validação anterior)</h2><img src="data:image/png;base64,${antesB64}"/></div>
    <div><h2>Depois (correção visual urgente)</h2><img src="data:image/png;base64,${depoisB64}"/></div>
  </div></body></html>`);
  await page.screenshot({ path: OUT_COMPARE, fullPage: true });
  await page.close();
}

async function main() {
  if (!PASS) {
    console.error('MEDICO_PASS obrigatório');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const session = await apiLogin();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

  if (session?.token) {
    await page.addInitScript(
      ({ t, u }) => {
        localStorage.setItem('mdoctor_auth_token', t);
        localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
      },
      { t: session.token, u: session.user || { name: 'Dr Max Matos', role: 'admin' } },
    );
  }

  await gotoFila(page);
  await page.waitForTimeout(2000);
  const audit1366 = await auditLayout(page);
  await page.screenshot({ path: OUT_1366, fullPage: false });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(800);
  const audit1280 = await auditLayout(page);
  await page.screenshot({ path: OUT_1280, fullPage: false });

  await composite(browser);
  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    panelUrl: PANEL,
    filaUrl: FILA_SIM,
    screenshots: { depois1366: OUT_1366, depois1280: OUT_1280, compare: fs.existsSync(OUT_COMPARE) ? OUT_COMPARE : null },
    audit1366,
    audit1280,
    passed:
      !audit1366.debugFooter &&
      !audit1366.debugFooterText &&
      audit1366.overlapIssues.length === 0 &&
      audit1366.buttonOverflowCount === 0,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
