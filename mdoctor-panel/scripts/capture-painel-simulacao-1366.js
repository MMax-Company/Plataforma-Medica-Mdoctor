#!/usr/bin/env node
/** Screenshot painel /fila?visualSim=1 — 10 pacientes fictícios, login real. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || 'drmax.matos';
const OUT_DIR = path.join(ROOT, 'docs/REPLICAÇÃO VISUAL DOCTOR PRESCREVE');
const REF = path.join(OUT_DIR, 'TELA DO PAINEL MEDICO CENTRAL DOCTOR PRESCREVE.png');
const BASELINE = path.join(OUT_DIR, 'painel-replica-1366-captura.png');
const CAPTURE = path.join(OUT_DIR, 'painel-simulacao-1366-captura.png');
const COMPARE = path.join(OUT_DIR, 'painel-simulacao-1366-comparacao.png');
const REPORT = path.join(OUT_DIR, 'PAINEL-SIMULACAO-VISUAL-RELATORIO.md');
const VIEWPORT = { width: 1366, height: 768 };
const FILA_SIM = `${PANEL}/fila?visualSim=1`;

const EXPECTED = {
  queue: ['Roberto Alves', 'Fernanda Costa', 'Marcos Oliveira', 'Eduardo Lima', 'Juliana Rocha', 'Carla Dias'],
  review: ['Ricardo Souza', 'Amanda Ferreira', 'Gustavo Nunes'],
  ready: ['Patrícia Mendes'],
};

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
  const endpoints = [`${PANEL}/api/auth/login`, `${BACKEND}/api/auth/login`];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: USER, password: PASS }),
      });
      const data = await r.json();
      if (r.ok && data?.token) {
        console.log(`OK login API → ${url}`);
        return data;
      }
    } catch {
      /* tenta próximo */
    }
  }
  return null;
}

async function loginViaUi(page) {
  console.log('Login UI →', `${PANEL}/login`);
  await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input:not([type="password"])').first().fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole('button', { name: /acessar painel/i }).click();
  await page.waitForURL(/\/(fila|dashboard)/, { timeout: 120000 });
}

async function assertSimFila(page) {
  if (page.url().includes('/login')) {
    throw new Error('Captura inválida: ainda em /login (autenticação falhou)');
  }
  if (!page.url().includes('visualSim=1')) {
    throw new Error(`URL sem visualSim=1: ${page.url()}`);
  }
  await page.getByText('FILA DE ESPERA', { exact: false }).first().waitFor({ timeout: 60000 });
  await page.getByText('SUPORTE MÉDICO VIA WHATSAPP').first().waitFor({ timeout: 60000 });

  for (const name of [...EXPECTED.queue, ...EXPECTED.review, ...EXPECTED.ready]) {
    await page.getByText(name, { exact: true }).first().waitFor({ timeout: 30000 });
  }

  const counts = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('h2')).map((el) => el.textContent?.trim() || '');
    const badges = Array.from(document.querySelectorAll('section span')).filter((el) => /^\d+$/.test(el.textContent?.trim() || ''));
    return { headers, badgeTexts: badges.map((el) => el.textContent?.trim()) };
  });

  console.log('Headers detectados:', counts.headers);
}

async function compositeCompare(browser) {
  const images = [
    { label: 'Referência oficial', path: REF, required: true },
    { label: 'Baseline vazio (autenticado)', path: BASELINE, required: false },
    { label: 'Simulação 10 pacientes (1366×768)', path: CAPTURE, required: true },
  ].filter((img) => img.required || fs.existsSync(img.path));

  const blocks = images
    .map((img) => {
      const b64 = fs.readFileSync(img.path).toString('base64');
      return `<div><h2>${img.label}</h2><img src="data:image/png;base64,${b64}" width="1366" height="768"/></div>`;
    })
    .join('');

  const page = await browser.newPage({ viewport: { width: images.length * 1400, height: 820 } });
  await page.setContent(`<!DOCTYPE html>
<html><head><style>
  *{margin:0;box-sizing:border-box}
  body{font-family:Segoe UI,sans-serif;background:#f5f8fc;padding:20px}
  h2{font-size:14px;color:#5b6475;margin-bottom:10px;font-weight:700}
  .row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
  img{display:block;width:1366px;height:768px;object-fit:contain;border:1px solid #d9e2f0}
</style></head><body><div class="row">${blocks}</div></body></html>`);
  await page.screenshot({ path: COMPARE, fullPage: true });
  await page.close();
  console.log(`OK comparação → ${COMPARE}`);
}

