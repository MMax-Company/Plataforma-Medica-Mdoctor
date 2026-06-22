/**
 * DIAGNÓSTICO CONTROLADO — NÃO afeta o fluxo médico.
 * Só ativo quando localStorage.getItem('MEMED_DIAG') === '1'.
 *
 * Habilitar: localStorage.setItem('MEMED_DIAG', '1'); location.reload();
 * Desabilitar: localStorage.removeItem('MEMED_DIAG'); location.reload();
 *
 * Após P1 emitir prescricaoImpressa, no console:
 *   window.__memedDiag.runScenario(1)   // S1: sem hide()
 *   window.__memedDiag.runScenario(2)   // S2: hide() sem show()
 *   window.__memedDiag.runScenario(3)   // S3: hide() → show() → observar core:moduleInit
 *
 *   // Com paciente real (idExterno do próximo paciente da fila):
 *   window.__memedDiag.runScenario(1, { nome: 'NOME', idExterno: 'uuid_memed_xxx' })
 */

const PRESCRIPTION_MODULE = 'plataforma.prescricao';
const SET_PACIENTE_TIMEOUT_MS = 30_000;
const EVENT_TIMEOUT_MS = 10_000;
const MODULE_HIDE_TIMEOUT_MS = 3_000;

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
 * Aguarda core:moduleInit ou core:moduleHide especificamente para plataforma.prescricao.
 * Rejeita se o timeout expirar sem receber o evento do módulo correto.
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

  // Registra listener para moduleHide antes de chamar hide()
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

  // Registra listener para moduleInit ANTES de chamar show()
  // (core:moduleInit dispara de forma assíncrona no iframe, mas o listener precisa estar pronto)
  const initPromise = waitForModuleEvent('core:moduleInit', EVENT_TIMEOUT_MS);

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
      log(
        3,
        '🔑 PROVA: show() lançou MAS core:moduleInit disparou → try/catch É seguro',
        r,
      );
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

// ─── Mount ───────────────────────────────────────────────────────────────────
export function mountDiagnostic(): void {
  if (typeof window === 'undefined') return;
  if (localStorage.getItem('MEMED_DIAG') !== '1') return;

  (window as unknown as Record<string, unknown>).__memedDiag = {
    runScenario: (n: number, patient?: DiagPatient) => {
      if (!window.MdHub) {
        console.warn('[DIAG] MdHub não disponível. Aguarde o SDK carregar e tente após P1 emitir.');
        return;
      }
      const p = patient ?? DEFAULT_PATIENT;
      switch (n) {
        case 1: return runS1(p);
        case 2: return runS2(p);
        case 3: return runS3(p);
        default: console.warn('[DIAG] Cenário inválido. Use 1, 2 ou 3.');
      }
    },
  };

  console.log('%c[DIAG] Diagnóstico Memed ativo', 'color:#1557FF;font-weight:bold;font-size:14px');
  console.log('[DIAG] Após P1 emitir prescricaoImpressa, execute no console:');
  console.log('[DIAG]   window.__memedDiag.runScenario(1)   // S1: sem hide');
  console.log('[DIAG]   window.__memedDiag.runScenario(2)   // S2: hide sem show');
  console.log('[DIAG]   window.__memedDiag.runScenario(3)   // S3: hide → show → core:moduleInit');
  console.log('[DIAG] Opcional — paciente real para resultado mais preciso:');
  console.log('[DIAG]   window.__memedDiag.runScenario(1, { nome: "NOME", idExterno: "uuid_memed_xxx" })');
}
