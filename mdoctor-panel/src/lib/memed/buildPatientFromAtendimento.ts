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
    sexo?: string;
    gender?: string;
    triagem_nested?: {
      paciente?: {
        nome?: string;
        cpf?: string;
        telefone?: string;
        email?: string;
        data_nascimento?: string;
        endereco?: string;
        cep?: string;
        sexo?: string;
      };
    };
  };
};

function cleanDigits(value?: string) {
  return String(value || '').replace(/\D/g, '');
}

/** Memed espera DDD+número (10–11 dígitos), sem prefixo 55. */
function normalizeTelefoneForMemed(value?: string): string {
  let digits = cleanDigits(value);
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  if (digits.length >= 10 && digits.length <= 11) return digits;
  return '11999999999';
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
  const telefone = normalizeTelefoneForMemed(
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

  const rawSexo = String(
    triagemPaciente.sexo || clinical.sexo || clinical.gender || '',
  ).toUpperCase();
  let sexo: 'M' | 'F' | undefined;
  if (rawSexo === 'M' || rawSexo === 'MASCULINO') sexo = 'M';
  else if (rawSexo === 'F' || rawSexo === 'FEMININO') sexo = 'F';

  return {
    idExterno: atendimento.id,
    nome,
    ...(telefone ? { telefone } : {}),
    ...(email ? { email } : {}),
    ...(dataNascimento ? { data_nascimento: dataNascimento } : {}),
    ...(sexo ? { sexo } : {}),
    ...(endereco ? { endereco } : {}),
    ...(cep ? { cep } : {}),
    ...(cpf ? { cpf } : { withoutCpf: true }),
  };
}