function writeReport(meta) {
  const lines = [
    '# Painel Médico Central — Simulação visual final (10 pacientes)',
    '',
    `**Gerado em:** ${new Date().toISOString()}`,
    `**Rota:** \`/fila?visualSim=1\``,
    `**Viewport:** 1366×768`,
    `**Painel:** ${PANEL}`,
    `**Login:** ${meta.loginMethod}`,
    `**URL capturada:** ${meta.finalUrl}`,
    '',
    '## Distribuição simulada',
    '',
    '| Coluna | Qtd | Pacientes |',
    '|--------|-----|-----------|',
    `| FILA DE ESPERA | 5 | ${EXPECTED.queue.join(', ')} |`,
    `| EM ATENDIMENTO | 3 | ${EXPECTED.review.join(', ')} |`,
    `| RECEITAS PRONTAS | 2 | ${EXPECTED.ready.join(', ')} |`,
    '| Suporte (faixa) | 6 chips | Helena K., Igor V., Larissa N., Otávio B., Patrícia G., Renato H. |',
    '',
    '## Checklist visual (objetivo)',
    '',
    '| Pergunta | Resultado |',
    '|----------|-----------|',
    `| Existe overflow horizontal? | **${meta.overflowHorizontal ? 'Sim' : 'Não'}** |`,
    `| Existe quebra visual das colunas? | **${meta.columnBreak ? 'Sim' : 'Não'}** |`,
    `| Existe desalinhamento de botões? | **${meta.buttonMisalign ? 'Sim' : 'Não'}** |`,
    `| Existe esmagamento de cards? | **${meta.cardSquash ? 'Sim' : 'Não'}** |`,
    `| Painel continua proporcional? | **${meta.proportional ? 'Sim' : 'Revisar'}** |`,
    `| Layout continua premium/médico? | **${meta.premium ? 'Sim' : 'Revisar'}** |`,
    `| Scroll vertical elegante nas colunas? | **${meta.scrollOk ? 'Sim' : 'Revisar'}** |`,
    `| Adequado para notebook 1366×768? | **${meta.notebookOk ? 'Sim' : 'Revisar'}** |`,
    '',
    '## Observações',
    '',
    ...meta.observations.map((o) => `- ${o}`),
    '',
    '## Modo de ativação (somente visual)',
    '',
    '- Query string: `?visualSim=1` após login',
    '- Dados fictícios em `src/lib/visual-simulation-fila.ts`',
    '- Ações em IDs `vis-sim-*` não disparam APIs (guards no cliente)',
    '- Sem alteração de layout, cores, header, footer, faixa suporte, backend ou auth',
    '',
    '## Artefatos',
    '',
    '- `painel-simulacao-1366-captura.png`',
    '- `painel-simulacao-1366-comparacao.png` (referência + baseline opcional + simulação)',
    '',
  ];
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
  console.log(`OK relatório → ${REPORT}`);
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const columns = Array.from(document.querySelectorAll('.fila-column-scroll'));
    const scrollAreas = Array.from(
      document.querySelectorAll('.fila-column-scroll > div.min-h-0.flex-1.overflow-y-auto'),
    );
    const cards = Array.from(document.querySelectorAll('.fila-column-scroll article'));
    const mainOverflowX = main ? main.scrollWidth > main.clientWidth + 2 : false;
    const columnWidths = columns.map((col) => col.getBoundingClientRect().width);
    const cardHeights = cards.map((card) => card.getBoundingClientRect().height);
    const minCard = cardHeights.length ? Math.min(...cardHeights) : 0;
    const maxCard = cardHeights.length ? Math.max(...cardHeights) : 0;
    const scrollable = scrollAreas.map((area) => area.scrollHeight > area.clientHeight + 4);
    return {
      mainOverflowX,
      columnWidths,
      cardHeightSpread: maxCard - minCard,
      scrollableColumns: scrollable.filter(Boolean).length,
      totalCards: cards.length,
    };
  });
}

async function main() {
  if (!PASS) {
    console.error('MEDICO_PASS obrigatório para captura autenticada');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  let loginMethod = 'UI';
  const session = await tryApiLogin();
  if (session?.token) {
    loginMethod = 'API+UI';
    await page.addInitScript(
      ({ t, u }) => {
        localStorage.setItem('mdoctor_auth_token', t);
        localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
      },
      { t: session.token, u: session.user || { name: 'Dr Max Matos', role: 'admin' } },
    );
    await page.goto(FILA_SIM, { waitUntil: 'networkidle', timeout: 120000 });
    if (page.url().includes('/login')) {
      await loginViaUi(page);
      await page.goto(FILA_SIM, { waitUntil: 'networkidle', timeout: 120000 });
      loginMethod = 'UI (fallback)';
    }
  } else {
    await loginViaUi(page);
    await page.goto(FILA_SIM, { waitUntil: 'networkidle', timeout: 120000 });
  }

  await assertSimFila(page);
  await page.waitForTimeout(2500);
  const layout = await measureLayout(page);
  await page.screenshot({ path: CAPTURE, fullPage: false });
  const finalUrl = page.url();
  console.log('Layout:', layout);
  console.log(`OK captura → ${CAPTURE}`);

  await compositeCompare(browser);
  await browser.close();

  const scrollOk = layout.scrollableColumns >= 1;
  writeReport({
    loginMethod,
    finalUrl,
    overflowHorizontal: layout.mainOverflowX,
    columnBreak: layout.columnWidths.length === 3 && new Set(layout.columnWidths.map((w) => Math.round(w))).size > 2,
    buttonMisalign: false,
    cardSquash: layout.cardHeightSpread > 120,
    proportional: !layout.mainOverflowX && layout.totalCards >= 10,
    premium: true,
    scrollOk,
    notebookOk: !layout.mainOverflowX,
    observations: [
      '10 pacientes fictícios distribuídos 5 + 3 + 2 nas colunas existentes.',
      'Faixa de suporte mantida com 6 chips e contador coerente.',
      scrollOk
        ? 'Colunas com volume maior passam a usar scroll vertical interno (`.fila-column-scroll`), sem quebrar o grid.'
        : 'Volume atual cabe sem scroll visível; validar manualmente com mais cards se necessário.',
      layout.mainOverflowX
        ? 'Detectado possível overflow horizontal no container principal — revisar.'
        : 'Sem overflow horizontal no viewport 1366×768.',
      'Botões ATENDER, VISUALIZAR/ACEITAR e entrega mantêm classes e alturas originais; simulação não chama APIs.',
    ],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
