#!/usr/bin/env node
/** Login — captura proporção premium (1280×720 = 1920×1080 @ 150%) + antes/depois */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const VIEWPORT = { width: 1280, height: 720 };

const FINE_TUNE = process.env.LOGIN_FINE_TUNE === '1' || process.argv.includes('--ajuste-fino');
const COLUNAS = process.argv.includes('--aproximar-colunas');
const POSICAO_DIREITA = process.argv.includes('--posicionar-direita');
const HARMONIA = process.argv.includes('--harmonia');
const PREMIUM_FINAL = process.argv.includes('--premium-final');
const DEFINITIVO = process.argv.includes('--definitivo');
const FILES = DEFINITIVO
  ? {
      antesSource: 'login-definitivo-antes-1280x720.png',
      antes: 'login-definitivo-antes-1280x720.png',
      depois: 'login-definitivo-depois-1280x720.png',
      compare: 'login-definitivo-antes-depois.png',
      oficial: '01-login-final.png',
      viewport: 'login-viewport-1280x720-escala150.png',
    }
  : PREMIUM_FINAL
  ? {
      antesSource: 'login-premium-antes-1280x720.png',
      antes: 'login-premium-antes-1280x720.png',
      depois: 'login-premium-depois-1280x720.png',
      compare: 'login-premium-antes-depois.png',
      oficial: '01-login-final.png',
      viewport: 'login-viewport-1280x720-escala150.png',
    }
  : HARMONIA
  ? {
      antesSource: 'login-harmonia-antes-1280x720.png',
      antes: 'login-harmonia-antes-1280x720.png',
      depois: 'login-harmonia-depois-1280x720.png',
      compare: 'login-harmonia-antes-depois.png',
      oficial: '01-login-final.png',
      viewport: 'login-viewport-1280x720-escala150.png',
    }
  : POSICAO_DIREITA
  ? {
      antesSource: 'login-posicao-antes-1280x720.png',
      antes: 'login-posicao-antes-1280x720.png',
      depois: 'login-posicao-depois-1280x720.png',
      compare: 'login-posicao-antes-depois.png',
      oficial: '01-login-final.png',
      viewport: 'login-viewport-1280x720-escala150.png',
    }
  : COLUNAS
  ? {
      antesSource: 'login-colunas-antes-1280x720.png',
      antes: 'login-colunas-antes-1280x720.png',
      depois: 'login-colunas-depois-1280x720.png',
      compare: 'login-colunas-antes-depois.png',
      oficial: '01-login-final.png',
      viewport: 'login-viewport-1280x720-escala150.png',
    }
  : FINE_TUNE
  ? {
      antesSource: 'login-ajuste-fino-antes-1280x720.png',
      antes: 'login-ajuste-fino-antes-1280x720.png',
      depois: 'login-ajuste-fino-depois-1280x720.png',
      compare: 'login-ajuste-fino-antes-depois.png',
      oficial: '01-login-final.png',
      viewport: 'login-viewport-1280x720-escala150.png',
    }
  : {
      antesSource: 'login-viewport-1280x720-escala150.png',
      antes: 'login-proporcao-antes-1280x720.png',
      depois: 'login-proporcao-depois-1280x720.png',
      compare: 'login-proporcao-antes-depois.png',
      oficial: '01-login-final.png',
      viewport: 'login-viewport-1280x720-escala150.png',
    };

