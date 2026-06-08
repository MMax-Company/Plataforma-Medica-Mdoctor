import type { MemedPatient } from './types';
import { setMemedPatientWithDiagnostic } from './memedCommandDiagnostic';

/** Memed trava com nome longo + cpf/email/data — usar nome curto no setPaciente. */
export function normalizeNomeForMemedSetPaciente(nome: string): string {
  let value = String(nome || '').trim();
  if (!value) return 'Paciente';

  const dashIdx = value.indexOf(' - ');
  if (dashIdx > 0) {
    value = value.slice(0, dashIdx).trim();
  }

  value = value.replace(/\s+/g, ' ').trim();
  if (value.length > 80) {
    value = value.slice(0, 80).trim();
  }

  return value || 'Paciente';
}

/**
 * Payload mínimo oficial Memed — nome e idExterno obrigatórios; telefone apenas se presente.
 * cpf/email/data_nascimento ficam na camada clínica interna (prontuário/painel).
 * telefone fictício omitido: sherlock-api rejeita com 422 e trava a promise do setPaciente.
 */
export function buildSetPacientePayload(patient: MemedPatient): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    nome: normalizeNomeForMemedSetPaciente(patient.nome),
    idExterno: patient.idExterno,
  };
  if (patient.telefone) payload.telefone = patient.telefone;
  return payload;
}

export async function setMemedPatient(patient: MemedPatient): Promise<void> {
  if (!window.MdHub?.command?.send) {
    throw new Error('MdHub não inicializado — aguarde o módulo Sinapse');
  }

  await setMemedPatientWithDiagnostic(buildSetPacientePayload(patient));
}
