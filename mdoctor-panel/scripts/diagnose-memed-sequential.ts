/**
 * DIAGNÓSTICO: Por que pacientes sequenciais falham em setPaciente?
 *
 * Hipótese principal (baseada na análise do SDK sinapse-prescricao.min.js v3.25.0):
 *   ensureMemedScript() chama syncMemedScriptToken() a cada abertura de overlay.
 *   syncMemedScriptToken() chama MdSinapsePrescricao.setToken().
 *   setToken() com iframes presentes faz iframe.src = iframe.src (RELOAD COMPLETO).
 *   Após reload, patient-management reinicializa (12-30s), mas nosso timeout de setPaciente
 *   (12s + 30s = 42.3s) frequentemente expira antes de completar.
 *
 * Este script confirma ou refuta a hipótese monitorando:
 *   1. Chamadas a MdSinapsePrescricao.setToken
 *   2. Mudanças em iframe.src (recarga de iframes)
 *   3. Eventos core:moduleInit após cada abertura
 *   4. Timing de cada comando Memed
 */

import { chromium, type Page, type BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_URL = 'https://painel-medico-staging-staging.up.railway.app';
const CREDENTIALS = { username: 'drmax.matos', password: 'Gr@tid@0' };
const REPORT_PATH = path.join(__dirname, '..', 'memed-diag-report.json');

// IDs de atendimentos elegíveis (com CPF e telefone)
const TARGET_PATIENTS = [
  { id: 'c0cf8071-76e0-4b64-ade1-e291d8075739', name: 'Ana Maria Souza' },
  { id: '6670e0bd-e0fd-46f8-9706-653eff5a0a89', name: 'Carlos Eduardo Lima' },
];

type DiagEvent = {
  t: number; // ms desde início
  type: string;
  detail?: unknown;
};

const events: DiagEvent[] = [];
let startTime = 0;

function log(type: string, detail?: unknown) {
  const t = Date.now() - startTime;
  events.push({ t, type, detail });
  const ts = `[${String(Math.floor(t / 1000)).padStart(3, '0')}s]`;
  console.log(`${ts} ${type}`, detail !== undefined ? JSON.stringify(detail).slice(0, 120) : '');
}

/**
 * Injeta instrumentação no browser para capturar eventos Memed.
 * Deve ser chamado ANTES do script Memed ser carregado.
 */
async function injectInstrumentation(page: Page) {
  await page.addInitScript(() => {
    const report: Array<{ t: number; type: string; detail?: unknown }> = [];
    (window as unknown as Record<string, unknown>).__memedDiagReport = report;
    const t0 = Date.now();

    function emit(type: string, detail?: unknown) {
      const t = Date.now() - t0;
      report.push({ t, type, detail });
      console.log(`[MED-DIAG ${String(Math.floor(t / 1000)).padStart(3, '0')}s] ${type}`,
        detail !== undefined ? JSON.stringify(detail).slice(0, 200) : '');
    }

    // 1. Monitor iframe src changes (MutationObserver no #iframe-container)
    function watchIframes() {
      const container = document.getElementById('iframe-container');
      if (!container) {
        setTimeout(watchIframes, 500);
        return;
      }
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'src') {
            const el = m.target as HTMLIFrameElement;
            emit('IFRAME_SRC_CHANGED', { name: el.name || el.id, src: el.src.slice(0, 80) });
          }
          for (const n of m.addedNodes) {
            if ((n as HTMLElement).tagName === 'IFRAME') {
              emit('IFRAME_ADDED', { src: (n as HTMLIFrameElement).src.slice(0, 80) });
              obs.observe(n as HTMLElement, { attributes: true, attributeFilter: ['src'] });
            }
          }
        }
      });
      obs.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
      emit('IFRAME_WATCHER_READY');

      // Observa iframes já existentes
      container.querySelectorAll('iframe').forEach((iframe) => {
        obs.observe(iframe, { attributes: true, attributeFilter: ['src'] });
        emit('IFRAME_FOUND_EXISTING', { src: iframe.src.slice(0, 80) });
      });
    }
    watchIframes();

    // 2. Intercept MdSinapsePrescricao.setToken
    function patchSinapseSetToken() {
      if ((window as unknown as Record<string, unknown>).MdSinapsePrescricao) {
        const orig = (window as unknown as Record<string, { setToken?: (t: string) => void }>).MdSinapsePrescricao.setToken;
        (window as unknown as Record<string, { setToken?: (t: string) => void }>).MdSinapsePrescricao.setToken = function(token: string) {
          const iframes = document.querySelectorAll('#iframe-container iframe');
          emit('SET_TOKEN_CALLED', {
            tokenPrefix: token.slice(0, 20) + '...',
            iframeCount: iframes.length,
            willReloadIframes: iframes.length > 0,
          });
          if (orig) return orig.call(this, token);
        };
        emit('SINAPSE_SET_TOKEN_PATCHED');
      } else {
        setTimeout(patchSinapseSetToken, 200);
      }
    }
    patchSinapseSetToken();

    // 3. Intercept MdHub.command.send
    function patchMdHubCommand() {
      if ((window as unknown as Record<string, { command?: { send?: (...a: unknown[]) => Promise<unknown> } }>).MdHub?.command?.send) {
        const orig = (window as unknown as Record<string, { command: { send: (...a: unknown[]) => Promise<unknown> } }>).MdHub.command.send;
        (window as unknown as Record<string, { command: { send: (...a: unknown[]) => Promise<unknown> } }>).MdHub.command.send = function(...args: unknown[]) {
          const [mod, cmd, payload] = args as [string, string, unknown];
          const key = `${mod}.${cmd}`;
          emit('CMD_SEND', { cmd: key, payload: typeof payload === 'object' && payload !== null ? Object.keys(payload as object).slice(0, 5) : payload });
          const t = Date.now() - t0;
          const p = orig.apply(this, args);
          if (p && typeof (p as Promise<unknown>).then === 'function') {
            (p as Promise<unknown>)
              .then((r: unknown) => emit('CMD_OK', { cmd: key, ms: Date.now() - t0 - t, response: JSON.stringify(r).slice(0, 100) }))
              .catch((e: unknown) => emit('CMD_ERR', { cmd: key, ms: Date.now() - t0 - t, error: String(e) }));
          }
          return p;
        };
        emit('MDHUB_COMMAND_PATCHED');
      } else {
        setTimeout(patchMdHubCommand, 200);
      }
    }
    patchMdHubCommand();

    // 4. Monitor MdHub events
    function patchMdHubEvents() {
      if ((window as unknown as Record<string, { event?: { add?: (name: string, cb: (...a: unknown[]) => void) => void } }>).MdHub?.event?.add) {
        const origAdd = (window as unknown as Record<string, { event: { add: (name: string, cb: (...a: unknown[]) => void) => void } }>).MdHub.event.add;
        (window as unknown as Record<string, { event: { add: (name: string, cb: (...a: unknown[]) => void) => void } }>).MdHub.event.add = function(name: string, cb: (...a: unknown[]) => void) {
          return origAdd.call(this, name, (...args: unknown[]) => {
            if (['core:moduleInit', 'prescricaoImpressa', 'prescricaoExcluida', 'logout'].includes(name)) {
              emit('EVENT_FIRED', { name, args: JSON.stringify(args).slice(0, 100) });
            }
            return cb(...args);
          });
        };
        emit('MDHUB_EVENT_PATCHED');
      } else {
        setTimeout(patchMdHubEvents, 200);
      }
    }
    patchMdHubEvents();
  });
}