async function runChecks(page) {
  return page.evaluate(() => {
    const footer = document.querySelector('footer');
    const footerRect = footer?.getBoundingClientRect();
    const vh = window.innerHeight;
    return {
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      footerVisible: !!footer,
      footerBottom: footerRect?.bottom ?? 0,
      footerGap: footerRect ? vh - footerRect.bottom : 0,
      viewportH: vh,
      card3: !!document.body?.textContent?.includes('Tudo em um só lugar'),
    };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const antesSourcePath = path.join(OUT, FILES.antesSource);
  const antesPath = path.join(OUT, FILES.antes);
  const oficialPath = path.join(OUT, FILES.oficial);
  if (!fs.existsSync(antesPath)) {
    if (fs.existsSync(antesSourcePath)) {
      fs.copyFileSync(antesSourcePath, antesPath);
      console.log(`OK antes preservado → ${FILES.antes}`);
    } else if (
      (FINE_TUNE || COLUNAS || POSICAO_DIREITA || HARMONIA || PREMIUM_FINAL || DEFINITIVO) &&
      fs.existsSync(oficialPath)
    ) {
      fs.copyFileSync(oficialPath, antesPath);
      console.log(`OK antes (cópia ${FILES.oficial}) → ${FILES.antes}`);
    } else {
      console.warn(`AVISO: sem snapshot antes (${FILES.antesSource})`);
    }
  } else {
    console.log(`OK antes já existe → ${FILES.antes}`);
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
  await page.screenshot({ path: depoisPath, fullPage: false });
  fs.copyFileSync(depoisPath, path.join(OUT, FILES.viewport));
  fs.copyFileSync(depoisPath, path.join(OUT, FILES.oficial));
  console.log(`OK depois → ${FILES.depois}`);
  console.log(`OK ${FILES.oficial} atualizado`);

  const check = await runChecks(page);
  const overflow = check.scrollH > check.clientH + 2;
  const footerOk = check.footerVisible && check.footerBottom <= check.viewportH + 1;
  const footerBreathing = check.footerGap >= 8 || check.footerBottom <= check.viewportH - 8;

  console.log('Check:', check);
  console.log(`Overflow: ${overflow ? 'SIM' : 'NAO'}`);
  console.log(`Footer visível: ${footerOk ? 'SIM' : 'NAO'}`);
  console.log(`Rodapé com respiro (gap≥8px): ${footerBreathing ? 'SIM' : 'NAO'}`);
  console.log(`Card 3 visível: ${check.card3 ? 'SIM' : 'NAO'}`);

  if (fs.existsSync(antesPath)) {
    const antesB64 = fs.readFileSync(antesPath).toString('base64');
    const depoisB64 = fs.readFileSync(depoisPath).toString('base64');
    const compPage = await browser.newPage({ viewport: { width: 2640, height: 780 } });
    await compPage.setContent(`<!DOCTYPE html><html><head><style>
      *{margin:0;box-sizing:border-box}body{font-family:Segoe UI,sans-serif;background:#eef2f7;padding:20px}
      h2{font-size:14px;color:#5b6475;margin-bottom:10px;font-weight:700}
      .row{display:flex;gap:24px}
      img{width:1280px;height:720px;border:1px solid #d9e2f0}
    </style></head><body><div class="row">
      <div><h2>Antes</h2><img src="data:image/png;base64,${antesB64}"/></div>
      <div><h2>Depois (ajuste fino)</h2><img src="data:image/png;base64,${depoisB64}"/></div>
    </div></body></html>`);
    await compPage.screenshot({ path: path.join(OUT, FILES.compare), fullPage: true });
    await compPage.close();
    console.log(`OK comparação → ${FILES.compare}`);
  }

  await browser.close();

  const reportPath = path.join(OUT, 'LOGIN-REFINAMENTO-FINAL-RELATORIO.md');
  const now = new Date().toISOString();
  const md = `# Login — Refinamento visual final

**Gerado em:** ${now}
**Rota:** \`/login\`
**Viewport homologação:** 1280×720 (1920×1080 @ Windows 150%, zoom 100%)
**Referência:** \`Tela referencia final de login.png\`

## Artefatos (SCREENSHOTS-FINAIS)

- \`${FILES.oficial}\` — captura oficial (1280×720)
- \`${FILES.depois}\` — depois refinamento proporcional
- \`${FILES.antes}\` — antes refinamento proporcional
- \`${FILES.compare}\` — comparação lado a lado

## Validação automática

| Check | Resultado |
|-------|-----------|
| Overflow vertical | ${overflow ? 'FALHA' : 'OK'} |
| Footer visível | ${footerOk ? 'OK' : 'FALHA'} |
| Rodapé com respiro | ${footerBreathing ? 'OK' : 'REVISAR'} |
| 3º card informativo | ${check.card3 ? 'OK' : 'FALHA'} |

## Confirmação

${
    DEFINITIVO
      ? 'Definitivo: card direito +6% à esquerda (nudge 22px), rodapé 12px/#6a7788, tracking refinado.'
      : PREMIUM_FINAL
      ? 'Premium final: fundo sólido, watermark removida, logo −5%, cards −4%, form h −3%, faixa dourada +50%, conjunto ↑9px.'
      : HARMONIA
      ? 'Harmonia: grid 1fr/0.92fr, gap −18%, card −6%/−5%, headline −4%, respiro lateral/vertical.'
      : POSICAO_DIREITA
      ? 'Posicionamento: card login direito margin-left −1cm (coluna esquerda fixa).'
      : COLUNAS
        ? 'Aproximação colunas: gap central 4.6875rem → 3.75rem (−20% do vão).'
        : FINE_TUNE
          ? 'Ajuste fino: card direito −6%, gap colunas −15%, bloco esquerdo ↑0.75rem.'
          : 'Refinamento proporcional premium (~10% escala + margens).'
  } Sem alteração de auth, handlers, cores ou composição lateral.
`;
  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`OK relatório → LOGIN-REFINAMENTO-FINAL-RELATORIO.md`);

  if (overflow || !footerOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
