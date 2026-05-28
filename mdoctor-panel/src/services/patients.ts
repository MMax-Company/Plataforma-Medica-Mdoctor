import { ApiError, apiClient } from '@/services/api';
import type { Patient, PatientStatus, RiskLevel } from '@/types/panel';

export interface ServiceResult<T> {
  data: T;
  usingMockFallback: boolean;
  error?: string;
  errorCode?: string;
}

export const mockPatients: Patient[] = [
  {
    id: 'pat-001',
    name: 'Camila Rocha',
    age: 34,
    phone: '+55 11 98123-4421',
    condition: 'Enxaqueca recorrente',
    requestedMedication: 'Sumatriptana 50mg',
    submittedAt: '08:42',
    status: 'waiting',
    risk: 'medium',
    source: 'Typebot',
    paymentStatus: 'paid',
    lastPrescription: '12/04/2026',
  },
  {
    id: 'pat-002',
    name: 'Roberto Almeida',
    age: 47,
    phone: '+55 21 99770-1440',
    condition: 'Rinite alergica',
    requestedMedication: 'Desloratadina 5mg',
    submittedAt: '09:05',
    status: 'waiting',
    risk: 'low',
    source: 'WhatsApp',
    paymentStatus: 'paid',
  },
  {
    id: 'pat-003',
    name: 'Fernanda Lima',
    age: 29,
    phone: '+55 31 98814-3120',
    condition: 'Dermatite atopica',
    requestedMedication: 'Tacrolimo pomada',
    submittedAt: '09:18',
    status: 'under_review',
    risk: 'medium',
    source: 'Painel',
    paymentStatus: 'paid',
    lastPrescription: '03/05/2026',
  },
  {
    id: 'pat-004',
    name: 'Eduardo Martins',
    age: 52,
    phone: '+55 41 99640-8001',
    condition: 'Hipertensao controlada',
    requestedMedication: 'Losartana 50mg',
    submittedAt: '09:27',
    status: 'under_review',
    risk: 'high',
    source: 'Typebot',
    paymentStatus: 'pending',
    lastPrescription: '19/04/2026',
  },
  {
    id: 'pat-005',
    name: 'Juliana Naves',
    age: 38,
    phone: '+55 51 98210-7720',
    condition: 'Contracepcao continua',
    requestedMedication: 'Drospirenona + etinilestradiol',
    submittedAt: '09:34',
    status: 'ready',
    risk: 'low',
    source: 'WhatsApp',
    paymentStatus: 'paid',
    lastPrescription: 'Hoje',
  },
  {
    id: 'pat-006',
    name: 'Marcos Vieira',
    age: 44,
    phone: '+55 85 98977-3031',
    condition: 'Refluxo gastroesofagico',
    requestedMedication: 'Pantoprazol 40mg',
    submittedAt: '09:41',
    status: 'ready',
    risk: 'low',
    source: 'Typebot',
    paymentStatus: 'paid',
    lastPrescription: 'Hoje',
  },
];

type BackendPatient = Partial<Patient> & {
  nome?: string;
  telefone?: string;
  idade?: number;
  paciente_nome?: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  queixa?: string;
  condicao?: string;
  doenca_cronica?: string;
  medicamento?: string;
  medicacao_em_uso?: string;
  dados_clinicos?: string | Record<string, unknown>;
  created_at?: string;
  criado_em?: string;
  atualizado_em?: string;
  status?: string;
  pagamento?: string;
  pagamento_status?: string;
  origem?: string;
  risco?: string;
  elegibilidade?: {
    eligible?: boolean;
    reason?: string;
    reasonCode?: string;
    criteriaUsed?: string[];
    protocolVersion?: string;
    renewalStatus?: string;
    riskLevel?: string;
  };
};

function fallbackReason(error: unknown) {
  if (error instanceof ApiError) {
    return {
      error: error.code === 'unauthorized' ? 'Sessao local sem autorizacao da API. Usando dados mockados.' : 'API indisponivel. Usando dados mockados.',
      errorCode: error.code,
    };
  }

  return { error: 'Falha inesperada na API. Usando dados mockados.', errorCode: 'unknown' };
}

function normalizeStatus(status?: string): PatientStatus {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'under_review' || normalized === 'ready' || normalized === 'rejected' || normalized === 'memed_processing') {
    return normalized;
  }

  if (normalized === 'delivered' || normalized === 'entregue') {
    return 'delivered';
  }

  if (normalized === 'aprovado' || normalized === 'validated' || normalized === 'receita_emitida' || normalized === 'receita_pronta') {
    return 'ready';
  }

  if (normalized === 'em_atendimento' || normalized === 'em_analise' || normalized === 'awaiting_validation') {
    return 'under_review';
  }

  if (normalized === 'rejected' || normalized === 'recusado') {
    return 'rejected';
  }

  return 'waiting';
}

function normalizeRisk(risk?: string): RiskLevel {
  const normalized = String(risk || '').toLowerCase();
  if (normalized === 'high' || normalized === 'bloqueado' || normalized === 'alto') return 'high';
  if (normalized === 'medium' || normalized === 'medio' || normalized === 'médio') return 'medium';
  return 'low';
}

function readClinicalField(item: BackendPatient, field: string) {
  if (!item.dados_clinicos || typeof item.dados_clinicos === 'string') return undefined;
  const value = item.dados_clinicos[field];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
}

