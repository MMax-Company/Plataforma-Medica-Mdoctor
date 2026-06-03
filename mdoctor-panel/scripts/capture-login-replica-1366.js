#!/usr/bin/env node
/** Login 1366×768 — captura + comparação com mockup + SCREENSHOTS-FINAIS */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const REF_DIR = path.join(ROOT, 'docs/REPLICAÇÃO VISUAL DOCTOR PRESCREVE');
const REF = path.join(REF_DIR, 'Tela referencia final de login.png');
const REF_FALLBACK = path.join(REF_DIR, 'TELA DE LOGIN DOCTOR PRESCREVE.png');
const OUT_REPLICA = REF_DIR;
const OUT_FINAL = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const VIEWPORT = { width: 1366, height: 768 };

const CAPTURE_REPLICA = path.join(OUT_REPLICA, 'login-replica-1366-captura.png');
const COMPARE_REPLICA = path.join(OUT_REPLICA, 'login-replica-1366-comparacao.png');
const CAPTURE_FINAL = path.join(OUT_FINAL, '01-login-final.png');
const COMPARE_FINAL = path.join(OUT_FINAL, 'login-final-comparacao.png');
const REPORT_FINAL = path.join(OUT_FINAL, 'LOGIN-REFINAMENTO-FINAL-RELATORIO.md');

function resolveRef() {
  if (fs.existsSync(REF)) return REF;
  if (fs.existsSync(REF_FALLBACK)) return REF_FALLBACK;
  throw new Error('Mockup de referência não encontrado');
}

async function compositeSideBySide(browser, refPath, capPath, outPath) {
  const refB64 = fs.readFileSync(refPath).toString('base64');
  const capB64 = fs.readFileSync(capPath).toString('base64');
  const page = await browser.newPage({ viewport: { width: 2800, height: 820 } });
  await page.setContent(`<!DOCTYPE html>
<html><head><style>
  *{margin:0;box-sizing:border-box}
  body{font-family:Segoe UI,sans-serif;background:#eef2f7;padding:20px}
  h2{font-size:15px;color:#5b6475;margin-bottom:10px;font-weight:700}
  .row{display:flex;gap:28px;align-items:flex-start}
  img{display:block;width:1366px;height:768px;object-fit:contain;border:1px solid #d9e2f0}
</style></head><body>
  <div class="row">
    <div><h2>Referência oficial</h2><img src="data:image/png;base64,${refB64}" width="1366" height="768"/></div>
    <div><h2>Implementação atual (1366×768)</h2><img src="data:image/png;base64,${capB64}" width="1366" height="768"/></div>
  </div>
</body></html>`);
  await page.screenshot({ path: outPath, fullPage: true });
  await page.close();
}

function writeReport(refPath) {
  const lines = [
    '# Login — Refinamento visual final',
    '',
    `**Gerado em:** ${new Date().toISOString()}`,
    `**Rota:** \`/login\``,
    `**Viewport:** 1366×768`,
    `**Referência:** \`${path.basename(refPath)}\``,
    '',
    '## Artefatos (SCREENSHOTS-FINAIS)',
    '',
    '- `01-login-final.png` — captura oficial',
    '- `login-final-comparacao.png` — lado a lado com mockup',
    '',
    '## Confirmação',
    '',
    'Refinamento visual premium aplicado (sem alteração de auth, handlers ou fluxo).',
    '',
  ];
  fs.writeFileSync(REPORT_FINAL, lines.join('\n'), 'utf8');
}

async function main() {
  const refPath = resolveRef();
  fs.mkdirSync(OUT_REPLICA, { recursive: true });
  fs.mkdirSync(OUT_FINAL, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => {
    localStorage.removeItem('mdoctor_auth_token');
    localStorage.removeItem('mdoctor_auth_user');
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await page.getByRole('button', { name: /acessar painel/i }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);

  await page.screenshot({ path: CAPTURE_REPLICA, fullPage: false });
  fs.copyFileSync(CAPTURE_REPLICA, CAPTURE_FINAL);
  console.log(`OK captura → ${CAPTURE_FINAL}`);

  await compositeSideBySide(browser, refPath, CAPTURE_FINAL, COMPARE_REPLICA);
  fs.copyFileSync(COMPARE_REPLICA, COMPARE_FINAL);
  console.log(`OK comparação → ${COMPARE_FINAL}`);

  await browser.close();
  writeReport(refPath);
  console.log(`OK relatório → ${REPORT_FINAL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
