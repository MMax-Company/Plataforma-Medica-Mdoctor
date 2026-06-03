#!/usr/bin/env node
/** Captura antes/depois — correção logo transparente no login */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const ANTES_SRC = path.join(ROOT, 'docs/REPLICAÇÃO VISUAL DOCTOR PRESCREVE/login-replica-1366-captura.png');
const VIEWPORT = { width: 1366, height: 768 };

const FILES = {
  antes: 'login-logo-antes-fundo-branco.png',
  depois: 'login-logo-depois-transparente.png',
  compare: 'login-logo-antes-depois-comparacao.png',
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  if (fs.existsSync(ANTES_SRC)) {
    fs.copyFileSync(ANTES_SRC, path.join(OUT, FILES.antes));
    console.log(`OK antes (cópia captura anterior) → ${FILES.antes}`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => {
    localStorage.removeItem('mdoctor_auth_token');
    localStorage.removeItem('mdoctor_auth_user');
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);

  const depoisPath = path.join(OUT, FILES.depois);
  const viewportPath = path.join(OUT, 'login-viewport-1366x768-completo.png');
  await page.screenshot({ path: depoisPath, fullPage: false });
  fs.copyFileSync(depoisPath, viewportPath);
  console.log(`OK viewport completo → ${viewportPath}`);

  fs.copyFileSync(depoisPath, path.join(OUT, '01-login-final.png'));
  console.log(`OK 01-login-final.png atualizado`);

  const footerVisible = await page.locator('footer').isVisible();
  const thirdCard = await page.getByText('Tudo em um só lugar').isVisible();
  console.log(`Validação: footer=${footerVisible}, card3=${thirdCard}`);

  const antesPath = path.join(OUT, FILES.antes);
  if (fs.existsSync(antesPath)) {
    const antesB64 = fs.readFileSync(antesPath).toString('base64');
    const depoisB64 = fs.readFileSync(depoisPath).toString('base64');
    const compPage = await browser.newPage({ viewport: { width: 2800, height: 820 } });
    await compPage.setContent(`<!DOCTYPE html><html><head><style>
      *{margin:0;box-sizing:border-box}body{font-family:Segoe UI,sans-serif;background:#eef2f7;padding:20px}
      h2{font-size:14px;color:#5b6475;margin-bottom:10px;font-weight:700}
      .row{display:flex;gap:24px}
      img{width:1366px;height:768px;border:1px solid #d9e2f0}
    </style></head><body><div class="row">
      <div><h2>Antes (fundo branco no logo)</h2><img src="data:image/png;base64,${antesB64}"/></div>
      <div><h2>Depois (logo transparente)</h2><img src="data:image/png;base64,${depoisB64}"/></div>
    </div></body></html>`);
    await compPage.screenshot({ path: path.join(OUT, FILES.compare), fullPage: true });
    await compPage.close();
    console.log(`OK comparação → ${FILES.compare}`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