function normalizeSource(source?: string) {
  const normalized = String(source || '').toLowerCase();
  if (normalized === 'whatsapp') return 'WhatsApp';
  if (normalized === 'painel') return 'Painel';
  return 'Typebot';
}

function normalizePatient(item: BackendPatient, index: number): Patient {
  const clinicalObject =
    item.dados_clinicos && typeof item.dados_clinicos !== 'string'
      ? item.dados_clinicos
      : {};
  const clinicalData =
    typeof item.dados_clinicos === 'string'
      ? item.dados_clinicos
      : item.dados_clinicos
        ? JSON.stringify(item.dados_clinicos)
        : '';
  const condition =
    item.condition ||
    item.condicao ||
    item.queixa ||
    item.doenca_cronica ||
    readClinicalField(item, 'condition') ||
    readClinicalField(item, 'condicao') ||
    clinicalData;
  const medication =
    item.requestedMedication ||
    item.medicamento ||
    item.medicacao_em_uso ||
    readClinicalField(item, 'medicamento') ||
    readClinicalField(item, 'medicacao_em_uso');
  const payment = String(item.paymentStatus || item.pagamento_status || item.pagamento || '').toUpperCase();

  return {
    id: String(item.id || `api-${index}`),
    name: String(item.name || item.paciente_nome || item.nome || 'Paciente sem nome'),
    age: Number(item.age || item.idade || 0),
    phone: String(item.phone || item.paciente_telefone || item.telefone || item.paciente_email || item.paciente_cpf || 'Sem telefone'),
    condition: String(condition || 'Sem queixa informada'),
    requestedMedication: String(medication || 'Medicamento nao informado'),
    submittedAt: String(item.submittedAt || item.created_at || item.criado_em || item.atualizado_em || 'Agora'),
    status: normalizeStatus(item.status),
    risk: normalizeRisk(item.risk || item.risco),
    source: normalizeSource(item.source || item.origem),
    paymentStatus: payment === 'PENDENTE' || payment === 'PENDING' ? 'pending' : 'paid',
    lastPrescription: item.lastPrescription,
    cpf: String(item.paciente_cpf || readClinicalField(item, 'paciente_cpf') || ''),
    email: String(item.paciente_email || readClinicalField(item, 'paciente_email') || ''),
    birthDate: String(readClinicalField(item, 'data_nascimento') || ''),
    address: String(readClinicalField(item, 'endereco') || ''),
    eligibility: item.elegibilidade
      ? {
          eligible: item.elegibilidade.eligible === true,
          reason: item.elegibilidade.reason,
          reasonCode: item.elegibilidade.reasonCode,
          criteriaUsed: Array.isArray(item.elegibilidade.criteriaUsed) ? item.elegibilidade.criteriaUsed : [],
          protocolVersion: item.elegibilidade.protocolVersion,
          renewalStatus: item.elegibilidade.renewalStatus,
          riskLevel: item.elegibilidade.riskLevel,
        }
      : undefined,
    clinicalData: clinicalObject,
  };
}

function unwrapAtendimento(data: BackendPatient | { atendimento?: BackendPatient; data?: BackendPatient }): BackendPatient {
  if ('atendimento' in data && data.atendimento) return data.atendimento;
  if ('data' in data && data.data) return data.data;
  return data as BackendPatient;
}

export function getMockPatients() {
  return mockPatients.map((patient) => ({ ...patient }));
}

export async function getPatients(): Promise<ServiceResult<Patient[]>> {
  try {
    const data = await apiClient.get<BackendPatient[] | { data?: BackendPatient[]; atendimentos?: BackendPatient[] }>('/api/atendimentos');
    const rows = Array.isArray(data) ? data : data.data || data.atendimentos || [];

    if (rows.length === 0) {
      return {
        data: getMockPatients(),
        usingMockFallback: true,
        error: 'API retornou lista vazia. Usando dados mockados.',
        errorCode: 'empty',
      };
    }

    return {
      data: rows.map(normalizePatient),
      usingMockFallback: false,
    };
  } catch (error) {
    return {
      data: getMockPatients(),
      usingMockFallback: true,
      ...fallbackReason(error),
    };
  }
}

export async function getPatientById(id: string): Promise<ServiceResult<Patient | null>> {
  try {
    const data = await apiClient.get<BackendPatient | { atendimento?: BackendPatient; data?: BackendPatient }>(`/api/atendimentos/${id}`);
    const row = unwrapAtendimento(data);

    return {
      data: normalizePatient(row, 0),
      usingMockFallback: false,
    };
  } catch (error) {
    return {
      data: getMockPatients().find((patient) => patient.id === id) || null,
      usingMockFallback: true,
      ...fallbackReason(error),
    };
  }
}

export async function updatePatientStatus(id: string, status: PatientStatus): Promise<ServiceResult<Patient | null>> {
  try {
    const data = await apiClient.patch<BackendPatient | { atendimento?: BackendPatient; data?: BackendPatient }>(`/api/atendimentos/${id}/status`, {
      status,
      decision: status,
      motivo: 'Atualizacao feita pelo painel medico',
    });
    const row = unwrapAtendimento(data);

    return {
      data: normalizePatient(row, 0),
      usingMockFallback: false,
    };
  } catch (error) {
    const patient = getMockPatients().find((item) => item.id === id);

    return {
      data: patient ? { ...patient, status } : null,
      usingMockFallback: true,
      ...fallbackReason(error),
    };
  }
}
