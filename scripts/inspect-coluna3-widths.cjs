const { chromium } = require('@playwright/test');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'docs', 'REPLICAÇÃO VISUAL DOCTOR PRESCREVE', 'replica-painel-medico-proporcional.html');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

function pick(el) {
  if (!el) return null;
  return {
    tag: el.tagName,
    class: el.className || '',
    id: el.id || '',
    rect: {
      width: Math.round(el.rect.width * 100) / 100,
      height: Math.round(el.rect.height * 100) / 100,
      x: Math.round(el.rect.x * 100) / 100,
      y: Math.round(el.rect.y * 100) / 100,
    },
    styles: el.styles,
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const data = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.column')];
    const col3 = cols[2];
    const card = col3.querySelector('.patient-card--ready');
    const footer = card.querySelector('.coluna3-footer-ajustado');
    const left = footer?.querySelector('.bloco-esquerdo-sms-email');
    const sms = left?.querySelectorAll('button')[0];
    const email = left?.querySelectorAll('button')[1];
    const wa = footer?.querySelector('.botao-whatsapp-final');

    function info(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tagName: el.tagName,
        className: el.className,
        id: el.id,
        rect: { width: r.width, height: r.height, x: r.x, y: r.y },
        styles: {
          display: cs.display,
          flex: cs.flex,
          flexGrow: cs.flexGrow,
          flexShrink: cs.flexShrink,
          flexBasis: cs.flexBasis,
          width: cs.width,
          minWidth: cs.minWidth,
          maxWidth: cs.maxWidth,
          boxSizing: cs.boxSizing,
          padding: cs.padding,
          gap: cs.gap,
          alignItems: cs.alignItems,
          justifyContent: cs.justifyContent,
        },
      };
    }

    const chain = [
      { name: 'page .columns', el: document.querySelector('.columns') },
      { name: 'coluna3 .column', el: col3 },
      { name: 'coluna3 .column__scroll', el: col3.querySelector('.column__scroll') },
      { name: 'coluna3 .patient-card--ready', el: card },
      { name: 'coluna3 .coluna3-footer-ajustado', el: footer },
      { name: 'coluna3 .bloco-esquerdo-sms-email', el: left },
      { name: 'coluna3 btn SMS', el: sms },
      { name: 'coluna3 btn EMAIL', el: email },
      { name: 'coluna3 .botao-whatsapp-final', el: wa },
    ].map(({ name, el }) => ({ name, ...(info(el) || {}) }));

    const col1 = cols[0];
    const col2 = cols[1];
    const c1footer = col1.querySelector('.container-footer-coluna1');
    const c1atender = col1.querySelector('#btn-atender-c1');
    const c2footer = col2.querySelector('.container-footer-coluna2');
    const c2aceitar = col2.querySelector('#btn-aceitar-c2');
    const c2visualizar = col2.querySelector('#btn-visualizar-c2');

    const compare = [
      { name: 'coluna1 .column', el: col1 },
      { name: 'coluna1 footer', el: c1footer },
      { name: 'coluna1 #btn-atender-c1', el: c1atender },
      { name: 'coluna2 .column', el: col2 },
      { name: 'coluna2 footer', el: c2footer },
      { name: 'coluna2 #btn-visualizar-c2', el: c2visualizar },
      { name: 'coluna2 #btn-aceitar-c2', el: c2aceitar },
    ].map(({ name, el }) => ({ name, ...(info(el) || {}) }));

    return { chain, compare, viewport: { width: window.innerWidth, height: window.innerHeight } };
  });

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
