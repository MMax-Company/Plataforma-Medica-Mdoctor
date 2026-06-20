/**
 * PROVA DA CAUSA RAIZ — executável com Node.js puro (sem browser)
 *
 * Reproduz em memória o que acontece nas chamadas a ensureMemedScript / syncMemedScriptToken
 * ao abrir o segundo paciente, usando o mesmo código lógico que roda no browser.
 *
 * Conclusão esperada: para o paciente 2, setToken() é chamado com iframes presentes,
 * o que causa iframe.src = iframe.src → reinicialização completa do módulo.
 */

// ─── Simulação do ambiente browser ─────────────────────────────────────────

// Simula state da memedSession
const sessionState = {
  scriptId: 'memedScript',
  scriptUrl: null,
  moduleReady: false,
  lastToken: '',
};

// Simula state da memedRuntime
const runtimeState = {
  scriptId: 'memedScript',
  initPromise: null,
  moduleReady: false,
  moduleReadyWaiters: [],
  moduleInitBound: false,
};

// Rastreador de eventos
const events = [];
function record(event, detail) {
  events.push({ event, detail });
  console.log(`  [TRACE] ${event}`, detail ?? '');
}

// ─── Simulação de DOM ───────────────────────────────────────────────────────

// DOM fake: inicialmente vazio, depois com script+iframes
let domHasScript = false;
let iframeCount = 0;
let setTokenCallCount = 0;
let iframeReloadCount = 0;

const fakeDocument = {
  getElementById: (id) => {
    if (id === 'memedScript' && domHasScript) {
      return { setAttribute: (attr, val) => record('script.setAttribute', { attr, val }) };
    }
    return null;
  },
};

// Simula MdSinapsePrescricao (SDK da Memed - conforme sinapse-prescricao.min.js v3.25.0)
const fakeMdSinapsePrescricao = {
  setToken: function(token) {
    setTokenCallCount++;
    const currentIframeCount = iframeCount;
    record('MdSinapsePrescricao.setToken CALLED', {
      tokenPrefix: token.slice(0, 20) + '...',
      iframeCount: currentIframeCount,
      willReloadIframes: currentIframeCount > 0,
    });

    // COMPORTAMENTO REAL DO SDK (linha por linha do sinapse-prescricao.min.js):
    // var e = document.querySelectorAll("#iframe-container iframe");
    // if (0 < e.length) { e.forEach(function(e) { e.src = e.src; }); }
    if (currentIframeCount > 0) {
      iframeReloadCount += currentIframeCount;
      record('⚠️  IFRAME RELOAD TRIGGERED', {
        iframesReloaded: currentIframeCount,
        consequence: 'patient-management reinicializa (12-30s) → setPaciente trava',
      });
    } else {
      record('startModules called (sem iframes — sem dano)');
    }
  },
};

// ─── Implementação fiel de syncMemedScriptToken (memedSession.ts) ───────────

function syncMemedScriptToken(scriptId, token) {
  const script = fakeDocument.getElementById(scriptId);
  if (!script) {
    record('syncMemedScriptToken: script not in DOM, returning early');
    return;
  }
  script.setAttribute('data-token', token);
  fakeMdSinapsePrescricao?.setToken?.(token);
  sessionState.lastToken = token;
}

function getLastMemedToken() {
  return sessionState.lastToken;
}

// ─── Implementação fiel de ensureMemedScript (memedRuntime.ts) ──────────────

function ensureMemedScript(token, config) {
  if (!token) throw new Error('Token ausente');

  if (runtimeState.initPromise) {
    // ← ESTE É O PONTO CRÍTICO: chamado para todo paciente subsequente
    record('ensureMemedScript: warm path → chamando syncMemedScriptToken', { token: token.slice(0, 20) + '...' });
    syncMemedScriptToken(config.scriptId || runtimeState.scriptId, token);
    return runtimeState.initPromise;
  }

  record('ensureMemedScript: cold path → injetando script');
  runtimeState.initPromise = Promise.resolve(); // simula resolução imediata
  return runtimeState.initPromise;
}

// ─── SIMULAÇÃO DO FLUXO REAL ─────────────────────────────────────────────────

const TOKEN_T1 = 'memed-jwt-token-doctor-abcdef123456789';
const SCRIPT_CONFIG = { scriptId: 'memedScript', containerId: 'prescricao-memed' };

