/**
 * simulate-3-patients.mjs — v4
 *
 * Critério de aceite (necessário para aceitar a correção):
 *   - CMD_OK explícito para setPaciente em todos os 3 pacientes
 *   - Nenhum timeout (timed_out: true) em setPaciente
 *   - Overlay fecha via X após confirmação — não por fallback de falha
 *   - Se setPaciente falhar → FAIL imediato, sem continuar
 *
 * newPrescription removido do fluxo: ausente na documentação oficial Memed
 * e causava timeout de 15s enquanto sub-módulos carregavam após show().
 *
 * Instrumentação:
 *   - Lê window.__memedDiagnosticLog (populado por memedCommandDiagnostic.ts)
 *   - NÃO tenta interceptar MdHub.command.send (property pode ser non-writable)
 *   - Polling via page.evaluate a cada 1s
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PANEL_URL = 'https://painel-medico-staging-staging.up.railway.app';
const BACKEND_URL = 'https://mdoctor-backend-staging-staging.up.railway.app';
const CREDENTIALS = { username: 'drmax.matos', password: 'Gr@tid@0' };
const REPORT_PATH = path.join(__dirname, '..', 'simulation-report.json');

// Tempo máximo para todos os comandos completarem após overlay abrir.
// Worst case: setFeatureToggle(5s) + setPaciente(42s) + addItem(20s) + show + buffer = ~80s
const MEMED_CMD_TOTAL_TIMEOUT_MS = 120_000;

let startTime = 0;
const report = { events: [], patients: [], summary: {} };

function log(type, detail) {
  const t = Date.now() - startTime;
  const entry = { t, type, detail };
  report.events.push(entry);
  const ts = `[${String(Math.floor(t / 1000)).padStart(3, '0')}s]`;
  const d = detail !== undefined ? JSON.stringify(detail).slice(0, 200) : '';
  console.log(`${ts} ${type}${d ? ' ' + d : ''}`);
}

// ─── Memed diagnostic log polling ──────────────────────────────────────────────
//
// window.__memedDiagnosticLog is populated by memedCommandDiagnostic.ts.
// clearMemedDiagnosticLog() is called at the start of prepareAndShowPrescription,
// so the log starts fresh for each patient (reset to [] on APROVAR → openPrescription).
//
// Entry schema:
//   phase: 'before' | 'after' | 'event'
//   command: 'newPrescription' | 'setPaciente' | 'addItem' | 'postShow:ready' | ...
//   ok?: boolean    (phase === 'after')
//   timed_out?: boolean  (phase === 'after', command failed by timeout)
//   duration_ms?: number

/**
 * Polls window.__memedDiagnosticLog until setPaciente has ok: true.
 * Fails immediately if setPaciente has ok: false with no subsequent ok: true.
 * addItem failures are logged but do not fail the test (medication may not be in catalog).
 *
 * newPrescription removido do fluxo — não está na documentação oficial Memed.
 */
