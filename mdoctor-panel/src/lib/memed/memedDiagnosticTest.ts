/**
 * DIAGNÓSTICO CONTROLADO — NÃO afeta o fluxo médico.
 *
 * O valor de MEMED_DIAG determina qual cenário roda AUTOMATICAMENTE após prescricaoImpressa:
 *   '1' → S1: setPaciente direto, sem hide()
 *   '2' → S2: hide() sem show() + setPaciente
 *   '3' → S3: hide() → show() → aguarda core:moduleInit → setPaciente
 *
 * Configurar UMA VEZ antes do teste (ex. S3):
 *   localStorage.setItem('MEMED_DIAG', '3'); location.reload();
 *
 * Após isso, fazer P1 normalmente pela interface.
 * Quando prescricaoImpressa disparar, o cenário roda sozinho — nenhum comando manual.
 *
 * Desligar após o teste:
 *   localStorage.removeItem('MEMED_DIAG'); location.reload();
 */

const PRESCRIPTION_MODULE = 'plataforma.prescricao';
const SET_PACIENTE_TIMEOUT_MS = 30_000;
const MODULE_HIDE_TIMEOUT_MS = 3_000;
const MODULE_INIT_TIMEOUT_MS = 10_000;
const AUTO_RUN_DELAY_MS = 2_000; // aguarda handlers médicos finalizarem após prescricaoImpressa

type DiagPatient = { nome: string; idExterno: string };

const DEFAULT_PATIENT: DiagPatient = {
  nome: 'DIAG TESTE P2',
  idExterno: `diag_${Date.now()}`,
};

function log(s: number | string, msg: string, data?: Record<string, unknown>): void {
  const prefix = `[DIAG:S${s}]`;
  data ? console.log(prefix, msg, data) : console.log(prefix, msg);
}

function captureVisual(s: number | string): void {
  const el = document.getElementById('prescricao-memed');
  const iframes = el ? Array.from(el.querySelectorAll('iframe')) : [];
  log(s, 'visual:container_display', {
    computed: el ? getComputedStyle(el).display : 'not-found',
    inline: el?.style.display || '(nenhum)',
  });
  log(s, 'visual:iframe_count', { n: iframes.length });
  iframes.forEach((iframe, i) =>
    log(s, `visual:iframe_${i}`, {
      src: iframe.src || '(vazio)',
      display: getComputedStyle(iframe).display,
    }),
  );
}

/**
 * Aguarda core:moduleInit ou core:moduleHide para plataforma.prescricao especificamente.
 * Rejeita se o timeout expirar antes do evento correto.
 */
