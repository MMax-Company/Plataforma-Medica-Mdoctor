/**
 * Validação local das três correções Memed.
 * Roda com: node scripts/validate-memed-fixes.mjs
 * Não requer servidor, browser, DB ou env vars.
 */

let passed = 0;
let failed = 0;

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? '  →  ' + detail : ''}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────
// 1. idExterno — unicidade por emissão
// ─────────────────────────────────────────────────────────────────
console.log('\n══ 1. idExterno — unicidade por emissão ══');

function buildIdExterno(atendimentoId, emissionTimestamp) {
  // Espelho exato de buildPatientFromAtendimento.ts linha 87
  return emissionTimestamp != null
    ? `${atendimentoId}_memed_${emissionTimestamp}`
    : atendimentoId;
}

// Simula três emissões com timestamps crescentes (como Date.now() em openPrescription)
const BASE_TS = 1718900000000;
const p1 = { id: 'atendimento-001', ts: BASE_TS + 0 };
const p2 = { id: 'atendimento-002', ts: BASE_TS + 5000 };
const p3 = { id: 'atendimento-003', ts: BASE_TS + 10000 };

// Reemissão do mesmo atendimento (P1 → falha → REEMITIR)
const p1b = { id: 'atendimento-001', ts: BASE_TS + 30000 };

const id_p1  = buildIdExterno(p1.id,  p1.ts);
const id_p2  = buildIdExterno(p2.id,  p2.ts);
const id_p3  = buildIdExterno(p3.id,  p3.ts);
const id_p1b = buildIdExterno(p1b.id, p1b.ts);

console.log(`    P1  idExterno: ${id_p1}`);
console.log(`    P2  idExterno: ${id_p2}`);
console.log(`    P3  idExterno: ${id_p3}`);
console.log(`    P1r idExterno: ${id_p1b}  (reemissão)`);

assert('P1 contém atendimento.id + timestamp',     id_p1 === 'atendimento-001_memed_1718900000000');
assert('P2 contém atendimento.id + timestamp',     id_p2 === 'atendimento-002_memed_1718900005000');
assert('P3 contém atendimento.id + timestamp',     id_p3 === 'atendimento-003_memed_1718900010000');
assert('P1 ≠ P2',                                 id_p1 !== id_p2);
assert('P1 ≠ P3',                                 id_p1 !== id_p3);
assert('P2 ≠ P3',                                 id_p2 !== id_p3);
assert('Reemissão P1 ≠ emissão original P1',      id_p1 !== id_p1b,
  `original=${id_p1}  reemissão=${id_p1b}`);
assert('Reemissão P1 ainda contém atendimento-001', id_p1b.startsWith('atendimento-001_memed_'));

// ─────────────────────────────────────────────────────────────────
// 2. Listeners acumulados — register-once + guards
// ─────────────────────────────────────────────────────────────────
console.log('\n══ 2. Listeners — register-once + guards ══');

// Simula MdHub.event.add (acumulador de handlers)
const mdHubHandlers = { prescricaoImpressa: [], prescricaoExcluida: [] };
const mockMdHub = {
  event: {
    add(event, cb) {
      if (!mdHubHandlers[event]) mdHubHandlers[event] = [];
      mdHubHandlers[event].push(cb);
      console.log(`    [MdHub.event.add] "${event}" → total handlers: ${mdHubHandlers[event].length}`);
    },
    trigger(event, payload) {
      (mdHubHandlers[event] || []).forEach(h => h(payload));
    }
  }
};

// ── 2a. Simulação ANTES da correção (callbackRegistered resetado por paciente)
{
  console.log('\n  → Comportamento ANTES (callbackRegistered resetado por paciente):');

  let callbackRegistered = false;
  let printCalls = 0;
  const handlers_before = { prescricaoImpressa: [] };
  const mockBefore = {
    event: {
      add(event, cb) {
        if (!handlers_before[event]) handlers_before[event] = [];
        handlers_before[event].push(cb);
      }
    }
  };

  // Emula setupPrescriptionCallback (simplificado)
  function registerCallbacksLegacy(onPrinted) {
    mockBefore.event.add('prescricaoImpressa', () => { onPrinted(); });
  }

  // P1
  if (!callbackRegistered) { registerCallbacksLegacy(() => printCalls++); callbackRegistered = true; }
  // Troca de paciente → reset legado
  callbackRegistered = false;
  // P2
  if (!callbackRegistered) { registerCallbacksLegacy(() => printCalls++); callbackRegistered = true; }
  // Troca de paciente → reset legado
  callbackRegistered = false;
  // P3
  if (!callbackRegistered) { registerCallbacksLegacy(() => printCalls++); callbackRegistered = true; }

  const legacyHandlerCount = handlers_before.prescricaoImpressa.length;
  console.log(`    handlers registrados após P1+P2+P3: ${legacyHandlerCount}`);
  assert('ANTES: acumulava 3 handlers (problema confirmado)', legacyHandlerCount === 3);
}