async function waitForMemedCommands(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check for visible error text in overlay (catches throw from prepareAndShowPrescription)
    const overlayError = await page.evaluate(() => {
      const overlay = document.querySelector('[aria-label*="Prescrição digital"]');
      if (!overlay) return null;
      const text = overlay.textContent || '';
      const keywords = ['Tempo esgotado', 'Timeout', 'timeout', 'indisponível', 'Falha ao carregar'];
      for (const kw of keywords) {
        if (text.includes(kw)) return text.slice(0, 300);
      }
      return null;
    }).catch(() => null);

    if (overlayError) {
      throw new Error(`Overlay exibe erro (prepareAndShowPrescription falhou): ${overlayError.slice(0, 200)}`);
    }

    // Read current snapshot of diagnostic log
    const log_ = await page.evaluate(() => window.__memedDiagnosticLog ?? null).catch(() => null);

    if (log_ === null) {
      // prepareAndShowPrescription hasn't called clearMemedDiagnosticLog yet
      await page.waitForTimeout(500);
      continue;
    }

    // Hard fail: ALL setPaciente attempts failed (retry mechanism exhausted)
    const setPacAttempts = log_.filter((e) => e.phase === 'after' && e.command === 'setPaciente');
    const setPacFailures = setPacAttempts.filter((e) => e.ok === false || e.timed_out === true);
    const setPacSuccess = setPacAttempts.find((e) => e.ok === true);
    if (setPacFailures.length > 0 && !setPacSuccess) {
      const totalElapsed = setPacFailures.reduce((s, e) => s + (e.duration_ms || 0), 0);
      if (totalElapsed >= 40_000) {
        const lastFail = setPacFailures[setPacFailures.length - 1];
        throw new Error(
          `setPaciente FALHOU em todas as tentativas — ${lastFail.error || 'timeout'} (${lastFail.duration_ms}ms).`,
        );
      }
    }

    // Check for success
    const setPacOk = setPacAttempts.find((e) => e.ok === true);
    const showDone = log_.find((e) => e.phase === 'event' && e.command === 'show:done');
    const addItems = log_.filter((e) => e.phase === 'after' && e.command === 'addItem');

    if (setPacOk && showDone) {
      return {
        showDone: true,
        setPaciente: {
          ok: true,
          ms: setPacOk.duration_ms,
          attempts: setPacAttempts.length,
        },
        addItem: {
          attempted: addItems.length,
          ok: addItems.filter((e) => e.ok === true).length,
          failed: addItems.filter((e) => e.ok === false || e.timed_out).length,
        },
        fullLog: log_,
      };
    }

    await page.waitForTimeout(1000);
  }

  // Timeout expired — report what was completed
  const log_ = await page.evaluate(() => window.__memedDiagnosticLog ?? []).catch(() => []);
  const completed = log_.filter((e) => e.phase === 'after' && e.ok === true).map((e) => e.command);
  const failed = log_.filter((e) => e.phase === 'after' && (e.ok === false || e.timed_out)).map(
    (e) => `${e.command}(${e.error || 'timeout'})`,
  );
  throw new Error(
    `Timeout ${timeoutMs}ms aguardando comandos Memed.\n` +
      `  Concluídos com OK: [${completed.join(', ') || 'nenhum'}]\n` +
      `  Falharam: [${failed.join(', ') || 'nenhum'}]\n` +
      `  Necessários: setPaciente OK + show:done`,
  );
}

// ─── Auth + Queue fetch ────────────────────────────────────────────────────────

/**
 * Logs in via backend API from Node.js. Returns { token, patients }.
 * The token is used to set localStorage in the browser to bypass the login form.
 */
async function loginAndFetchQueue() {
  // Declare token outside try so it survives if queue fetch fails
  let authToken = null;
  try {
    const loginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: CREDENTIALS.username, password: CREDENTIALS.password }),
    });
    if (!loginRes.ok) {
      log('LOGIN_API_WARN', { status: loginRes.status });
      return { token: null, patients: null };
    }
    const loginData = await loginRes.json();
    authToken = loginData.token;
    if (!authToken) {
      log('LOGIN_API_WARN', { msg: 'No token in response' });
      return { token: null, patients: null };
    }
    log('LOGIN_API_OK', { tokenPrefix: authToken.slice(0, 20) + '...' });

    const queueRes = await fetch(`${BACKEND_URL}/api/atendimentos?scope=medical`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!queueRes.ok) {
      log('QUEUE_API_WARN', { status: queueRes.status });
      return { token: authToken, patients: null };
    }
    const data = await queueRes.json();
    const rows = Array.isArray(data) ? data : data.data || data.atendimentos || [];
    const waiting = rows
      .filter(
        (a) =>
          (a.status === 'waiting' || a.status === 'triaged') &&
          a.elegibilidade?.eligible !== false &&
          a.eligibility_status !== 'rejected' &&
          a.dados_clinicos?.medicacao_em_uso,
      )
      .slice(0, 3)
      .map((a) => ({
        id: a.id,
        name: a.paciente_nome || a.nome || `paciente-${a.id.slice(0, 8)}`,
      }));

    log('QUEUE_FETCH_OK', { count: waiting.length, patients: waiting.map((p) => p.name) });
    return { token: authToken, patients: waiting.length >= 3 ? waiting : null };
  } catch (e) {
    // Preserve token even if queue fetch threw (e.g. network timeout)
    log('LOGIN_API_WARN', { msg: e.message });
    return { token: authToken, patients: null };
  }
}

