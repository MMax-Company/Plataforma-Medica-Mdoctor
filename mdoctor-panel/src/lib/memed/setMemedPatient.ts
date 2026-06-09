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
 * Payload oficial Memed para setPaciente.
 * CPF obrigatório para identificação: sem ele, Memed exibe formulário vazio de cadastro.
 * Telefone fictício omitido: sherlock-api rejeita com 422 e trava a promise do setPaciente.
 * Nome normalizado para ≤80 chars para evitar freeze relatado com nomes longos.
 */
export function buildSetPacientePayload(patient: MemedPatient): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    nome: normalizeNomeForMemedSetPaciente(patient.nome),
    idExterno: patient.idExterno,
  };
  // CPF: incluir apenas quando válido (11 dígitos exatos). Sem CPF o Memed não identifica o paciente.
  if (patient.cpf && /^\d{11}$/.test(patient.cpf)) {
    payload.cpf = patient.cpf;
  }
  // Telefone: omitir fallback fictício — sherlock-api rejeita número inválido com 422.
  if (patient.telefone && patient.telefone !== '11999999999') {
    payload.telefone = patient.telefone;
  }
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
