import type { MemedPatient } from './types';
import { sendMemedCommandWithDiagnostic } from './memedCommandDiagnostic';
import { PRESCRIPTION_MODULE } from './onLoadPrescription';

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
 * Payload para setPaciente sem telefone.
 * Telefone SEMPRE omitido: sherlock-api rejeita números sem cadastro Memed com 422.
 * A promise do MdHub resolve (não rejeita) com o 422, fazendo nosso código continuar
 * e abrir o widget sem paciente definido — causa-raiz do "Digite o nome do paciente".
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

/**
 * Estratégia em dois estágios:
 * 1. Tentativa com CPF (20s): CPF permite identificação do paciente pelo sherlock-api.
 * 2. Fallback sem CPF (10s): se o lookup por CPF falhar/expirar, identificar pelo idExterno.
 * Em ambos os casos, telefone é omitido para evitar 422 silencioso do sherlock-api.
 */
export async function setMemedPatient(patient: MemedPatient): Promise<void> {
  if (!window.MdHub?.command?.send) {
    throw new Error('MdHub não inicializado — aguarde o módulo Sinapse');
  }

  const full = buildSetPacientePayload(patient);
  try {
    await sendMemedCommandWithDiagnostic(PRESCRIPTION_MODULE, 'setPaciente', full, 20_000);
    return;
  } catch {
    // CPF lookup pode ter excedido o tempo — fallback por idExterno sem CPF.
  }

  const minimal: Record<string, unknown> = {
    nome: full.nome,
    idExterno: full.idExterno,
  };
  if (patient.data_nascimento) minimal.data_nascimento = patient.data_nascimento;
  if (patient.sexo) minimal.sexo = patient.sexo;
  await sendMemedCommandWithDiagnostic(PRESCRIPTION_MODULE, 'setPaciente', minimal, 10_000);
}