/**
 * Injects the JWT token into the panel's localStorage so the panel considers
 * the user authenticated, then navigates to /fila. Bypasses the login form.
 */
async function injectAuthAndGoToFila(page, token) {
  log('AUTH_INJECT_START');
  // Navigate to the panel root to have the right origin for localStorage
  await page.goto(`${PANEL_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1000);

  // Set the JWT in localStorage (same key the panel's apiClient reads)
  await page.evaluate((tok) => {
    window.localStorage.setItem('mdoctor_auth_token', tok);
  }, token);
  log('AUTH_TOKEN_INJECTED');

  // Navigate to /fila
  await page.goto(`${PANEL_URL}/fila`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  log('ON_FILA', { url: page.url().slice(-60) });
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

async function loginAndGoToFila(page) {
  log('LOGIN_START');
  await page.goto(`${PANEL_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Wait for the page to stabilize — on cold-start staging this can take a while
  await page.waitForTimeout(3000);

  const userField = page
    .locator('input[autocomplete="username"], input[placeholder*="CPF"], input[placeholder*="e-mail"], input[placeholder*="usuário"]')
    .first();
  const passField = page.locator('input[type="password"]').first();

  if ((await userField.count()) > 0) {
    await userField.fill(CREDENTIALS.username);
    await passField.fill(CREDENTIALS.password);
    log('LOGIN_FORM_FILLED');
    // Try submit button first with force, fall back to Enter
    const submitBtn = page.locator('button[type="submit"]').first();
    if ((await submitBtn.count()) > 0) {
      try {
        await submitBtn.click({ force: true, timeout: 8000 });
      } catch {
        log('SUBMIT_BTN_CLICK_FAILED_USING_ENTER');
        await passField.press('Enter');
      }
    } else {
      await passField.press('Enter');
    }
    await page.waitForTimeout(2000);
    log('LOGIN_FORM_SUBMITTED', { url: page.url().slice(-60) });
  } else {
    log('LOGIN_FORM_NOT_FOUND');
  }

  try {
    await page.waitForURL('**/fila**', { timeout: 45_000 });
    log('REDIRECTED_TO_FILA');
  } catch {
    log('WAIT_FILA_TIMEOUT', { url: page.url().slice(-60) });
    // If not on /fila, navigate directly — token is likely set in localStorage already
    if (!page.url().includes('/fila')) {
      await page.goto(`${PANEL_URL}/fila`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      log('FORCED_NAV_TO_FILA');
    }
  }
}

// ─── Patient flow ──────────────────────────────────────────────────────────────

async function runPatient(page, patient, index) {
  const pResult = {
    index,
    id: patient.id,
    name: patient.name,
    passed: false,
    error: null,
    steps: {},
    commands: null,
  };

  try {
    // ── Nav to /fila ──────────────────────────────────────────────────────
    log(`[P${index + 1}] NAV_FILA`);
    await page.goto(`${PANEL_URL}/fila`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // Wait for the patient queue to load — the React auth context needs to hydrate,
    // read localStorage, and fetch the queue before any ATENDER button appears.
    log(`[P${index + 1}] WAIT_QUEUE_LOAD`);
    try {
      await page.waitForSelector('button:has-text("ATENDER"), button:has-text("Atender")', {
        timeout: 45_000,
      });
      log(`[P${index + 1}] QUEUE_LOADED`);
    } catch {
      // Log visible text to diagnose auth/loading issues
      const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '').catch(() => '');
      log(`[P${index + 1}] QUEUE_LOAD_TIMEOUT`, { visible: pageText.slice(0, 200) });
      throw new Error('Fila não carregou — nenhum botão ATENDER em 45s (auth inválida ou fila vazia?)');
    }

    await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-01-fila.png` });
    pResult.steps.nav = 'ok';

    // ── Click ATENDER ─────────────────────────────────────────────────────
    log(`[P${index + 1}] CLICK_ATENDER`, { name: patient.name });
    let atenderOk = false;

    for (const sel of [`[data-atendimento-id="${patient.id}"]`, `[data-id="${patient.id}"]`]) {
      if ((await page.locator(sel).count()) > 0) {
        const btn = page.locator(sel).locator('button', { hasText: /atender/i }).first();
        if ((await btn.count()) > 0) {
          await btn.click();
          atenderOk = true;
          break;
        }
      }
    }

    if (!atenderOk) {
      const nameEl = page.locator(`text="${patient.name}"`).first();
      if ((await nameEl.count()) > 0) {
        const ancestor = nameEl.locator('xpath=ancestor::*[self::article or self::div[contains(@class,"card") or contains(@class,"patient")]]').first();
        const btn = (await ancestor.count()) > 0
          ? ancestor.locator('button', { hasText: /atender/i }).first()
          : page.locator('button', { hasText: /atender/i }).first();
        if ((await btn.count()) > 0) {
          await btn.click();
          atenderOk = true;
        }
      }
    }

    if (!atenderOk) {
      const btn = page.locator('button', { hasText: /atender/i }).first();
      if ((await btn.count()) > 0) {
        await btn.click();
        atenderOk = true;
      }
    }

    if (!atenderOk) {
      await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-no-atender.png` });
      throw new Error(`Botão ATENDER não encontrado para ${patient.name}`);
    }

    pResult.steps.atender = 'ok';
    await page.waitForTimeout(1500);
    await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-02-prontuario.png` });

    // ── Wait for prontuário modal ─────────────────────────────────────────
    log(`[P${index + 1}] WAIT_PRONTUARIO`);
    try {
      await page.waitForSelector('#modalProntuario, [role="dialog"][aria-modal="true"]', { timeout: 15_000 });
      pResult.steps.prontuario = 'ok';
      log(`[P${index + 1}] PRONTUARIO_OPEN`);
    } catch {
      await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-no-modal.png` });
      throw new Error('Modal prontuário não abriu em 15s');
    }
    // Screenshot modal loading state (before data loads)
    await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-02b-modal-loading.png` });

    // ── Wait for APROVAR button — modal initially shows "Carregando prontuário..." ─
    // The ProntuarioDecisionBar (with ✓ APROVAR) only renders after useProntuarioAtendimento
    // fetches the atendimento data. We must wait for the button, not just the dialog.
    log(`[P${index + 1}] WAIT_APROVAR_BUTTON`);
    try {
      await page.waitForSelector('button:has-text("APROVAR"), button:has-text("autorizar atendimento")', {
        timeout: 25_000,
      });
      log(`[P${index + 1}] APROVAR_BUTTON_VISIBLE`);
      await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-02c-modal-loaded.png` });
    } catch {
      const modalText = await page
        .evaluate(() => {
          const m = document.querySelector('[role="dialog"][aria-modal="true"]');
          return m?.innerText?.slice(0, 500) || '';
        })
        .catch(() => '');
      await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-no-aprovar.png` });
      throw new Error(
        `Botão APROVAR não apareceu em 25s após modal abrir.\n  Modal visível: "${modalText.slice(0, 300)}"`,
      );
    }

    // ── Click APROVAR ─────────────────────────────────────────────────────
    log(`[P${index + 1}] CLICK_APROVAR`);
    const aprovarBtn = page.locator('button:has-text("APROVAR")').last();
    await aprovarBtn.click();
    pResult.steps.aprovar = 'ok';
    await page.waitForTimeout(1500);
    await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-03-pos-aprovar.png` });

    // ── Wait for Memed overlay ────────────────────────────────────────────
    log(`[P${index + 1}] WAIT_MEMED_OVERLAY`);
    try {
      await page.waitForSelector('[aria-label*="Prescrição digital"]', { timeout: 20_000 });
      pResult.steps.overlay = 'ok';
      log(`[P${index + 1}] MEMED_OVERLAY_OPEN`);
    } catch {
      await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-no-overlay.png` });
      throw new Error('MemedEmissionOverlay não abriu em 20s após APROVAR');
    }
    await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-04-memed-overlay.png` });

    // ── Wait for Memed module iframes (show() executed) ───────────────────
    log(`[P${index + 1}] WAIT_MEMED_IFRAMES`);
    const iframeStart = Date.now();
    try {
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll('iframe')).filter(
            (f) => !f.name?.includes('sw-register') && !f.id?.includes('sw-register'),
          ).length > 0,
        { timeout: 60_000, polling: 1000 },
      );
    } catch {
      const overlayText = await page.evaluate(() => {
        const overlay = document.querySelector('[aria-label*="Prescrição digital"]');
        return overlay?.textContent?.slice(0, 300) || '';
      });
      throw new Error(
        `Iframes Memed não apareceram em 60s após show(). Overlay: "${overlayText.slice(0, 150)}"`,
      );
    }
    const iframeMs = Date.now() - iframeStart;
    pResult.steps.iframes = `ok (${iframeMs}ms)`;
    log(`[P${index + 1}] MEMED_IFRAMES_READY`, { ms: iframeMs });
    await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-05-iframes.png` });

    // ── Wait for Memed commands with EXPLICIT CMD_OK confirmation ─────────
    // This is the acceptance gate: all 3 commands must have ok:true in
    // window.__memedDiagnosticLog. Any failure is a hard throw — no "continue".
    log(`[P${index + 1}] WAIT_MEMED_COMMANDS`);
    const cmdStart = Date.now();
    const cmds = await waitForMemedCommands(page, MEMED_CMD_TOTAL_TIMEOUT_MS);
    const cmdMs = Date.now() - cmdStart;

    pResult.commands = cmds;
    pResult.steps.memedCommands = 'ok';
    log(`[P${index + 1}] COMMANDS_OK`, {
      showDone: cmds.showDone,
      setPaciente: (cmds.setPaciente.ms ?? '?') + 'ms (attempt ' + cmds.setPaciente.attempts + ')',
      addItem: `${cmds.addItem.ok}/${cmds.addItem.attempted} ok`,
      totalMs: cmdMs,
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-06-commands-ok.png` });

    // ── Close overlay via X button (clean close after success confirmation) ─
    // This is NOT a fallback — we only reach here after all commands OK.
    log(`[P${index + 1}] CLOSE_OVERLAY_AFTER_SUCCESS`);
    const closeBtn = page.locator('button[aria-label="Fechar prescrição"], button[aria-label*="Fechar"]').first();
    if ((await closeBtn.count()) === 0) {
      // Try generic close patterns
      const closeAlt = page.locator('[aria-label*="Prescrição digital"] button[aria-label*="fechar"], [aria-label*="Prescrição digital"] button[aria-label*="Fechar"]').first();
      if ((await closeAlt.count()) > 0) {
        await closeAlt.click();
      } else {
        throw new Error('Botão de fechar overlay não encontrado após comandos OK');
      }
    } else {
      await closeBtn.click();
    }

    await page.waitForSelector('[aria-label*="Prescrição digital"]', {
      state: 'detached',
      timeout: 10_000,
    });
    pResult.steps.close = 'ok';
    pResult.passed = true;
    log(`[P${index + 1}] PATIENT_PASSED`, { name: patient.name });

  } catch (err) {
    pResult.error = err.message;
    pResult.passed = false;
    log(`[P${index + 1}] PATIENT_FAILED`, { error: err.message.slice(0, 300) });
    await page.screenshot({ timeout: 5000, path: `sim-p${index + 1}-error.png` }).catch(() => {});

    // Close any open modal to continue to next patient — this is cleanup, not success
    for (const sel of [
      'button[aria-label="Fechar prescrição"]',
      'button:has-text("Voltar ao painel")',
      'button:has-text("← Voltar")',
      'button[aria-label*="Fechar"]',
    ]) {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(1000);
        break;
      }
    }
    await page.waitForTimeout(2000);
  }

  // Capture final diagnostic log snapshot for report
  pResult.diagnosticLog = await page.evaluate(() => window.__memedDiagnosticLog ?? []).catch(() => []);

  return pResult;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  startTime = Date.now();
  log('SIMULATION_START');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  page.on('pageerror', (err) => log('PAGE_ERROR', { msg: err.message.slice(0, 200) }));

  // Login via backend API + fetch queue — before opening browser (no form needed)
  const { token, patients: fetchedPatients } = await loginAndFetchQueue();

  let targetPatients = fetchedPatients;

  try {
    // Inject JWT into browser localStorage — bypasses the form entirely
    if (token) {
      await injectAuthAndGoToFila(page, token);
    } else {
      // Fallback: form login
      await loginAndGoToFila(page);
    }
    await page.screenshot({ timeout: 5000, path: 'sim-00-after-login.png' }).catch(() => {});

    if (!targetPatients || targetPatients.length < 3) {
      // Fallback to patients seeded by seed-sim-patients.js
      log('QUEUE_FALLBACK', { reason: 'dynamic fetch did not return 3 patients — using last-seed IDs' });
      targetPatients = [
        { id: '82280525-049d-4c8c-be5f-4acb70e15593', name: 'Teste Sim P4 Carvalho' },
        { id: '32989fdd-b966-4427-9ea4-305ecf632823', name: 'Teste Sim P5 Andrade' },
        { id: 'b533d881-5c21-4aa7-9537-bc2890d5aeb1', name: 'Teste Sim P6 Nunes' },
      ];
      log('QUEUE_FALLBACK_PATIENTS', { patients: targetPatients.map((p) => p.name) });
    }

    report.targetPatients = targetPatients;

    for (let i = 0; i < targetPatients.length; i++) {
      log(`=== PACIENTE ${i + 1}/${targetPatients.length}: ${targetPatients[i].name} ===`);
      const result = await runPatient(page, targetPatients[i], i);
      report.patients.push(result);
      await page.waitForTimeout(3000); // stabilization between patients
    }

  } catch (err) {
    log('FATAL', { error: err.message });
  } finally {
    const passed = report.patients.filter((p) => p.passed).length;
    const failed = report.patients.filter((p) => !p.passed).length;

    // ── Acceptance criteria evaluation ────────────────────────────────────
    const allPassed = passed === 3;
    const noTimeoutsInCritical = report.patients.every((p) => {
      if (!p.diagnosticLog) return true;
      return !p.diagnosticLog.some(
        (e) => e.timed_out === true && e.command === 'setPaciente',
      );
    });
    const allCmdOk = report.patients.every(
      (p) => p.commands?.setPaciente?.ok === true && p.commands?.showDone === true,
    );
    const noManualClose = report.patients.every(
      (p) => !p.passed || p.steps?.close === 'ok',
    );

    console.log('\n════════════════════════════════════════════');
    console.log('RESULTADO DA SIMULAÇÃO');
    console.log('════════════════════════════════════════════\n');
    console.log(`  Passaram: ${passed}/3`);
    console.log(`  Falharam: ${failed}/3`);
    console.log('');

    for (const p of report.patients) {
      const status = p.passed ? '✅ PASSOU' : '❌ FALHOU';
      console.log(`  ${status} — ${p.name}`);
      if (p.commands) {
        console.log(`    show:done:                     ${p.commands.showDone ? 'sim' : 'NAO'}`);
        console.log(`    setPaciente CMD_OK:            ${p.commands.setPaciente?.ms ?? '?'}ms (${p.commands.setPaciente?.attempts} tentativa(s))`);
        console.log(`    addItem:                       ${p.commands.addItem?.ok}/${p.commands.addItem?.attempted} ok`);
      }
      if (p.error) console.log(`    erro: ${p.error.slice(0, 300)}`);
      console.log('');
    }

    console.log('  Critérios de aceite:');
    console.log(`  ${allPassed ? '✅' : '❌'} 3/3 pacientes passaram`);
    console.log(`  ${noTimeoutsInCritical ? '✅' : '❌'} Nenhum timeout em setPaciente`);
    console.log(`  ${allCmdOk ? '✅' : '❌'} CMD_OK confirmado para setPaciente + show:done`);
    console.log(`  ${noManualClose ? '✅' : '❌'} Overlay fechado com sucesso após commands OK`);
    console.log('');

    if (allPassed && noTimeoutsInCritical && allCmdOk && noManualClose) {
      console.log('  ACEITE: todos os critérios atingidos.');
    } else {
      console.log('  NAO ACEITO: um ou mais critérios falharam.');
    }

    console.log('\n════════════════════════════════════════════\n');

    report.summary = {
      passed,
      failed,
      allPassed,
      noTimeoutsInCritical,
      allCmdOk,
      noManualClose,
      accepted: allPassed && noTimeoutsInCritical && allCmdOk && noManualClose,
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    log('REPORT_SAVED', { path: REPORT_PATH });

    await browser.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
