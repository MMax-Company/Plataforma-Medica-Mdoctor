import { PRESCRIPTION_MODULE } from './onLoadPrescription';

export type MemedCommandDiagnosticEntry = {
  id: string;
  at: string;
  phase: 'before' | 'after' | 'event';
  module: string;
  command: string;
  method: 'MdHub.command.send' | 'event';
  payload?: unknown;
  response?: unknown;
  duration_ms?: number;
  ok?: boolean;
  error?: string;
  timed_out?: boolean;
};

declare global {
  interface Window {
    __memedDiagnosticLog?: MemedCommandDiagnosticEntry[];
  }
}

const DEFAULT_TIMEOUT_MS: Record<string, number> = {
  'plataforma.usuario.getUsuario': 20_000,
  'plataforma.prescricao.setPaciente': 12_000,
  'plataforma.prescricao.newPrescription': 15_000,
  'plataforma.prescricao.addItem': 20_000,
};

function commandKey(module: string, command: string) {
  return `${module}.${command}`;
}

function pushEntry(entry: MemedCommandDiagnosticEntry) {
  if (typeof window === 'undefined') return;
  if (!window.__memedDiagnosticLog) window.__memedDiagnosticLog = [];
  window.__memedDiagnosticLog.push(entry);
}

export function clearMemedDiagnosticLog() {
  if (typeof window !== 'undefined') window.__memedDiagnosticLog = [];
}

export function getMemedDiagnosticLog(): MemedCommandDiagnosticEntry[] {
  if (typeof window === 'undefined') return [];
  return window.__memedDiagnosticLog ? [...window.__memedDiagnosticLog] : [];
}

/** Captura src truncado de todos os iframes no DOM — detecta reloads entre eventos. */
export function captureIframeState(): Array<{ id: string; src: string }> {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll('iframe')).map((f) => ({
    id: f.id || f.name || '',
    src: f.src ? f.src.slice(0, 120) : '',
  }));
}

/**
 * Registra evento não-comando (core:moduleInit, prescricaoImpressa, etc.)
 * no mesmo log de diagnóstico, com timestamp e detalhe arbitrário.
 */
export function pushDiagnosticEvent(eventType: string, detail?: unknown): void {
  pushEntry({
    id: `${eventType}-${Date.now()}`,
    at: new Date().toISOString(),
    phase: 'event',
    module: 'event',
    command: eventType,
    method: 'event',
    payload: serializeForLog(detail),
  });
  console.info(`[Memed diag] EVENT ${eventType}`, detail);
}

function serializeForLog(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/**
 * Envia comando MdHub com timeout por comando, logs before/after e resposta completa.
 */
export async function sendMemedCommandWithDiagnostic(
  module: string,
  command: string,
  payload?: unknown,
  timeoutMs?: number,
): Promise<unknown> {
  if (!window.MdHub?.command?.send) {
    throw new Error('MdHub.command.send indisponível');
  }

  const key = commandKey(module, command);
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS[key] ?? 15_000;
  const id = `${key}-${Date.now()}`;
  const method = 'MdHub.command.send' as const;

  pushEntry({
    id: `${id}-before`,
    at: new Date().toISOString(),
    phase: 'before',
    module,
    command,
    method,
    payload: serializeForLog(payload),
  });

  const started = performance.now();
  let timedOut = false;

  const sendPromise = window.MdHub.command.send(module, command, payload);

  const result = await Promise.race([
    sendPromise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error(`Timeout ${timeout}ms em ${key}`));
      }, timeout);
    }),
  ])
    .then((response) => {
      const duration_ms = Math.round(performance.now() - started);
      pushEntry({
        id: `${id}-after`,
        at: new Date().toISOString(),
        phase: 'after',
        module,
        command,
        method,
        payload: serializeForLog(payload),
        response: serializeForLog(response),
        duration_ms,
        ok: true,
      });
      console.info(`[Memed diag] ${key} OK ${duration_ms}ms`, { payload, response });
      return response;
    })
    .catch((err) => {
      const duration_ms = Math.round(performance.now() - started);
      const message = err instanceof Error ? err.message : String(err);
      pushEntry({
        id: `${id}-after`,
        at: new Date().toISOString(),
        phase: 'after',
        module,
        command,
        method,
        payload: serializeForLog(payload),
        duration_ms,
        ok: false,
        error: message,
        timed_out: timedOut,
      });
      console.error(`[Memed diag] ${key} FAIL ${duration_ms}ms`, { payload, error: message });
      throw err;
    });

  return result;
}

export async function verifyMemedUsuario(): Promise<unknown> {
  return sendMemedCommandWithDiagnostic('plataforma.usuario', 'getUsuario');
}

// ── Diagnostic reporter ────────────────────────────────────────────────────────
// Registered from MemedEmissionOverlay so it has access to atendimentoId/patientName.
// Fired automatically when setPaciente exhausts all retries — no manual action needed.

type DiagnosticReporterFn = (error: string) => void;
let _diagnosticReporter: DiagnosticReporterFn | null = null;

export function registerMemedDiagnosticReporter(fn: DiagnosticReporterFn): void {
  _diagnosticReporter = fn;
}

export function unregisterMemedDiagnosticReporter(): void {
  _diagnosticReporter = null;
}

function fireDiagnosticReport(error: string): void {
  try { _diagnosticReporter?.(error); } catch { /* never block */ }
}
// ──────────────────────────────────────────────────────────────────────────────

export async function setMemedPatientWithDiagnostic(payload: Record<string, unknown>): Promise<unknown> {
  try {
    return await sendMemedCommandWithDiagnostic(PRESCRIPTION_MODULE, 'setPaciente', payload);
  } catch {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    try {
      return await sendMemedCommandWithDiagnostic(PRESCRIPTION_MODULE, 'setPaciente', payload, 30_000);
    } catch (finalErr) {
      // All retries exhausted — export full diagnostic log automatically.
      const msg = finalErr instanceof Error ? finalErr.message : String(finalErr);
      fireDiagnosticReport(msg);
      throw finalErr;
    }
  }
}

export async function sendNewPrescriptionWithDiagnostic(timeoutMs?: number): Promise<unknown> {
  return sendMemedCommandWithDiagnostic(PRESCRIPTION_MODULE, 'newPrescription', undefined, timeoutMs);
}

export async function sendAddItemWithDiagnostic(payload: Record<string, unknown>): Promise<unknown> {
  return sendMemedCommandWithDiagnostic(PRESCRIPTION_MODULE, 'addItem', payload);
}
