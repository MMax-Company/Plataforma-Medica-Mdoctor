/**
 * FASE 4 — validação local das correções FASE 1/2/3.
 * Roda contra localhost:3099 (next dev com código novo).
 * Captura console logs do browser para verificar os logs obrigatórios.
 *
 * Limitação intrínseca: prescricaoImpressa requer interação manual dentro do
 * iframe Memed (clicar Imprimir/assinar). Este script valida até show() inclusive
 * e captura todos os logs FASE 2 e FASE 3. Os logs FASE 1 requerem emissão real.
 */

import { chromium } from 'playwright';

const LOCAL_URL = 'http://localhost:3099';
const BACKEND_URL = 'https://mdoctor-backend-staging-staging.up.railway.app';
const CREDENTIALS = { username: 'drmax.matos', password: 'Gr@tid@0' };

const REQUIRED_LOGS_PRE_SHOW = [
  '[MEMED_PHASE3] cycle_lock_acquired',
  '[MEMED_PHASE2] waiting_module_ready_before_show',
  '[MEMED_PHASE2] module_ready_before_show',
  '[MEMED_PHASE2] show_allowed',
];

const FORBIDDEN_LOGS = [
  '[MEMED_PHASE3] cycle_already_running',
  '[MEMED_PHASE3] cycle_lock_timeout_release',
  'newPrescription falhou ou timeout — continuando:',
  'moduleReadyBefore: false',
];

let startTime = Date.now();
const allConsoleLogs = [];

function ts() { return `[${String(Math.floor((Date.now() - startTime) / 1000)).padStart(3,'0')}s]`; }
function log(msg, detail) {
  const d = detail ? ' ' + JSON.stringify(detail).slice(0, 200) : '';
  console.log(`${ts()} ${msg}${d}`);
}

async function loginViaApi() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: CREDENTIALS.username, password: CREDENTIALS.password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token || null;
  } catch { return null; }
}

