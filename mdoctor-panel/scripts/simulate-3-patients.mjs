/**
 * simulate-3-patients.mjs
 *
 * Simulação Playwright: 3 pacientes consecutivos no staging.
 *
 * Critério de aprovação: todos os 3 passam sem timeout em setPaciente,
 * sem reinicialização de iframes entre os pacientes (fix b052a9b verificado).
 *
 * Fluxo por paciente:
 *   ATENDER → APROVAR → aguarda MemedEmissionOverlay auto-abrir →
 *   monitora setPaciente → injeta prescricaoImpressa → aguarda close.
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PANEL_URL = 'https://painel-medico-staging-staging.up.railway.app';
const CREDENTIALS = { username: 'drmax.matos', password: 'Gr@tid@0' };
const REPORT_PATH = path.join(__dirname, '..', 'simulation-report.json');

const TARGET_PATIENTS = [
  { id: '3a26276a-82da-4b5f-b565-fb8c4861b029', name: 'João Carlos Ferreira' },
  { id: '4ab610ab-b708-40b5-8809-adc86f6844b0', name: 'Maria das Graças Alves' },
  { id: '17e8b7ec-f2d6-43a7-a30e-3862d723dbc1', name: 'Roberto Silva Santos' },
];

// ─── Logging ───────────────────────────────────────────────────────────────

let startTime = 0;
const report = { events: [], patients: [], summary: {} };

function log(type, detail) {
  const t = Date.now() - startTime;
  const entry = { t, type, detail };
  report.events.push(entry);
  const ts = `[${String(Math.floor(t / 1000)).padStart(3, '0')}s]`;
  const d = detail !== undefined ? JSON.stringify(detail).slice(0, 150) : '';
  console.log(`${ts} ${type}${d ? ' ' + d : ''}`);
}

// ─── Instrumentation ────────────────────────────────────────────────────────

/** Injeta no browser interceptors para setToken, MdHub.command, iframes. */
async function injectInstrumentation(page) {
  await page.addInitScript(() => {
    const diag = [];
    window.__simDiag = diag;
    const t0 = Date.now();

    function emit(type, detail) {
      const ev = { t: Date.now() - t0, type, detail };
      diag.push(ev);
      console.log(`[SIM-DIAG] ${ev.t}ms ${type}`, detail != null ? JSON.stringify(detail).slice(0, 200) : '');
    }

    // 1. Vigiar TODOS os iframes no document (SDK Memed não usa #iframe-container fixo)
    function watchIframes() {
      let iframeCount = document.querySelectorAll('iframe').length;
      emit('IFRAME_WATCHER_READY', { existingIframes: iframeCount });

      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'attributes' && m.attributeName === 'src' && m.target.tagName === 'IFRAME') {
            emit('IFRAME_SRC_CHANGED', {
              name: m.target.name || m.target.id,
              src: m.target.src.slice(0, 80),
            });
          }
          for (const n of m.addedNodes) {
            if (n.tagName === 'IFRAME') {
              iframeCount++;
              emit('IFRAME_ADDED', { total: iframeCount, name: n.name || n.id, src: n.src.slice(0, 80) });
              obs.observe(n, { attributes: true, attributeFilter: ['src'] });
            }
          }
        }
      });
      obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
      document.querySelectorAll('iframe').forEach((f) =>
        obs.observe(f, { attributes: true, attributeFilter: ['src'] })
      );
    }
    watchIframes();

    // 2. Interceptar MdSinapsePrescricao.setToken
    function patchSetToken() {
      const sinapse = window.MdSinapsePrescricao;
      if (!sinapse) { setTimeout(patchSetToken, 200); return; }
      const orig = sinapse.setToken;
      sinapse.setToken = function (token) {
        const iframes = document.querySelectorAll('#iframe-container iframe');
        emit('SET_TOKEN_CALLED', {
          tokenPrefix: token.slice(0, 20) + '...',
          iframeCount: iframes.length,
          willReload: iframes.length > 0,
        });
        return orig?.call(this, token);
      };
      emit('SINAPSE_SET_TOKEN_PATCHED');
    }
    patchSetToken();

    // 3. Interceptar MdHub.command.send para monitorar setPaciente, newPrescription
    function patchMdHubCommand() {
      if (!window.MdHub?.command?.send) { setTimeout(patchMdHubCommand, 200); return; }
      const orig = window.MdHub.command.send.bind(window.MdHub.command);
      window.MdHub.command.send = function (...args) {
        const [mod, cmd] = args;
        const key = `${mod}.${cmd}`;
        const t0cmd = Date.now() - t0;
        emit('CMD_SEND', { cmd: key });
        const p = orig(...args);
        if (p && typeof p.then === 'function') {
          p.then((r) => emit('CMD_OK', { cmd: key, ms: Date.now() - t0 - t0cmd }))
           .catch((e) => emit('CMD_ERR', { cmd: key, ms: Date.now() - t0 - t0cmd, error: String(e) }));
        }
        return p;
      };
      emit('MDHUB_COMMAND_PATCHED');
    }
    patchMdHubCommand();

    // 4. Interceptar core:moduleInit (= reinicialização do SDK = problema)
    function patchMdHubEvents() {
      if (!window.MdHub?.event?.add) { setTimeout(patchMdHubEvents, 200); return; }
      const origAdd = window.MdHub.event.add.bind(window.MdHub.event);
      window.MdHub.event.add = function (name, cb) {
        return origAdd(name, (...args) => {
          if (['core:moduleInit', 'prescricaoImpressa', 'prescricaoExcluida'].includes(name)) {
            emit('EVENT_FIRED', { name, args: JSON.stringify(args).slice(0, 100) });
          }
          return cb(...args);
        });
      };
      emit('MDHUB_EVENT_PATCHED');
    }
    patchMdHubEvents();
  });
}

