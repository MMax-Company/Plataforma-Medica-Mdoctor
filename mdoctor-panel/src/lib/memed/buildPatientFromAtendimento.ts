import type { MemedPatient } from './types';

export type AtendimentoForMemed = {
  id: string;
  paciente_nome?: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  medicacao_em_uso?: string;
  dados_clinicos?: Record<string, unknown> & {
    medicacao_em_uso?: string;
    medication?: string;
    data_nascimento?: string;
    birth_date?: string;
    address?: string;
    cep?: string;
    triagem_nested?: {
      paciente?: {
        nome?: string;
        cpf?: string;
        telefone?: string;
        email?: string;
        data_nascimento?: string;
        endereco?: string;
        cep?: string;
      };
    };
  };
};

function cleanDigits(value?: string) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeBirthDate(value?: string): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw;
}

/** Mapeia atendimento Doctor Prescreve → paciente Memed (setPaciente). */
export function buildPatientFromAtendimento(atendimento: AtendimentoForMemed): MemedPatient {
  const clinical = atendimento.dados_clinicos || {};
  const triagemPaciente = clinical.triagem_nested?.paciente || {};

  const cpf = cleanDigits(atendimento.paciente_cpf || triagemPaciente.cpf || String(clinical.cpf || ''));
  const nome =
    atendimento.paciente_nome ||
    triagemPaciente.nome ||
    String(clinical.name || clinical.patient_name || 'Paciente sem nome');
  const telefone = cleanDigits(
    atendimento.paciente_telefone || triagemPaciente.telefone || String(clinical.phone || ''),
  );
  const email = atendimento.paciente_email || triagemPaciente.email || String(clinical.email || '') || undefined;
  const dataNascimento = normalizeBirthDate(
    triagemPaciente.data_nascimento ||
      String(clinical.data_nascimento || clinical.birth_date || ''),
  );
  const endereco =
    triagemPaciente.endereco || String(clinical.address || '') || undefined;
  const cep = triagemPaciente.cep || String(clinical.cep || '') || undefined;

  return {
    idExterno: atendimento.id,
    nome,
    telefone: telefone || '11999999999',
    email,
    ...(dataNascimento ? { data_nascimento: dataNascimento } : {}),
    ...(endereco ? { endereco } : {}),
    ...(cep ? { cep } : {}),
    ...(cpf ? { cpf } : { withoutCpf: true }),
  };
}
