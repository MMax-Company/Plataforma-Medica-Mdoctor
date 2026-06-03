#!/usr/bin/env node
/** Login — validação 1920×1080 @ escala 150% (viewport CSS ~1280×720) */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const VIEWPORT = { width: 1280, height: 720 };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.evaluate(() => {
    localStorage.removeItem('mdoctor_auth_token');
    localStorage.removeItem('mdoctor_auth_user');
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(1500);

  const out = path.join(OUT, 'login-viewport-1280x720-escala150.png');
  await page.screenshot({ path: out, fullPage: false });

  const check = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
    footerVisible: !!document.querySelector('footer'),
    footerBottom: document.querySelector('footer')?.getBoundingClientRect().bottom,
    viewportH: window.innerHeight,
  }));

  console.log('OK →', out);
  console.log('Check:', check);
  console.log('Overflow:', check.scrollH > check.clientH + 2 ? 'SIM' : 'NAO');
  console.log('Footer na viewport:', check.footerBottom <= check.viewportH + 1 ? 'SIM' : 'NAO');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
