import type { MemedPatient } from './types';
import { setMemedPatientWithDiagnostic } from './memedCommandDiagnostic';

/** Memed trava com nome longo — usar nome curto no setPaciente. */
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
 * CPF e telefone omitidos: quando presentes, disparam lookup assíncrono no sherlock-api
 * da Memed que não conclui antes do showPrescription(). O MdHub.command.send resolve
 * imediatamente (comando recebido), mas o estado interno do paciente fica "pending"
 * até o sherlock-api responder — o widget abre com "Digite o nome do paciente".
 *
 * Com idExterno + nome, o Memed identifica o paciente localmente de forma síncrona:
 * o nome aparece imediatamente quando showPrescription() é chamado.
 */
export function buildSetPacientePayload(patient: MemedPatient): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    nome: normalizeNomeForMemedSetPaciente(patient.nome),
    idExterno: patient.idExterno,
  };
  if (patient.data_nascimento) payload.data_nascimento = patient.data_nascimento;
  if (patient.sexo) payload.sexo = patient.sexo;
  return payload;
}

export async function setMemedPatient(patient: MemedPatient): Promise<void> {
  if (!window.MdHub?.command?.send) {
    throw new Error('MdHub não inicializado — aguarde o módulo Sinapse');
  }
  await setMemedPatientWithDiagnostic(buildSetPacientePayload(patient));
}
