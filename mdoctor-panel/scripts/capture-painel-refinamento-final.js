#!/usr/bin/env node
/** Painel /fila — refinamento header + CTAs (1280×720 = 1080p @ 150%) */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const PANEL = (process.env.PANEL_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || 'drmax.matos';
const OUT = path.join(ROOT, 'docs/SCREENSHOTS-FINAIS');
const VIEWPORT = { width: 1280, height: 720 };
const FILA_SIM = `${PANEL}/fila?visualSim=1`;

const CONGELAMENTO = process.argv.includes('--congelamento');
const CORRECAO = process.argv.includes('--correcao-optica');
const LAYOUT_FINAL = process.argv.includes('--layout-final');
const ABSOLUTO_FINAL = process.argv.includes('--absoluto-final');
const HEADER_INICIAIS = process.argv.includes('--header-iniciais');
const HEADER_MICRO = process.argv.includes('--header-micro');
const PREMIUM_FINAL = process.argv.includes('--premium-final');
const INSTITUCIONAL_FINAL = process.argv.includes('--institucional-final');
const FECHAMENTO_FINAL = process.argv.includes('--fechamento-final');
const DEFINITIVO_FINAL = process.argv.includes('--definitivo-final');
const CARDS_PADRONIZADOS = process.argv.includes('--cards-padronizados');
const FILES = CARDS_PADRONIZADOS
  ? {
      antes: 'painel-cards-padronizados-antes-1280x720.png',
      depois: 'painel-cards-padronizados-depois-1280x720.png',
      compare: 'painel-cards-padronizados-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-CARDS-PADRONIZADOS-RELATORIO.md',
    }
  : DEFINITIVO_FINAL
  ? {
      antes: 'painel-definitivo-final-antes-1280x720.png',
      depois: 'painel-definitivo-final-depois-1280x720.png',
      compare: 'painel-definitivo-final-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-DEFINITIVO-FINAL-RELATORIO.md',
    }
  : FECHAMENTO_FINAL
  ? {
      antes: 'painel-fechamento-final-antes-1280x720.png',
      depois: 'painel-fechamento-final-depois-1280x720.png',
      compare: 'painel-fechamento-final-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-FECHAMENTO-FINAL-RELATORIO.md',
    }
  : INSTITUCIONAL_FINAL
  ? {
      antes: 'painel-institucional-final-antes-1280x720.png',
      depois: 'painel-institucional-final-depois-1280x720.png',
      compare: 'painel-institucional-final-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-INSTITUCIONAL-FINAL-RELATORIO.md',
    }
  : PREMIUM_FINAL
  ? {
      antes: 'painel-premium-final-antes-1280x720.png',
      depois: 'painel-premium-final-depois-1280x720.png',
      compare: 'painel-premium-final-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-PREMIUM-FINAL-RELATORIO.md',
    }
  : HEADER_MICRO
  ? {
      antes: 'painel-header-micro-antes-1280x720.png',
      depois: 'painel-header-micro-depois-1280x720.png',
      compare: 'painel-header-micro-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-HEADER-MICRO-RELATORIO.md',
    }
  : HEADER_INICIAIS
  ? {
      antes: 'painel-header-iniciais-antes-1280x720.png',
      depois: 'painel-header-iniciais-depois-1280x720.png',
      compare: 'painel-header-iniciais-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-HEADER-INICIAIS-RELATORIO.md',
    }
  : ABSOLUTO_FINAL
  ? {
      antes: 'painel-absoluto-antes-1280x720.png',
      depois: 'painel-absoluto-depois-1280x720.png',
      compare: 'painel-absoluto-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-ABSOLUTO-FINAL-RELATORIO.md',
    }
  : LAYOUT_FINAL
  ? {
      antes: 'painel-layout-final-antes-1280x720.png',
      depois: 'painel-layout-final-depois-1280x720.png',
      compare: 'painel-layout-final-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-LAYOUT-FINAL-RELATORIO.md',
    }
  : CORRECAO
  ? {
      antes: 'painel-correcao-antes-1280x720.png',
      depois: 'painel-correcao-depois-1280x720.png',
      compare: 'painel-correcao-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-CORRECAO-OPTICA-RELATORIO.md',
    }
  : CONGELAMENTO
  ? {
      antes: 'painel-congelamento-antes-1280x720.png',
      depois: 'painel-congelamento-depois-1280x720.png',
      compare: 'painel-congelamento-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-CONGELAMENTO-LAYOUT-RELATORIO.md',
    }
  : {
      antes: 'painel-refinamento-antes-1280x720.png',
      depois: 'painel-refinamento-depois-1280x720.png',
      compare: 'painel-refinamento-antes-depois.png',
      oficial: '02-painel-medico-final.png',
      report: 'PAINEL-REFINAMENTO-FINAL-RELATORIO.md',
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
  const endpoints = [`${PANEL}/api/auth/login`, BACKEND ? `${BACKEND}/api/auth/login` : null].filter(Boolean);
  for (const url of endpoints) {
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

async function loginViaUi(page) {
  await page.goto(`${PANEL}/login`, { waitUntil: 'networkidle', timeout: 120000 });
  await page.locator('input:not([type="password"])').first().fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole('button', { name: /acessar painel/i }).click();
  await page.waitForURL(/\/(fila|dashboard)/, { timeout: 120000 });
}

async function measure(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const header = document.querySelector('.panel-header');
    const logoEl = document.querySelector('.panel-header__logo');
    const prontuario = document.querySelector(
      '.panel-header__col--center .dp-btn-outline-soft, .panel-header__center .dp-btn-outline-soft',
    );
    const colBadges = Array.from(document.querySelectorAll('.dp-col-count-alert'));
    const colBadgeRed = colBadges.every((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      return bg.includes('180') || bg.includes('159') || bg.includes('185');
    });
    const greenBtn = document.querySelector('.dp-btn-green');
    return {
      scrollH: document.documentElement.scrollHeight,
      clientH: document.documentElement.clientHeight,
      mainOverflowX: main ? main.scrollWidth > main.clientWidth + 2 : false,
      headerHeight: header?.getBoundingClientRect().height ?? 0,
      btnHeights: Array.from(document.querySelectorAll('.dp-btn')).map((el) => el.getBoundingClientRect().height),
      logoHasTintBox: logoEl
        ? Boolean(
            getComputedStyle(logoEl).boxShadow !== 'none' ||
              getComputedStyle(logoEl).filter !== 'none' ||
              getComputedStyle(logoEl).backgroundColor !== 'rgba(0, 0, 0, 0)',
          )
        : false,
      prontuarioVisible: !!prontuario,
      greenBtnWidth: greenBtn?.getBoundingClientRect().width ?? 0,
      greenBtnSingleLine: greenBtn ? greenBtn.scrollHeight <= 42 : true,
      supportBandHeight: document.querySelector('.panel-support-band')?.getBoundingClientRect().height ?? 0,
      patientCardsUseInitials: (() => {
        const titles = Array.from(document.querySelectorAll('.dp-patient-card-label'));
        if (!titles.length) return false;
        return titles.every((el) => {
          const text = (el.textContent || '').trim();
          return /^[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇ](\.[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇ])+$/u.test(text) || /^[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇ]{1,2}$/u.test(text);
        });
      })(),
      colBadgeRed,
      filaVisible: !!document.body?.textContent?.includes('FILA DE ESPERA'),
      suporteVisible: !!document.body?.textContent?.includes('SUPORTE MÉDICO VIA WHATSAPP'),
      panelFooterVisible: !!document.querySelector('.panel-footer')?.textContent?.includes('Prescrição Médica'),
      panelFooterInFlow: (() => {
        const footer = document.querySelector('.panel-footer');
        if (!footer) return false;
        return getComputedStyle(footer).position === 'static' || getComputedStyle(footer).position === 'relative';
      })(),
      columnCapsVisible: document.querySelectorAll('.dp-fila-column__footer').length >= 3,
      patientCardsUniform: (() => {
        const cards = Array.from(document.querySelectorAll('.dp-patient-card'));
        if (cards.length < 3) return false;
        const heights = cards.map((el) => Math.round(el.getBoundingClientRect().height));
        const min = Math.min(...heights);
        const max = Math.max(...heights);
        return max - min <= 8;
      })(),
      secondaryBtnsMatch: (() => {
        const visualizar = document.querySelector('.dp-actions-pair .dp-btn-secondary-pair');
        const email = Array.from(document.querySelectorAll('.dp-actions-pair .dp-btn-secondary-pair')).find((el) =>
          el.textContent?.includes('E-MAIL'),
        );
        if (!visualizar || !email) return true;
        const a = getComputedStyle(visualizar);
        const b = getComputedStyle(email);
        return Math.abs(parseFloat(a.height) - parseFloat(b.height)) < 2;
      })(),
    };
  });
}

async function main() {
  if (!PASS) {
    console.error('MEDICO_PASS obrigatório');
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const antesPath = path.join(OUT, FILES.antes);
  const baseline = path.join(OUT, 'painel-medico-10-pacientes-baseline.png');
  const prev = path.join(OUT, 'painel-refinamento-depois-1280x720.png');
  const oficialPrev = path.join(OUT, FILES.oficial);
  if (!fs.existsSync(antesPath)) {
    if (
      (CARDS_PADRONIZADOS ||
        DEFINITIVO_FINAL ||
        FECHAMENTO_FINAL ||
        INSTITUCIONAL_FINAL ||
        PREMIUM_FINAL ||
        HEADER_MICRO ||
        HEADER_INICIAIS ||
        ABSOLUTO_FINAL ||
        LAYOUT_FINAL ||
        CORRECAO ||
        CONGELAMENTO) &&
      fs.existsSync(oficialPrev)
    ) {
      fs.copyFileSync(oficialPrev, antesPath);
    }
    else if (fs.existsSync(prev)) fs.copyFileSync(prev, antesPath);
    else if (fs.existsSync(baseline)) fs.copyFileSync(baseline, antesPath);
    else {
      const alt = path.join(ROOT, 'docs/TESTE-OPERACIONAL-10-PACIENTES/02-painel-medico-10-pacientes-atual.png');
      if (fs.existsSync(alt)) fs.copyFileSync(alt, antesPath);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

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
  await page.waitForTimeout(2000);

  const depoisPath = path.join(OUT, FILES.depois);
  await page.screenshot({ path: depoisPath, fullPage: false });
  fs.copyFileSync(depoisPath, path.join(OUT, FILES.oficial));
  console.log(`OK depois → ${FILES.depois}`);
  console.log(`OK oficial → ${FILES.oficial}`);

  const metrics = await measure(page);
  console.log('Metrics:', metrics);

  if (fs.existsSync(antesPath)) {
    const antesB64 = fs.readFileSync(antesPath).toString('base64');
    const depoisB64 = fs.readFileSync(depoisPath).toString('base64');
    const comp = await browser.newPage({ viewport: { width: 2640, height: 780 } });
    await comp.setContent(`<!DOCTYPE html><html><head><style>
      *{margin:0;box-sizing:border-box}body{font-family:Segoe UI,sans-serif;background:#f5f8fc;padding:20px}
      h2{font-size:14px;color:#5b6475;margin-bottom:10px;font-weight:700}
      .row{display:flex;gap:24px}
      img{width:1280px;height:720px;border:1px solid #d9e2f0}
    </style></head><body><div class="row">
      <div><h2>Antes</h2><img src="data:image/png;base64,${antesB64}"/></div>
      <div><h2>Depois (header + CTAs + badges)</h2><img src="data:image/png;base64,${depoisB64}"/></div>
    </div></body></html>`);
    await comp.screenshot({ path: path.join(OUT, FILES.compare), fullPage: true });
    await comp.close();
    console.log(`OK comparação → ${FILES.compare}`);
  }

  const overflow =
    metrics.scrollH > metrics.clientH + 4 && metrics.scrollH - metrics.clientH > 52;
  const primaryBtns = await page.evaluate(() => {
    const sel = ['.dp-btn-blue', '.dp-btn-orange', '.dp-btn-green'].join(',');
    return Array.from(document.querySelectorAll(sel)).map((el) => ({
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    }));
  });
  const primaryHeights = primaryBtns.map((b) => b.h);
  const btnUniform =
    primaryHeights.length > 0 && primaryHeights.every((h) => Math.abs(h - 40) < 2);
  const primarySameWidth =
    primaryBtns.length >= 2 && new Set(primaryBtns.map((b) => b.w)).size <= 2;
  const md = `# Painel Médico — ${
    CARDS_PADRONIZADOS
      ? 'Padronização absoluta dos cards de pacientes'
      : DEFINITIVO_FINAL
      ? 'Fechamento visual definitivo — Painel Médico Central'
      : FECHAMENTO_FINAL
      ? 'Fechamento visual final — Painel Médico Central'
      : INSTITUCIONAL_FINAL
      ? 'Alinhamento institucional definitivo — Painel Médico'
      : PREMIUM_FINAL
      ? 'Consolidação visual premium — Doctor Prescreve'
      : HEADER_MICRO
      ? 'Header institucional — microajuste óptico'
      : HEADER_INICIAIS
      ? 'Header institucional + iniciais pacientes'
      : ABSOLUTO_FINAL
      ? 'Ajuste final absoluto — painel central'
      : LAYOUT_FINAL
      ? 'Layout final — fechamento painel central'
      : CORRECAO
        ? 'Correção óptica definitiva'
        : CONGELAMENTO
          ? 'Congelamento layout'
          : 'Refinamento visual final'
  }

**Gerado em:** ${new Date().toISOString()}
**Rota:** \`/fila?visualSim=1\`
**Viewport:** 1280×720 (1920×1080 @ Windows 150%)

## Artefatos

- \`${FILES.oficial}\`
- \`${FILES.depois}\`
- \`${FILES.antes}\`
- \`${FILES.compare}\`

## Validação

| Check | Resultado |
|-------|-----------|
| Overflow vertical | ${overflow ? 'REVISAR' : 'OK'} |
| Overflow horizontal | ${metrics.mainOverflowX ? 'REVISAR' : 'OK'} |
| Header presença (120px) | ${metrics.headerHeight >= 118 && metrics.headerHeight <= 122 ? 'OK' : 'REVISAR'} |
| Rodapé institucional | ${metrics.panelFooterVisible && metrics.panelFooterInFlow ? 'OK' : 'REVISAR'} |
| E-mail/SMS = Visualizar | ${metrics.secondaryBtnsMatch ? 'OK' : 'REVISAR'} |
| Cards pacientes altura uniforme | ${metrics.patientCardsUniform ? 'OK' : 'REVISAR'} |
| Cards exibem iniciais (não nome completo) | ${metrics.patientCardsUseInitials ? 'OK' : 'REVISAR'} |
| Faixa suporte discreta (≤68px) | ${metrics.supportBandHeight > 0 && metrics.supportBandHeight <= 68 ? 'OK' : 'REVISAR'} |
| CTA verde linha única | ${metrics.greenBtnSingleLine ? 'OK' : 'REVISAR'} |
| Badges coluna vermelho fechado | ${metrics.colBadgeRed ? 'OK' : 'REVISAR'} |
| CTAs altura uniforme (40px) | ${btnUniform ? 'OK' : 'REVISAR'} |
| CTAs primários mesma largura | ${primarySameWidth ? 'OK' : 'REVISAR'} |
| Logo sem caixa tinta | ${metrics.logoHasTintBox ? 'REVISAR' : 'OK'} |
| Botão PRONTUÁRIO | ${metrics.prontuarioVisible ? 'OK' : 'N/A'} |
| Fila + suporte | ${metrics.filaVisible && metrics.suporteVisible ? 'OK' : 'REVISAR'} |
| Colunas com fechamento inferior | ${metrics.columnCapsVisible ? 'OK' : 'REVISAR'} |
| Botão verde ≈ laranja (172px slot) | ${metrics.greenBtnWidth > 0 && Math.abs(metrics.greenBtnWidth - 172) < 12 ? 'OK' : metrics.greenBtnWidth ? 'REVISAR' : 'N/A'} |

## CTAs primários (amostra)

\`\`\`json
${JSON.stringify(primaryBtns, null, 2)}
\`\`\`

## Escopo

Matriz laranja, badges/SAIR vermelho fechado (#B4232A), header 74px em 3 grupos, iniciais nome+sobrenome, ID ATD-*, micro botão contato. Sem alteração de APIs, auth ou elegibilidade.
`;
  fs.writeFileSync(path.join(OUT, FILES.report), md, 'utf8');
  console.log(`OK relatório → ${FILES.report}`);

  await browser.close();
  if (metrics.mainOverflowX) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
