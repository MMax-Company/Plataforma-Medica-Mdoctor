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
 * CPF e telefone incluídos: necessários para o sherlock-api criar/localizar o paciente
 * na base Memed e para a etapa de emissão não solicitar telefone ao médico.
 * Telefone deve ter 10–11 dígitos (DDD + número, sem prefixo 55) — ver normalizeTelefoneForMemed.
 * Telefone fake/inválido causa 422 silencioso no sherlock-api; só incluir se já normalizado.
 *
 * setPaciente deve ser chamado ANTES de show() conforme documentação oficial Memed:
 * core:moduleInit → setPaciente → show() — ver prepareAndShowPrescription.ts.
 */
export function buildSetPacientePayload(patient: MemedPatient): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    nome: normalizeNomeForMemedSetPaciente(patient.nome),
    idExterno: patient.idExterno,
  };
  if (patient.cpf && /^\d{11}$/.test(patient.cpf)) payload.cpf = patient.cpf;
  if (patient.telefone && /^\d{10,11}$/.test(patient.telefone)) payload.telefone = patient.telefone;
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
