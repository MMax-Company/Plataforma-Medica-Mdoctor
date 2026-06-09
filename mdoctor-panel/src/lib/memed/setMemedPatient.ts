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
 * CPF incluído: necessário para o sherlock-api criar/localizar o paciente na base Memed.
 * Telefone SEMPRE omitido: sherlock-api rejeita números sem cadastro com 422 que resolve
 * (não rejeita) a promise, fazendo o fluxo continuar com paciente não registrado.
 *
 * setPaciente deve ser chamado APÓS newPrescription para evitar race condition:
 * o newPrescription reseta o contexto da prescrição enquanto o sherlock-api ainda
 * processa o paciente assincronamente — ver prepareAndShowPrescription.ts.
 */
export function buildSetPacientePayload(patient: MemedPatient): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    nome: normalizeNomeForMemedSetPaciente(patient.nome),
    idExterno: patient.idExterno,
  };
  if (patient.cpf && /^\d{11}$/.test(patient.cpf)) payload.cpf = patient.cpf;
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