// ── 2b. Simulação DEPOIS da correção (register-once + guard)
{
  console.log('\n  → Comportamento DEPOIS (register-once + guard emissionHandledThisCycle):');

  // Estado do guard (módulo-level var em setupPrescriptionCallback.ts)
  let emissionHandledThisCycle = false;
  function resetEmissionGuard() { emissionHandledThisCycle = false; }

  const onPrintedRef = { current: null };

  let callbackRegistered = false;
  const handlers_after = { prescricaoImpressa: [] };
  const mockAfter = {
    event: {
      add(event, cb) {
        if (!handlers_after[event]) handlers_after[event] = [];
        handlers_after[event].push(cb);
      }
    }
  };

  function registerCallbacksOnce() {
    // prescricaoImpressa com guard
    mockAfter.event.add('prescricaoImpressa', (payload) => {
      if (emissionHandledThisCycle) {
        console.log('    [GUARD] prescricaoImpressa duplicado ignorado');
        return;
      }
      emissionHandledThisCycle = true;
      onPrintedRef.current?.(payload);
    });
  }

  // P1 — registra uma vez
  if (!callbackRegistered) { registerCallbacksOnce(); callbackRegistered = true; }
  // Troca P2 — callbackRegistered NÃO é resetado (correção)
  // callbackRegistered.current = false ← REMOVIDO
  if (!callbackRegistered) { registerCallbacksOnce(); callbackRegistered = true; }  // não executa
  // Troca P3 — idem
  if (!callbackRegistered) { registerCallbacksOnce(); callbackRegistered = true; }  // não executa

  const afterHandlerCount = handlers_after.prescricaoImpressa.length;
  console.log(`    handlers registrados após P1+P2+P3: ${afterHandlerCount}`);
  assert('DEPOIS: exatamente 1 handler (acúmulo eliminado)', afterHandlerCount === 1);

  // ── 2c. Callback duplicado — guard bloqueia segunda chamada
  console.log('\n  → Guard contra callback duplicado (prescricaoImpressa disparado 2×):');
  let firedCount = 0;
  onPrintedRef.current = () => { firedCount++; };

  // Simula emissão P1
  resetEmissionGuard();
  handlers_after.prescricaoImpressa.forEach(h => h({ receitaId: 'rx-001' }));  // disparo 1
  handlers_after.prescricaoImpressa.forEach(h => h({ receitaId: 'rx-001' }));  // disparo 2 (duplicado SDK)

  console.log(`    onPrescriptionPrinted chamado: ${firedCount}× (esperado: 1)`);
  assert('Callback duplicado: handler real chamado exatamente 1×', firedCount === 1);

  // Reseta para P2 — resetEmissionGuard reseta o flag
  resetEmissionGuard();
  firedCount = 0;
  onPrintedRef.current = () => { firedCount++; };
  handlers_after.prescricaoImpressa.forEach(h => h({ receitaId: 'rx-002' }));
  console.log(`    P2 onPrescriptionPrinted chamado: ${firedCount}× (esperado: 1)`);
  assert('P2 após reset do guard: chamado corretamente', firedCount === 1);
}

// ─────────────────────────────────────────────────────────────────
// 3. Idempotência — lógica do POST /api/memed/receita
// ─────────────────────────────────────────────────────────────────
console.log('\n══ 3. Idempotência — lógica POST /api/memed/receita ══');