async function run() {
  console.log('\n════════════════════════════════════════════');
  console.log('PROVA DA CAUSA RAIZ — MEMED SEQUENTIAL BUG');
  console.log('════════════════════════════════════════════\n');

  // ─── PACIENTE 1 ──────────────────────────────────────────────────────────
  console.log('━━━ PACIENTE 1 (primeiro atendimento) ━━━\n');

  record('refreshDoctorToken(force=true) → T1');
  const freshTokenP1 = TOKEN_T1;

  // useMemedSinapse openPrescription: syncMemedScriptToken antes de ensureMemedScript
  if (freshTokenP1 !== getLastMemedToken() && freshTokenP1 !== '' /* tokenRef.current vazio */) {
    record('openPrescription: freshToken !== lastToken → syncMemedScriptToken chamado');
    syncMemedScriptToken('memedScript', freshTokenP1);
    // Script não está no DOM ainda → retorna sem fazer nada
  }

  await ensureMemedScript(freshTokenP1, SCRIPT_CONFIG);

  // Simula: script e iframes são injetados no DOM pelo SDK da Memed
  record('Memed SDK: script injetado no DOM');
  domHasScript = true;

  record('Memed SDK: iframes carregados após core:moduleInit');
  iframeCount = 4; // plataforma.prescricao, platform.patient-management, etc.

  record('Paciente 1: prepareAndShowPrescription → sucesso');
  record('Paciente 1: prescricaoImpressa disparado');
  record('Paciente 1: overlay fechado');

  console.log('\n  Estado após paciente 1:');
  console.log(`    domHasScript: ${domHasScript}`);
  console.log(`    iframeCount: ${iframeCount}`);
  console.log(`    sessionState.lastToken: "${sessionState.lastToken.slice(0, 30)}..."`);
  console.log(`    setTokenCallCount: ${setTokenCallCount}`);
  console.log(`    iframeReloadCount: ${iframeReloadCount}\n`);

  // ─── PACIENTE 2 ──────────────────────────────────────────────────────────
  console.log('\n━━━ PACIENTE 2 (novo overlay, mesma sessão) ━━━\n');

  record('refreshDoctorToken(force=false) → mesmo T1 do cache');
  const freshTokenP2 = TOKEN_T1; // mesmo token (mesma sessão)

  // tokenRef.current = T1 (setado durante bootstrap do paciente 1)
  const tokenRefCurrent = TOKEN_T1;

  // Condição em openPrescription para chamar syncMemedScriptToken:
  const shouldSyncFromOpenPrescription =
    freshTokenP2 !== getLastMemedToken() && freshTokenP2 !== tokenRefCurrent;

  record('openPrescription: verificando se deve chamar syncMemedScriptToken', {
    freshToken: freshTokenP2.slice(0, 20) + '...',
    lastToken: getLastMemedToken() ? getLastMemedToken().slice(0, 20) + '...' : '(vazio)',
    tokenRefCurrent: tokenRefCurrent.slice(0, 20) + '...',
    shouldSync: shouldSyncFromOpenPrescription,
  });

  if (shouldSyncFromOpenPrescription) {
    syncMemedScriptToken('memedScript', freshTokenP2);
  }

  // ensureMemedScript com initPromise JÁ DEFINIDO (warm path)
  record('ensureMemedScript chamado para paciente 2');
  await ensureMemedScript(freshTokenP2, SCRIPT_CONFIG);

  console.log('\n  Estado após abrir paciente 2:');
  console.log(`    setTokenCallCount total: ${setTokenCallCount}`);
  console.log(`    iframeReloadCount total: ${iframeReloadCount}`);
  console.log(`    sessionState.lastToken: "${sessionState.lastToken.slice(0, 30)}..."\n`);

  // ─── RESULTADO ───────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('RESULTADO DO DIAGNÓSTICO');
  console.log('════════════════════════════════════════════\n');

  const bugConfirmed = iframeReloadCount > 0;

  if (bugConfirmed) {
    console.log('✅ BUG CONFIRMADO:\n');
    console.log('   ensureMemedScript() (warm path) chama syncMemedScriptToken() SEMPRE,');
    console.log('   independente de o token ter mudado ou não.\n');
    console.log('   syncMemedScriptToken() chama MdSinapsePrescricao.setToken().');
    console.log('   setToken() com iframes presentes executa: iframe.src = iframe.src (RELOAD).\n');
    console.log('   Consequência:');
    console.log('   → patient-management reinicializa (12–30s em staging)');
    console.log('   → setPaciente fica na fila atrás do reload');
    console.log('   → timeout de 12s dispara → retry → timeout de 30s dispara → erro\n');
    console.log(`   iframes recarregados: ${iframeReloadCount}`);
    console.log(`   setToken calls: ${setTokenCallCount}\n`);

    console.log('────────────────────────────────────────────');
    console.log('CAUSA RAIZ (memedRuntime.ts, linha 51-53):');
    console.log('────────────────────────────────────────────\n');
    console.log('  if (state.initPromise) {');
    console.log('    syncMemedScriptToken(...)  // ← chamado SEM VERIFICAR SE TOKEN MUDOU');
    console.log('    return state.initPromise;');
    console.log('  }\n');
    console.log('  Por que lastToken estava vazio para o paciente 2?');
    console.log('  → Para o paciente 1, syncMemedScriptToken retornou early');
    console.log('    (script não estava no DOM quando chamado de openPrescription).');
    console.log('  → lastToken nunca foi setado via warm path (cold path não chama sync).\n');

    console.log('────────────────────────────────────────────');
    console.log('FIX CIRÚRGICO (memedRuntime.ts):');
    console.log('────────────────────────────────────────────\n');
    console.log('  ANTES:');
    console.log('  if (state.initPromise) {');
    console.log('    syncMemedScriptToken(config.scriptId || state.scriptId, token);');
    console.log('    return state.initPromise;');
    console.log('  }\n');
    console.log('  DEPOIS (2 mudanças):');
    console.log('  if (state.initPromise) {');
    console.log('    if (token !== getLastMemedToken()) {    // só sync se token mudou');
    console.log('      syncMemedScriptToken(config.scriptId || state.scriptId, token);');
    console.log('    }');
    console.log('    return state.initPromise;');
    console.log('  }');
    console.log('  // E no cold path: rememberMemedToken(token) ANTES de createMemedScript');
    console.log('  // para que lastToken esteja correto quando warm path for atingido.\n');
  } else {
    console.log('❌ Bug NÃO confirmado — hipótese incorreta');
    console.log('   iframeReloadCount:', iframeReloadCount);
    console.log('   setTokenCallCount:', setTokenCallCount);
  }

  console.log('\n════════════════════════════════════════════\n');
}

run().catch(console.error);
