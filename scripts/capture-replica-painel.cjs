const { chromium } = require('@playwright/test');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'docs', 'REPLICAÇÃO VISUAL DOCTOR PRESCREVE', 'replica-painel-medico-proporcional.html');
const outPath = path.join(root, 'docs', 'REPLICAÇÃO VISUAL DOCTOR PRESCREVE', 'painel-replica-atualizado-1366.png');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();
  console.log('Saved:', outPath);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