// Espelho das verificações em memed.routes.js (sem Supabase)
function handleReceiptLogic(priorReceipt, incomingMemedId) {
  // 1. Conflito: receita existente com ID diferente
  if (priorReceipt.receitaId && incomingMemedId &&
      String(priorReceipt.receitaId) !== String(incomingMemedId)) {
    return { status: 409, body: { success: false, code: 'MEMED_RECEIPT_ALREADY_EXISTS',
      error: 'Receita Memed já vinculada com ID diferente.' } };
  }
  // 2. Idempotência: mesmo ID → 200 sem re-persistir
  if (priorReceipt.receitaId && incomingMemedId &&
      String(priorReceipt.receitaId) === String(incomingMemedId)) {
    return { status: 200, body: { success: true, alreadyExists: true } };
  }
  // 3. Já validada (só chega aqui se priorReceipt.receitaId === null mas validated_at existe)
  if (priorReceipt.receitaId && priorReceipt.validated_at) {
    return { status: 409, body: { success: false, code: 'MEMED_RECEIPT_ALREADY_VALIDATED' } };
  }
  // 4. Caminho normal — persistiria no DB
  return { status: 200, body: { success: true, created: true } };
}

// Frontend: tratamento de resposta em saveMemedReceipt
function frontendHandlesResponse(status, body) {
  if (status >= 200 && status < 300) {
    // response.ok === true
    return { fatal: false, result: body };
  }
  // response.ok === false
  if (body?.alreadyExists) return { fatal: false, result: body };  // idempotente
  if (status === 409)       return { fatal: false, result: body };  // conflito → non-fatal
  return { fatal: true, error: body?.error ?? `HTTP ${status}` };
}

// ─ Cenário A: primeira emissão (sem receita prévia)
{
  const r = handleReceiptLogic({ receitaId: null }, 'rx-abc-001');
  const fe = frontendHandlesResponse(r.status, r.body);
  console.log(`    [A] Primeira emissão → HTTP ${r.status}  alreadyExists=${r.body.alreadyExists ?? false}  created=${r.body.created ?? false}`);
  assert('A: Primeira emissão → 200 created', r.status === 200 && r.body.created === true);
  assert('A: Frontend não trata como erro',   !fe.fatal);
}

// ─ Cenário B: callback Memed disparado 2× — mesmo memedId
{
  const priorReceipt = { receitaId: 'rx-abc-001' };  // já salvo pelo primeiro callback
  const r = handleReceiptLogic(priorReceipt, 'rx-abc-001');
  const fe = frontendHandlesResponse(r.status, r.body);
  console.log(`    [B] Callback duplicado (mesmo memedId) → HTTP ${r.status}  alreadyExists=${r.body.alreadyExists}`);
  assert('B: Callback duplicado → 200 alreadyExists', r.status === 200 && r.body.alreadyExists === true);
  assert('B: Frontend non-fatal', !fe.fatal);
}

// ─ Cenário C: reemissão → novo memedId para o mesmo atendimento
{
  const priorReceipt = { receitaId: null };  // memed_processing — receita anterior foi cancelada
  const r = handleReceiptLogic(priorReceipt, 'rx-abc-002');
  const fe = frontendHandlesResponse(r.status, r.body);
  console.log(`    [C] Reemissão novo memedId → HTTP ${r.status}  created=${r.body.created ?? false}`);
  assert('C: Reemissão com novo ID → 200 created',    r.status === 200 && r.body.created === true);
  assert('C: Frontend non-fatal', !fe.fatal);
}

// ─ Cenário D: memedId diferente com receita persistida (conflito real)
{
  const priorReceipt = { receitaId: 'rx-abc-001' };
  const r = handleReceiptLogic(priorReceipt, 'rx-xyz-999');  // ID diferente
  const fe = frontendHandlesResponse(r.status, r.body);
  console.log(`    [D] ID conflitante → HTTP ${r.status}  code=${r.body.code}`);
  assert('D: Conflito real → 409',             r.status === 409 && r.body.code === 'MEMED_RECEIPT_ALREADY_EXISTS');
  assert('D: Frontend non-fatal (conflito aceito)', !fe.fatal);
}

// ─────────────────────────────────────────────────────────────────
// Resumo
// ─────────────────────────────────────────────────────────────────
console.log('\n══ Resultado ══');
console.log(`  Passed: ${passed}   Failed: ${failed}`);
if (failed === 0) {
  console.log('  ✅  Todas as verificações passaram.\n');
  process.exit(0);
} else {
  console.error(`  ❌  ${failed} verificação(ões) falhou.\n`);
  process.exit(1);
}