function waitForModuleEvent(eventName: string, timeoutMs: number): Promise<{ ms: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setTimeout(
      () => reject(new Error(`timeout:${eventName}:${timeoutMs}ms`)),
      timeoutMs,
    );
    const handler = (modulo: Record<string, string>) => {
      const name = modulo?.moduleName ?? modulo?.name ?? '';
      if (name === PRESCRIPTION_MODULE) {
        clearTimeout(timer);
        resolve({ ms: Date.now() - start });
      }
    };
    try {
      window.MdSinapsePrescricao?.event?.add?.(eventName, handler);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

async function callSetPaciente(s: number | string, patient: DiagPatient): Promise<void> {
  const start = Date.now();
  log(s, 'setPaciente:start', { nome: patient.nome, idExterno: patient.idExterno });
  if (!window.MdHub?.command?.send) {
    log(s, 'setPaciente:FAIL ❌', { error: 'MdHub.command.send indisponível' });
    return;
  }
  try {
    await Promise.race([
      window.MdHub.command.send(PRESCRIPTION_MODULE, 'setPaciente', patient) as Promise<void>,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout ${SET_PACIENTE_TIMEOUT_MS}ms`)),
          SET_PACIENTE_TIMEOUT_MS,
        ),
      ),
    ]);
    log(s, 'setPaciente:OK ✅', { ms: Date.now() - start });
  } catch (err) {
    log(s, 'setPaciente:FAIL ❌', {
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── S1: sem hide() ──────────────────────────────────────────────────────────
async function runS1(patient: DiagPatient): Promise<void> {
  log(1, '══ INICIO ══ sem hide(), setPaciente direto');
  captureVisual(1);
  await callSetPaciente(1, patient);
  captureVisual(1);
  log(1, '══ FIM S1 ══');
}

// ─── S2: hide() sem show() ───────────────────────────────────────────────────
async function runS2(patient: DiagPatient): Promise<void> {
  log(2, '══ INICIO ══ hide() sem show()');

  const hidePromise = waitForModuleEvent('core:moduleHide', MODULE_HIDE_TIMEOUT_MS);
  log(2, 'hide:chamado');
  window.MdHub?.module?.hide?.(PRESCRIPTION_MODULE);

  try {
    const r = await hidePromise;
    log(2, 'core:moduleHide:recebido ✅', r);
  } catch {
    log(2, 'core:moduleHide:timeout ⚠️ — não disparou em 3s');
  }

  captureVisual(2);
  await callSetPaciente(2, patient);
  captureVisual(2);
  log(2, '══ FIM S2 ══');
}

// ─── S3: hide() → show() → observar core:moduleInit ─────────────────────────
async function runS3(patient: DiagPatient): Promise<void> {
  log(3, '══ INICIO ══ hide() → show() → observar core:moduleInit');

  // Listener para moduleHide registrado ANTES de hide()
  const hidePromise = waitForModuleEvent('core:moduleHide', MODULE_HIDE_TIMEOUT_MS);
  log(3, 'hide:chamado');
  window.MdHub?.module?.hide?.(PRESCRIPTION_MODULE);

  try {
    const r = await hidePromise;
    log(3, 'core:moduleHide:recebido ✅', r);
  } catch {
    log(3, 'core:moduleHide:timeout ⚠️ — não disparou em 3s');
  }

  captureVisual(3);

  // Listener para moduleInit registrado ANTES de show()
  const initPromise = waitForModuleEvent('core:moduleInit', MODULE_INIT_TIMEOUT_MS);

  log(3, 'show:chamando');
  let showThrew = false;
  try {
    window.MdHub?.module?.show?.(PRESCRIPTION_MODULE);
    log(3, 'show:ok — não lançou');
  } catch (err) {
    showThrew = true;
    log(3, 'show:lançou', { error: err instanceof Error ? err.message : String(err) });
  }

  log(3, 'aguardando core:moduleInit (até 10s)...');
  try {
    const r = await initPromise;
    if (showThrew) {
      log(3, '🔑 PROVA: show() lançou MAS core:moduleInit disparou → try/catch É seguro', r);
    } else {
      log(3, 'core:moduleInit:recebido (show() não lançou)', r);
    }
  } catch {
    if (showThrew) {
      log(3, '🚫 PROVA: show() lançou E core:moduleInit NÃO disparou → try/catch NÃO é seguro');
    } else {
      log(3, 'core:moduleInit:timeout ⚠️ — show() não lançou mas reinit não ocorreu');
    }
  }

  captureVisual(3);
  await callSetPaciente(3, patient);
  captureVisual(3);
  log(3, '══ FIM S3 ══');
}

function runScenario(n: number, patient: DiagPatient): void {
  if (!window.MdHub) {
    console.warn('[DIAG] MdHub não disponível.');
    return;
  }
  switch (n) {
    case 1: void runS1(patient); break;
    case 2: void runS2(patient); break;
    case 3: void runS3(patient); break;
    default: console.warn('[DIAG] Cenário inválido. Use 1, 2 ou 3.');
  }
}

export function mountDiagnostic(): void {
  if (typeof window === 'undefined') return;

  const scenarioStr = localStorage.getItem('MEMED_DIAG') ?? '';
  const scenario = parseInt(scenarioStr, 10);
  if (![1, 2, 3].includes(scenario)) return;

  console.log(
    `%c[DIAG] Auto-diagnóstico S${scenario} ativo`,
    'color:#1557FF;font-weight:bold;font-size:14px',
  );
  console.log(`[DIAG] Faça P1 normalmente. S${scenario} roda automaticamente após prescricaoImpressa.`);

  let diagFired = false;

  // Polling até MdHub estar disponível, depois registra listener para prescricaoImpressa
  const interval = setInterval(() => {
    if (!window.MdHub?.event?.add) return;
    clearInterval(interval);

    window.MdHub.event.add('prescricaoImpressa', () => {
      if (diagFired) return; // apenas P1 — ignora emissões subsequentes
      diagFired = true;
      console.log(
        `[DIAG] prescricaoImpressa detectado → S${scenario} inicia em ${AUTO_RUN_DELAY_MS}ms`,
      );
      setTimeout(() => runScenario(scenario, DEFAULT_PATIENT), AUTO_RUN_DELAY_MS);
    });

    console.log('[DIAG] Aguardando prescricaoImpressa de P1...');

    // Expõe para uso manual opcional (fallback)
    (window as unknown as Record<string, unknown>).__memedDiag = {
      runScenario: (n: number, patient?: DiagPatient) =>
        runScenario(n, patient ?? DEFAULT_PATIENT),
    };
  }, 500);
}
