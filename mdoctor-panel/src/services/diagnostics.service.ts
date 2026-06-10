import { getApiBase } from '@/config/api';

export interface MemedDiagnosticReport {
  atendimentoId?: string;
  patientName?: string;
  timestamp: string;
  error: string;
  log: unknown[];
}

/** Fire-and-forget — nunca lança exceção nem bloqueia o fluxo principal. */
export async function postMemedDiagnosticReport(report: MemedDiagnosticReport): Promise<void> {
  const apiBase = getApiBase();
  if (!apiBase) return;
  try {
    await fetch(`${apiBase}/api/diagnostics/memed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // diagnóstico é best-effort, nunca afeta o fluxo médico
  }
}
