import type { MemedPatient } from './types';
import { PRESCRIPTION_MODULE } from './onLoadPrescription';

export async function setMemedPatient(patient: MemedPatient): Promise<void> {
  if (!window.MdHub?.command?.send) {
    throw new Error('MdHub não inicializado — aguarde o módulo Sinapse');
  }

  const { nome, telefone, idExterno, endereco, cidade, cep, cpf, withoutCpf, email, peso, altura, data_nascimento } =
    patient;

  await window.MdHub.command.send(PRESCRIPTION_MODULE, 'setPaciente', {
    nome,
    telefone,
    idExterno,
    ...(endereco ? { endereco } : {}),
    ...(cidade ? { cidade } : {}),
    ...(cep ? { cep } : {}),
    ...(cpf ? { cpf } : {}),
    ...(withoutCpf ? { withoutCpf: true } : {}),
    ...(email ? { email } : {}),
    ...(data_nascimento ? { data_nascimento } : {}),
    ...(peso != null ? { peso } : {}),
    ...(altura != null ? { altura } : {}),
  });
}