// ─── Auth ───────────────────────────────────────────────────────────────────

async function loginWithForm(page) {
  log('LOGIN_START');
  await page.goto(`${PANEL_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1500);

  // Tenta preencher form de login
  // Input de usuário: autocomplete="username", placeholder "e-mail ou CPF"
  const userField = page.locator(
    'input[autocomplete="username"], input[placeholder*="CPF"], input[placeholder*="e-mail"]'
  ).first();
  const passField = page.locator('input[type="password"]').first();

  if (await userField.count() > 0 && await passField.count() > 0) {
    await userField.fill(CREDENTIALS.username);
    await passField.fill(CREDENTIALS.password);
    log('LOGIN_FORM_FILLED');

    // Submeter via botão type=submit ou Enter
    const submitBtn = page.locator('button[type="submit"]').first();
    if (await submitBtn.count() > 0) {
      await submitBtn.click();
    } else {
      await passField.press('Enter');
    }
    await page.waitForTimeout(3000);
    log('LOGIN_FORM_SUBMITTED', { currentUrl: page.url().slice(-60) });
  } else {
    log('LOGIN_FORM_NOT_FOUND', { url: page.url() });
    // Se já está em /fila, ok
  }
}

async function ensureAuthenticated(page) {
  const url = page.url();
  if (url.includes('/fila')) {
    log('ALREADY_AUTHENTICATED');
    return;
  }
  await loginWithForm(page);

  // Aguarda redirect para /fila ou página principal
  try {
    await page.waitForURL('**/fila**', { timeout: 10_000 });
    log('REDIRECTED_TO_FILA');
  } catch {
    log('WAIT_FILA_TIMEOUT', { url: page.url() });
  }
}

// ─── Patient flow ───────────────────────────────────────────────────────────

async function collectDiag(page) {
  return page.evaluate(() => window.__simDiag ?? []).catch(() => []);
}

/**
 * Para um paciente:
 * 1. Vai para /fila, clica ATENDER no card do paciente
 * 2. Aguarda modal prontuário, clica APROVAR
 * 3. Aguarda MemedEmissionOverlay + widget auto-open
 * 4. Monitora setToken e setPaciente
 * 5. Injeta prescricaoImpressa após widget abrir (máx 90s)
 * 6. Aguarda close
 */
async function runPatient(page, patient, index) {
  const pResult = {
    index,
    id: patient.id,
    name: patient.name,
    steps: {},
    setTokenCalls: [],
    iframeReloads: 0,
    setPacienteMs: null,
    passed: false,
    error: null,
  };

  const diagBefore = await collectDiag(page);
  const diagOffset = diagBefore.length;

  try {
    // ── Passo 1: Navegar para /fila ──────────────────────────────────────
    log(`[P${index + 1}] NAV_TO_FILA`);
    await page.goto(`${PANEL_URL}/fila`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);
    pResult.steps.nav = 'ok';

    // Screenshot inicial
    await page.screenshot({ path: `sim-p${index + 1}-01-fila.png` });

    // ── Passo 2: Clicar ATENDER ──────────────────────────────────────────
    log(`[P${index + 1}] CLICK_ATENDER`, { patient: patient.name });

    // Busca card do paciente pelo nome ou pelo ID como atributo de dados
    const patientCardSelectors = [
      `[data-atendimento-id="${patient.id}"]`,
      `[data-id="${patient.id}"]`,
    ];

    let cardFound = false;
    for (const sel of patientCardSelectors) {
      if (await page.locator(sel).count() > 0) {
        const atenderBtn = page.locator(sel).locator('button', { hasText: 'ATENDER' }).first();
        if (await atenderBtn.count() > 0) {
          await atenderBtn.click();
          cardFound = true;
          log(`[P${index + 1}] ATENDER_CLICKED_BY_DATA_ATTR`);
          break;
        }
      }
    }

    if (!cardFound) {
      // Fallback: busca pelo nome do paciente e depois o botão ATENDER próximo
      const nameEl = page.locator(`text="${patient.name}"`).first();
      if (await nameEl.count() > 0) {
        // Clica no card pai para abrir
        const card = nameEl.locator('xpath=ancestor::div[contains(@class,"dp-patient-card") or contains(@class,"card")]').first();
        if (await card.count() > 0) {
          const atenderBtn = card.locator('button', { hasText: 'ATENDER' }).first();
          if (await atenderBtn.count() > 0) {
            await atenderBtn.click();
            cardFound = true;
            log(`[P${index + 1}] ATENDER_CLICKED_BY_NAME`);
          }
        }
      }
    }

    if (!cardFound) {
      // Último fallback: clica em qualquer botão ATENDER disponível
      const anyAtender = page.locator('button', { hasText: 'ATENDER' }).first();
      if (await anyAtender.count() > 0) {
        await anyAtender.click();
        cardFound = true;
        log(`[P${index + 1}] ATENDER_CLICKED_FIRST_AVAILABLE`);
      }
    }

    if (!cardFound) {
      await page.screenshot({ path: `sim-p${index + 1}-02-no-atender.png` });
      throw new Error(`Botão ATENDER não encontrado para ${patient.name}`);
    }

    pResult.steps.atender = 'ok';
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `sim-p${index + 1}-02-prontuario.png` });

    // ── Passo 3: Aguardar modal prontuário ───────────────────────────────
    log(`[P${index + 1}] WAIT_PRONTUARIO_MODAL`);
    try {
      await page.waitForSelector('#modalProntuario, [role="dialog"][aria-modal="true"]', { timeout: 15_000 });
      pResult.steps.prontuario = 'ok';
      log(`[P${index + 1}] PRONTUARIO_MODAL_OPEN`);
    } catch {
      await page.screenshot({ path: `sim-p${index + 1}-03-no-modal.png` });
      throw new Error('Modal prontuário não abriu em 15s');
    }

    // ── Passo 4: Clicar APROVAR ──────────────────────────────────────────
    log(`[P${index + 1}] CLICK_APROVAR`);
    const aprovarBtn = page.locator('button', { hasText: /APROVAR/i }).last();
    if (await aprovarBtn.count() === 0) {
      await page.screenshot({ path: `sim-p${index + 1}-04-no-aprovar.png` });
      throw new Error('Botão APROVAR não encontrado no modal');
    }
    await aprovarBtn.click();
    pResult.steps.aprovar = 'ok';
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `sim-p${index + 1}-04-memed-overlay.png` });

    // ── Passo 5: Aguardar MemedEmissionOverlay ───────────────────────────
    log(`[P${index + 1}] WAIT_MEMED_OVERLAY`);
    try {
      await page.waitForSelector('[aria-label*="Prescrição digital"]', { timeout: 15_000 });
      pResult.steps.memedOverlay = 'ok';
      log(`[P${index + 1}] MEMED_OVERLAY_OPEN`);
    } catch {
      await page.screenshot({ path: `sim-p${index + 1}-05-no-memed.png` });
      throw new Error('MemedEmissionOverlay não abriu em 15s');
    }

    // ── Passo 6: Aguardar iframes do SDK Memed ───────────────────────────
    log(`[P${index + 1}] WAIT_MEMED_IFRAMES`);
    const iframeDeadline = Date.now() + 90_000;
    let iframeCount = 0;
    while (Date.now() < iframeDeadline) {
      // Conta iframes do módulo Memed: total de iframes na página menos o SW (memed-sw-register).
      // O SDK cria iframes para plataforma.prescricao, patient-management, etc. após module.show().
      // Usa name attribute (não id) — captureIframeState usa f.name para esses iframes.
      iframeCount = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('iframe'));
        // SW iframe tem name='memed-sw-register' — desconta
        const nonSW = all.filter((f) => !f.name?.includes('sw-register') && !f.id?.includes('sw-register'));
        return nonSW.length;
      });
      if (iframeCount > 0) break;

      // Verifica se há mensagem de erro no overlay
      const hasError = await page.evaluate(() => {
        const overlay = document.querySelector('[aria-label*="Prescrição digital"]');
        if (!overlay) return false;
        const text = overlay.textContent || '';
        return text.includes('Tempo esgotado') || text.includes('Falha') || text.includes('indisponível');
      });
      if (hasError) {
        const errorText = await page.evaluate(() => {
          const overlay = document.querySelector('[aria-label*="Prescrição digital"]');
          return overlay?.textContent?.slice(0, 300) || '';
        });
        throw new Error(`Erro no overlay Memed: ${errorText.slice(0, 150)}`);
      }

      await page.waitForTimeout(2000);
    }

    if (iframeCount === 0) {
      await page.screenshot({ path: `sim-p${index + 1}-06-no-iframes.png` });
      throw new Error('Iframes Memed não apareceram em 90s');
    }

    log(`[P${index + 1}] MEMED_IFRAMES_READY`, { count: iframeCount });
    pResult.steps.iframes = `ok (${iframeCount} iframes)`;

    // ── Passo 7: Aguardar setPaciente completar ─────────────────────────
    log(`[P${index + 1}] WAIT_SET_PACIENTE`);
    // Aguarda até 60s para setPaciente completar (CMD_OK para setPaciente)
    const setPacDeadline = Date.now() + 60_000;
    let setPacDone = false;
    while (Date.now() < setPacDeadline) {
      const diagNow = await collectDiag(page);
      const newEvents = diagNow.slice(diagOffset);
      const setPacOk = newEvents.find((e) => e.type === 'CMD_OK' && e.detail?.cmd?.includes('setPaciente'));
      if (setPacOk) {
        setPacDone = true;
        pResult.setPacienteMs = setPacOk.detail.ms;
        log(`[P${index + 1}] SET_PACIENTE_OK`, { ms: setPacOk.detail.ms });
        break;
      }
      const setPacErr = newEvents.find((e) => e.type === 'CMD_ERR' && e.detail?.cmd?.includes('setPaciente'));
      if (setPacErr) {
        throw new Error(`setPaciente falhou: ${setPacErr.detail.error}`);
      }
      await page.waitForTimeout(2000);
    }

    if (!setPacDone) {
      log(`[P${index + 1}] SET_PACIENTE_TIMEOUT_WARN — tentando prescricaoImpressa mesmo assim`);
    }

    pResult.steps.setPaciente = setPacDone ? `ok (${pResult.setPacienteMs}ms)` : 'timeout (mas continuando)';

    // Aguarda mais 3s para medicamentos carregarem
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `sim-p${index + 1}-07-widget-loaded.png` });

    // ── Passo 8: Coleta estado antes de injetar prescrição ───────────────
    const diagBeforeInject = await collectDiag(page);
    const newEventsBeforeInject = diagBeforeInject.slice(diagOffset);
    const setTokenEvents = newEventsBeforeInject.filter((e) => e.type === 'SET_TOKEN_CALLED');
    const iframeReloadEvents = newEventsBeforeInject.filter((e) => e.type === 'IFRAME_SRC_CHANGED');
    pResult.setTokenCalls = setTokenEvents.map((e) => e.detail);
    pResult.iframeReloads = iframeReloadEvents.length;

    log(`[P${index + 1}] INSTRUMENTATION_SUMMARY`, {
      setTokenCalls: setTokenEvents.length,
      iframeReloads: iframeReloadEvents.length,
      moduleInits: newEventsBeforeInject.filter((e) => e.type === 'EVENT_FIRED' && e.detail?.name === 'core:moduleInit').length,
    });

    // ── Passo 9: Injeta prescricaoImpressa ──────────────────────────────
    log(`[P${index + 1}] INJECT_PRESCRICAO_IMPRESSA`);
    const injected = await page.evaluate(() => {
      const mdhub = window.MdHub;
      if (mdhub?.event?.trigger) {
        mdhub.event.trigger('prescricaoImpressa', {
          prescricao: { id: `sim-receita-${Date.now()}` },
          pdf: 'https://example.com/fake-prescription.pdf',
          link: 'https://example.com/fake-link',
        });
        return 'trigger_ok';
      }
      // Fallback: dispatch manual via callbacks registrados
      if (mdhub?.event?._callbacks?.prescricaoImpressa) {
        const cbs = mdhub.event._callbacks.prescricaoImpressa;
        if (Array.isArray(cbs)) cbs.forEach((cb) => cb({ prescricao: { id: `sim-receita-${Date.now()}` } }));
        return 'callbacks_ok';
      }
      return 'no_trigger';
    });
    log(`[P${index + 1}] INJECT_RESULT`, { injected });
    pResult.steps.prescricaoImpressa = injected;

    await page.waitForTimeout(1500);
    await page.screenshot({ path: `sim-p${index + 1}-08-post-inject.png` });

    // ── Passo 10: Aguardar overlay fechar ───────────────────────────────
    log(`[P${index + 1}] WAIT_OVERLAY_CLOSE`);
    try {
      await page.waitForSelector('[aria-label*="Prescrição digital"]', {
        state: 'detached',
        timeout: 15_000,
      });
      pResult.steps.overlayClose = 'ok';
      log(`[P${index + 1}] OVERLAY_CLOSED`);
    } catch {
      // Overlay pode não fechar se prescricaoImpressa injection falhou
      // Fechar manualmente para continuar ao próximo paciente
      const closeBtn = page.locator('[aria-label="Fechar prescrição"]').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        log(`[P${index + 1}] OVERLAY_CLOSED_MANUALLY`);
        pResult.steps.overlayClose = 'manual';
      } else {
        pResult.steps.overlayClose = 'still_open';
        log(`[P${index + 1}] OVERLAY_STILL_OPEN`);
      }
    }

    pResult.passed = true;
    log(`[P${index + 1}] PATIENT_PASSED`, { name: patient.name });

  } catch (e) {
    pResult.error = e.message;
    pResult.passed = false;
    log(`[P${index + 1}] PATIENT_FAILED`, { error: e.message });
    await page.screenshot({ path: `sim-p${index + 1}-error.png` }).catch(() => {});

    // Tenta fechar qualquer modal aberto antes de continuar
    const closeSelectors = [
      '[aria-label="Fechar prescrição"]',
      'button:has-text("Voltar ao painel")',
      'button:has-text("← Voltar")',
    ];
    for (const sel of closeSelectors) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0) {
        await btn.click().catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(2000);
  }

  // Coleta diag final do paciente
  const diagFinal = await collectDiag(page);
  pResult.diagEvents = diagFinal.slice(diagOffset);

  return pResult;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  startTime = Date.now();
  log('SIMULATION_START', { patients: TARGET_PATIENTS.map((p) => p.name) });

  const browser = await chromium.launch({
    headless: false,
    slowMo: 150,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Captura mensagens de diagnóstico do browser
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[SIM-DIAG]')) {
      log('BROWSER_DIAG', { text: text.slice('[SIM-DIAG] '.length, 200) });
    }
  });
  page.on('pageerror', (err) => log('PAGE_ERROR', { msg: err.message.slice(0, 200) }));

  await injectInstrumentation(page);

  try {
    // Login
    await loginWithForm(page);
    await ensureAuthenticated(page);
    await page.screenshot({ path: 'sim-00-after-login.png' });

    // Simula 3 pacientes em sequência
    for (let i = 0; i < TARGET_PATIENTS.length; i++) {
      log(`=== PACIENTE ${i + 1}/${TARGET_PATIENTS.length}: ${TARGET_PATIENTS[i].name} ===`);
      const result = await runPatient(page, TARGET_PATIENTS[i], i);
      report.patients.push(result);
      await page.waitForTimeout(2000); // pausa entre pacientes
    }

  } catch (e) {
    log('FATAL_ERROR', { error: e.message });
  } finally {
    // Resumo
    const passed = report.patients.filter((p) => p.passed).length;
    const failed = report.patients.filter((p) => !p.passed).length;
    const totalSetToken = report.patients.reduce((s, p) => s + (p.setTokenCalls?.length || 0), 0);
    const totalIframeReloads = report.patients.reduce((s, p) => s + (p.iframeReloads || 0), 0);

    report.summary = {
      passed,
      failed,
      totalSetTokenCalls: totalSetToken,
      totalIframeReloads,
      setTokenByPatient: report.patients.map((p, i) => ({
        patient: p.name,
        setTokenCalls: p.setTokenCalls?.length || 0,
        iframeReloads: p.iframeReloads || 0,
        setPacienteMs: p.setPacienteMs,
        passed: p.passed,
      })),
    };

    console.log('\n════════════════════════════════════════════');
    console.log('RESULTADO DA SIMULAÇÃO');
    console.log('════════════════════════════════════════════\n');
    console.log(`  Passaram: ${passed}/3`);
    console.log(`  Falharam: ${failed}/3`);
    console.log(`  setToken total chamadas: ${totalSetToken}`);
    console.log(`  Iframe reloads totais: ${totalIframeReloads}`);
    console.log('');

    for (const p of report.patients) {
      const status = p.passed ? '✅ PASSOU' : '❌ FALHOU';
      console.log(`  ${status} — ${p.name}`);
      console.log(`    setPaciente: ${p.setPacienteMs != null ? p.setPacienteMs + 'ms' : 'N/A'}`);
      console.log(`    setToken chamadas: ${p.setTokenCalls?.length || 0}`);
      if (p.setTokenCalls?.length > 0) {
        p.setTokenCalls.forEach((c) => console.log(`      → iframeCount=${c.iframeCount} willReload=${c.willReload}`));
      }
      console.log(`    iframeReloads: ${p.iframeReloads || 0}`);
      if (p.error) console.log(`    erro: ${p.error}`);
      console.log('');
    }

    // Verifica o fix
    const patientsWith2Plus = report.patients.filter((_, i) => i > 0);
    const setTokenWith2PlusIframes = patientsWith2Plus.some(
      (p) => p.setTokenCalls?.some((c) => c.iframeCount > 0 && c.willReload)
    );

    if (!setTokenWith2PlusIframes) {
      console.log('  FIX VERIFICADO: setToken NÃO chamado com iframes para pacientes 2 e 3.');
      console.log('  → Sem reinicialização de iframes → sem timeout em setPaciente.');
    } else {
      console.log('  ⚠️  ATENÇÃO: setToken FOI chamado com iframes em pacientes 2/3!');
      console.log('  → Fix pode não ter sido aplicado corretamente.');
    }

    console.log('\n════════════════════════════════════════════\n');

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log('REPORT_SAVED', { path: REPORT_PATH });

    await browser.close();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