async function fetchFirstWaitingPatient(token) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/atendimentos?scope=medical`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data.data || data.atendimentos || [];
    const p = rows.find(a =>
      (a.status === 'waiting' || a.status === 'triaged') &&
      a.elegibilidade?.eligible !== false &&
      a.dados_clinicos?.medicacao_em_uso
    );
    return p ? { id: p.id, name: p.paciente_nome || `id-${p.id.slice(0,8)}` } : null;
  } catch { return null; }
}

async function runCycle(page, patient, cycleNum) {
  const logsThisCycle = [];
  const capture = (msg) => { logsThisCycle.push(msg); allConsoleLogs.push(`[P${cycleNum}] ${msg}`); };

  // Attach per-cycle console listener
  const listener = (msg) => {
    const text = msg.text();
    if (text.includes('[Memed') || text.includes('[MEMED_PHASE')) capture(text);
  };
  page.on('console', listener);

  log(`=== P${cycleNum} START ===`, { name: patient.name });

  // Navigate to /fila
  await page.goto(`${LOCAL_URL}/fila`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for ATENDER button
  try {
    await page.waitForSelector('button:has-text("ATENDER"), button:has-text("Atender")', { timeout: 30_000 });
  } catch {
    page.off('console', listener);
    return { passed: false, reason: 'Fila não carregou — nenhum botão ATENDER', logs: logsThisCycle };
  }

  // Click ATENDER for this patient (try by data-attribute first, then by name, then first in page)
  let clicked = false;
  for (const sel of [`[data-atendimento-id="${patient.id}"]`, `[data-id="${patient.id}"]`]) {
    const row = page.locator(sel);
    if (await row.count() > 0) {
      const btn = row.locator('button', { hasText: /atender/i }).first();
      if (await btn.count() > 0) { await btn.click(); clicked = true; break; }
    }
  }
  if (!clicked) {
    const nameEl = page.locator(`text="${patient.name}"`).first();
    if (await nameEl.count() > 0) {
      const btn = nameEl.locator('xpath=ancestor::*[self::article or self::div]//button[contains(translate(text(),"ATENDER","atender"),"atender")]').first();
      if (await btn.count() > 0) { await btn.click(); clicked = true; }
    }
  }
  if (!clicked) {
    const btn = page.locator('button', { hasText: /atender/i }).first();
    if (await btn.count() > 0) { await btn.click(); clicked = true; }
  }
  if (!clicked) {
    page.off('console', listener);
    return { passed: false, reason: 'Botão ATENDER não encontrado', logs: logsThisCycle };
  }
  log(`P${cycleNum} ATENDER clicked`);

  // Wait for modal and APROVAR button
  await page.waitForTimeout(1500);
  try {
    await page.waitForSelector('button:has-text("APROVAR")', { timeout: 25_000 });
  } catch {
    page.off('console', listener);
    return { passed: false, reason: 'Botão APROVAR não apareceu', logs: logsThisCycle };
  }
  await page.locator('button:has-text("APROVAR")').last().click();
  log(`P${cycleNum} APROVAR clicked`);

  // Wait for Memed overlay
  try {
    await page.waitForSelector('[aria-label*="Prescrição digital"]', { timeout: 20_000 });
  } catch {
    page.off('console', listener);
    return { passed: false, reason: 'Overlay Memed não abriu', logs: logsThisCycle };
  }
  log(`P${cycleNum} Overlay Memed aberto`);

  // Wait for iframes (show() called)
  try {
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('iframe')).filter(f => !f.name?.includes('sw-register')).length > 0,
      { timeout: 60_000, polling: 1000 }
    );
    log(`P${cycleNum} Iframes Memed presentes`);
  } catch {
    page.off('console', listener);
    return { passed: false, reason: 'Iframes Memed não apareceram em 60s', logs: logsThisCycle };
  }

  // Extra wait to capture all logs after show()
  await page.waitForTimeout(3000);
  page.off('console', listener);

  // Check required logs
  const missing = REQUIRED_LOGS_PRE_SHOW.filter(req => !logsThisCycle.some(l => l.includes(req)));
  const forbidden = FORBIDDEN_LOGS.filter(f => logsThisCycle.some(l => l.includes(f)));

  // Capture [Memed DEBUG] Passo 1 shownBefore / moduleReadyBefore
  const passo1Log = logsThisCycle.find(l => l.includes('[Memed DEBUG] Passo 1'));
  const shownBeforeMatch = passo1Log?.match(/shownBefore:\s*(true|false)/);
  const moduleReadyMatch = passo1Log?.match(/moduleReady:\s*(true|false)/);

  log(`P${cycleNum} RESULT`, {
    missing: missing.length,
    forbidden: forbidden.length,
    shownBefore: shownBeforeMatch?.[1] ?? 'N/A',
    moduleReady: moduleReadyMatch?.[1] ?? 'N/A',
  });

  return {
    passed: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
    shownBefore: shownBeforeMatch?.[1] ?? 'N/A',
    moduleReadyBefore: moduleReadyMatch?.[1] ?? 'N/A',
    passo1Log: passo1Log ?? '(not found)',
    logs: logsThisCycle,
  };
}

async function main() {
  startTime = Date.now();
  log('FASE4 LOCAL VALIDATION START');

  // --- 1. API login ---
  log('API login...');
  const token = await loginViaApi();
  if (!token) { console.error('Login API falhou — encerrando.'); process.exit(1); }
  log('Login OK', { tokenPrefix: token.slice(0, 20) });

  // --- 2. Fetch first waiting patient ---
  const patient = await fetchFirstWaitingPatient(token);
  log('Patient for cycle test', patient ?? 'none — will use seed fallback');
  const targetPatient = patient ?? { id: '82280525-049d-4c8c-be5f-4acb70e15593', name: 'Teste Sim P4 Carvalho' };

  // --- 3. Browser ---
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  page.on('pageerror', e => log('PAGE_ERROR', { msg: e.message.slice(0, 150) }));

  // Inject auth token
  await page.goto(`${LOCAL_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.evaluate((tok) => window.localStorage.setItem('mdoctor_auth_token', tok), token);
  log('Token injected in localStorage');

  // --- 4. Run ONE cycle (P1) to validate FASE 2/3 logs ---
  // (Full P1→P5 emission requires manual interaction — documented below)
  const result = await runCycle(page, targetPatient, 1);

  await browser.close();

  // --- 5. Report ---
  console.log('\n══════════════════════════════════════════');
  console.log('FASE 4 — RESULTADO DA VALIDAÇÃO LOCAL');
  console.log('══════════════════════════════════════════\n');

  console.log('  Logs capturados durante o ciclo P1 (abertura do widget):');
  result.logs.forEach(l => console.log(`    ${l}`));

  console.log('\n  Checklist FASE 2 / FASE 3 (antes da emissão):');
  for (const req of REQUIRED_LOGS_PRE_SHOW) {
    const found = result.logs.some(l => l.includes(req));
    console.log(`  ${found ? '✅' : '❌'} ${req}`);
  }

  console.log('\n  Logs proibidos:');
  for (const f of FORBIDDEN_LOGS) {
    const found = result.logs.some(l => l.includes(f));
    console.log(`  ${found ? '❌ ENCONTRADO' : '✅ ausente'} — "${f}"`);
  }

  console.log(`\n  shownBefore no Passo 1 (P1 deve ser false):  ${result.shownBefore}`);
  console.log(`  moduleReadyBefore no Passo 1 (P1 deve ser true): ${result.moduleReadyBefore}`);

  console.log('\n  Limitação documentada:');
  console.log('  Os logs FASE 1 (waiting_module_ready_after_print, etc.) e a transição');
  console.log('  real P1→P2→P3→P4→P5 requerem emissão manual dentro do iframe Memed.');
  console.log('  O iframe é um serviço externo — Playwright não pode clicar "Imprimir" nele.');
  console.log('  Validação visual dos nomes (Doctor Prescreve vs iframe) também é manual.\n');

  if (result.passed) {
    console.log('  ✅ FASE 2/3 validadas — show() chamado com readiness real e lock adquirido.');
  } else {
    console.log('  ❌ Falhas encontradas:');
    if (result.missing?.length) console.log('    Missing:', result.missing);
    if (result.forbidden?.length) console.log('    Forbidden found:', result.forbidden);
    if (result.reason) console.log('    Reason:', result.reason);
  }

  console.log('\n══════════════════════════════════════════\n');
  process.exit(result.passed ? 0 : 1);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