async function login(page: Page): Promise<void> {
  log('LOGIN_START');
  await page.goto(PANEL_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  // O painel pode ter uma tela de login ou redirecionar
  await page.waitForTimeout(2000);

  // Verifica se está na tela de login
  const hasLoginForm = await page.locator('input[type="password"]').count() > 0
    || await page.locator('input[name="password"]').count() > 0
    || await page.locator('[data-testid="login"]').count() > 0;

  if (hasLoginForm) {
    log('LOGIN_FORM_FOUND');
    // Tenta preencher credenciais
    const userInput = page.locator('input[type="text"], input[name="username"], input[name="email"]').first();
    const passInput = page.locator('input[type="password"]').first();
    await userInput.fill(CREDENTIALS.username);
    await passInput.fill(CREDENTIALS.password);
    await passInput.press('Enter');
    await page.waitForTimeout(3000);
  }

  // Injeta token JWT diretamente no localStorage (método alternativo)
  log('INJECT_JWT');
  await page.evaluate((creds) => {
    // Tenta diferentes chaves de armazenamento
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkcl9tYXhfdmluaWNpdXNfMDAxIiwidXNlcm5hbWUiOiJkcm1heC5tYXRvcyIsInJvbGUiOiJhZG1pbiIsIm5hbWUiOiJEciBNYXggTWF0b3MiLCJpYXQiOjE3ODEwNzM0MjksImV4cCI6MTc4MjAzNDIyOX0.placeholder';
    localStorage.setItem('token', token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('jwt', token);
    sessionStorage.setItem('token', token);
    void creds;
  }, CREDENTIALS);

  log('LOGIN_DONE');
}

async function openPatientOverlay(page: Page, patientId: string, patientName: string): Promise<void> {
  log(`OPEN_PATIENT_START`, { patientId, patientName });

  // Navega direto para o painel com o overlay do paciente
  // Tenta via URL param ou via clique no card
  const currentUrl = page.url();
  log('CURRENT_URL', { url: currentUrl.slice(0, 100) });

  // Procura por cards de paciente na interface
  await page.waitForTimeout(1000);

  // Tenta clicar no card do paciente
  const patientCard = page.locator(`[data-atendimento-id="${patientId}"], [data-id="${patientId}"]`).first();
  if (await patientCard.count() > 0) {
    log('PATIENT_CARD_FOUND_BY_DATA_ATTR');
    await patientCard.click();
  } else {
    // Procura pelo nome do paciente
    const nameEl = page.locator(`text="${patientName}"`).first();
    if (await nameEl.count() > 0) {
      log('PATIENT_CARD_FOUND_BY_NAME');
      await nameEl.click();
    } else {
      log('PATIENT_CARD_NOT_FOUND', { patientId, patientName });
      // Screenshot para debug
      await page.screenshot({ path: `memed-diag-no-card-${patientId.slice(0, 8)}.png` });
    }
  }

  await page.waitForTimeout(2000);
}

async function waitForMemedWidget(page: Page, maxMs = 60_000): Promise<boolean> {
  log('WAIT_FOR_MEMED_WIDGET_START');
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    const iframeCount = await page.evaluate(() =>
      document.querySelectorAll('#iframe-container iframe').length
    );
    const hasContainer = await page.locator('#prescricao-memed, [data-dp-memed-engine]').count() > 0;

    if (iframeCount > 0) {
      log('MEMED_IFRAMES_FOUND', { count: iframeCount });
      return true;
    }
    if (hasContainer) {
      log('MEMED_CONTAINER_FOUND_NO_IFRAMES');
    }
    await page.waitForTimeout(1000);
  }

  log('WAIT_FOR_MEMED_WIDGET_TIMEOUT');
  return false;
}

async function captureMemedState(page: Page, label: string) {
  const state = await page.evaluate(() => {
    const iframes = document.querySelectorAll('#iframe-container iframe');
    const container = document.getElementById('prescricao-memed') || document.querySelector('[data-dp-memed-engine]');
    return {
      iframeCount: iframes.length,
      iframeSrcs: Array.from(iframes).map(f => (f as HTMLIFrameElement).src.slice(0, 100)),
      hasMdHub: !!window.MdHub,
      hasSinapse: !!(window as unknown as Record<string, unknown>).MdSinapsePrescricao,
      containerExists: !!container,
      containerChildCount: container?.children.length ?? 0,
      memedDiagLog: ((window as unknown as Record<string, unknown>).__memedDiagnosticLog as unknown[])?.slice(-5) ?? [],
      diagReport: ((window as unknown as Record<string, unknown>).__memedDiagReport as unknown[])?.slice(-20) ?? [],
    };
  });
  log(`STATE_${label.toUpperCase().replace(/\s/g, '_')}`, state);
  return state;
}

async function simulatePrescricaoImpressa(page: Page) {
  log('SIMULATE_PRESCRICAO_IMPRESSA_START');
  await page.evaluate(() => {
    if (window.MdHub?.event?.trigger) {
      window.MdHub.event.trigger('prescricaoImpressa', {
        prescricao: { id: 'fake-receita-123' },
        pdf: 'https://example.com/fake.pdf',
      });
      console.log('[DIAG] prescricaoImpressa triggered manually');
    } else {
      console.warn('[DIAG] MdHub.event.trigger not available');
    }
  });
  await page.waitForTimeout(1000);
  log('SIMULATE_PRESCRICAO_IMPRESSA_DONE');
}

async function runDiagnostic() {
  startTime = Date.now();
  log('DIAGNOSTIC_START');

  const browser = await chromium.launch({
    headless: false, // Visível para observação
    slowMo: 100,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });

  // Captura console do browser
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.text().includes('MED-DIAG') || msg.text().includes('Memed diag') || msg.text().includes('[Memed')) {
      log('BROWSER_CONSOLE', { type: msg.type(), text: msg.text().slice(0, 200) });
    }
  });
  page.on('pageerror', (err) => log('PAGE_ERROR', { message: err.message.slice(0, 200) }));

  await injectInstrumentation(page);

  try {
    // === FASE 1: Login ===
    await login(page);
    await page.screenshot({ path: 'memed-diag-after-login.png' });

    // Recarrega após injetar JWT
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    log('PAGE_RELOADED');
    await page.screenshot({ path: 'memed-diag-after-reload.png' });

    // === FASE 2: Abre paciente 1 ===
    log('=== FASE 2: PACIENTE 1 ===');
    await openPatientOverlay(page, TARGET_PATIENTS[0].id, TARGET_PATIENTS[0].name);
    await page.screenshot({ path: 'memed-diag-patient1-opened.png' });

    // Espera o widget Memed aparecer
    const widgetFound = await waitForMemedWidget(page, 90_000);
    if (!widgetFound) {
      log('WIDGET_NOT_FOUND_PATIENT1');
    }

    await captureMemedState(page, 'before simulate p1');

    // Aguarda 5s após widget aparecer (simula médico revisando)
    await page.waitForTimeout(5000);

    // Captura estado após módulo carregar
    await captureMemedState(page, 'after wait p1');

    // === FASE 3: Simula emissão do paciente 1 ===
    log('=== FASE 3: SIMULA EMISSAO P1 ===');
    await simulatePrescricaoImpressa(page);
    await page.waitForTimeout(2000);
    await captureMemedState(page, 'after prescricaoImpressa p1');

    // === FASE 4: Fecha overlay (simula onComplete) ===
    log('=== FASE 4: FECHA OVERLAY P1 ===');
    // Clica no X para fechar
    const closeBtn = page.locator('[aria-label="Fechar prescrição"], button:has-text("×"), .close-button').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      log('CLOSE_BUTTON_CLICKED');
    } else {
      // Pressiona Escape
      await page.keyboard.press('Escape');
      log('ESCAPE_PRESSED_TO_CLOSE');
    }
    await page.waitForTimeout(2000);

    // === FASE 5: Abre paciente 2 — PONTO CRÍTICO ===
    log('=== FASE 5: PACIENTE 2 (PONTO CRITICO) ===');
    await captureMemedState(page, 'before patient2 open');

    await openPatientOverlay(page, TARGET_PATIENTS[1].id, TARGET_PATIENTS[1].name);
    await page.screenshot({ path: 'memed-diag-patient2-opened.png' });

    // Monitora os primeiros 60s após abrir paciente 2
    log('MONITORING_PATIENT2_60s');
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      await captureMemedState(page, `patient2_t${(i + 1) * 5}s`);
    }

    log('=== FIM DO DIAGNOSTICO ===');

  } catch (e) {
    log('DIAGNOSTIC_ERROR', { error: String(e) });
  } finally {
    // Coleta relatório final do browser
    const browserReport = await page.evaluate(() =>
      (window as unknown as Record<string, unknown>).__memedDiagReport ?? []
    ).catch(() => []);

    const report = {
      events,
      browserDiagReport: browserReport,
      summary: {
        totalEvents: events.length,
        setTokenCalls: events.filter(e => e.type === 'BROWSER_CONSOLE' && String(e.detail).includes('SET_TOKEN')).length,
        iframeReloads: events.filter(e => e.type === 'BROWSER_CONSOLE' && String(e.detail).includes('IFRAME_SRC_CHANGED')).length,
        cmdErrors: events.filter(e => e.type === 'BROWSER_CONSOLE' && String(e.detail).includes('CMD_ERR')).length,
      },
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log('REPORT_SAVED', { path: REPORT_PATH, events: events.length });

    await browser.close();
  }
}

// Executa
runDiagnostic().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
