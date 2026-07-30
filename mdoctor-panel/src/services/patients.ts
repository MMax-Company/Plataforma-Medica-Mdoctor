import { ApiError, apiClient } from '@/services/api';
import { isMockFallbackEnabled } from '@/config/env';
import type { DeliveryChannel, Patient, PatientStatus, RiskLevel } from '@/types/panel';

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
    eligibility: { eligible: true },
    clinicalData: {
      previous_prescription: true,
      foto_receita_url: 'https://placehold.co/600x800/png?text=Receita+anterior',
      data_nascimento: '12/03/1992',
      paciente_cpf: '123.456.789-00',
      paciente_email: 'camila.rocha@email.com',
      endereco: 'Av. Paulista, 1000 - São Paulo/SP',
      cep: '01310-100',
      queixa_principal: 'Renovação de tratamento para enxaqueca recorrente.',
      historico_clinico: 'Uso contínuo com relato de estabilidade clínica na triagem.',
      exame_fisico_telemedicina: 'Telemedicina assíncrona sem exame presencial nesta etapa.',
      alergias: 'Sem alergias medicamentosas graves relatadas.',
      medicacao_em_uso: 'Sumatriptana 50mg',
      conduta_sugerida: 'Conduta: avaliar renovação conservadora conforme protocolo e documentação enviada.',
    },
  },
  {
    id: 'pat-002',
    name: 'Pedro Henrique',
    age: 47,
    phone: '+55 21 997701440',
    condition: 'Rinite alergica',
    requestedMedication: 'Desloratadina 5mg',
    submittedAt: '09:05',
    status: 'waiting',
    risk: 'low',
    source: 'WhatsApp',
    paymentStatus: 'paid',
    eligibility: { eligible: true },
    clinicalData: {
      has_previous_prescription: true,
      previous_prescription_file: 'https://example.com/receita-pedro.jpg',
    },
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
    phone: '+55 51 982107720',
    condition: 'Contracepcao continua',
    requestedMedication: 'Drospirenona + etinilestradiol',
    submittedAt: '09:34',
    status: 'ready',
    risk: 'low',
    source: 'WhatsApp',
    paymentStatus: 'paid',
    lastPrescription: 'Hoje',
    email: 'juliana.naves@email.com',
    prescriptionValidated: true,
    clinicalData: {
      memed_receita: {
        validated_at: new Date().toISOString(),
        pdfUrl: 'https://placehold.co/600x800/png?text=Receita+validada',
        receitaId: 'RX-PAT-005',
        gerada_em: new Date().toISOString(),
      },
      historico_receita: {
        status_prescricao: 'validated',
        link_memed: 'https://placehold.co/600x800/png?text=Receita+validada',
      },
    },
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
  ticket_id?: string;
  atendimento_id?: string | null;
  patient_id?: string | null;
  support_sub_status?: string;
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

  if (
    normalized === 'under_review' ||
    normalized === 'ready' ||
    normalized === 'rejected' ||
    normalized === 'memed_processing' ||
    normalized === 'approved' ||
    normalized === 'receita_em_edicao' ||
    normalized === 'receita_emitida' ||
    normalized === 'delivered'
  ) {
    return normalized;
  }

  if (['queue', 'fila', 'triaged', 'triagem', 'aguardando_pagamento'].includes(normalized)) {
    return 'waiting';
  }

  if (normalized === 'entregue') {
    return 'delivered';
  }

  if (normalized === 'aprovado' || normalized === 'validated' || normalized === 'receita_pronta') {
    return 'ready';
  }

  if (normalized === 'em_atendimento' || normalized === 'em_analise') {
    return 'under_review';
  }

  if (normalized === 'awaiting_validation') {
    return 'receita_emitida';
  }

  if (normalized === 'recusado') {
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

function extractSentChannelsFromClinical(clinical: Record<string, unknown>): DeliveryChannel[] {
  const deliveries = Array.isArray(clinical.entregas_receita)
    ? clinical.entregas_receita
    : clinical.entrega_receita
      ? [clinical.entrega_receita]
      : [];

  return deliveries
    .filter((item) => item && typeof item === 'object' && (item as { status?: string }).status === 'sent')
    .map((item) => String((item as { channel?: string }).channel || '').toLowerCase())
    .filter((channel): channel is DeliveryChannel => channel === 'whatsapp' || channel === 'email' || channel === 'sms');
}

function isReceiptValidated(clinical: Record<string, unknown>) {
  const receipt = clinical.memed_receita;
  if (!receipt || typeof receipt !== 'object') return false;
  return Boolean((receipt as { validated_at?: string; validatedAt?: string }).validated_at || (receipt as { validatedAt?: string }).validatedAt);
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
    birthDate: String(readClinicalField(item, 'data_nascimento') || readClinicalField(item, 'birth_date') || ''),
    address: String(readClinicalField(item, 'endereco') || readClinicalField(item, 'address') || ''),
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
    queueType:
      item.ticket_id ||
      item.support_sub_status ||
      clinicalObject.queue_type === 'support' ||
      item.condicao === 'suporte_whatsapp'
        ? 'support'
        : 'medical',
    sentDeliveryChannels: extractSentChannelsFromClinical(clinicalObject),
    prescriptionValidated: isReceiptValidated(clinicalObject) || normalizeStatus(item.status) === 'ready',
  };
}

export async function getSupportPatients(): Promise<ServiceResult<Patient[]>> {
  try {
    const data = await apiClient.get<
      BackendPatient[] | { tickets?: BackendPatient[]; atendimentos?: BackendPatient[] }
    >(
      '/api/atendimentos/support-queue',
    );
    const rows = Array.isArray(data) ? data : data.tickets || data.atendimentos || [];
    return {
      data: rows.map(normalizePatient),
      usingMockFallback: false,
    };
  } catch (error) {
    return {
      data: [],
      usingMockFallback: true,
      ...fallbackReason(error),
    };
  }
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
    const data = await apiClient.get<BackendPatient[] | { data?: BackendPatient[]; atendimentos?: BackendPatient[] }>(
      '/api/atendimentos?scope=medical',
    );
    const rows = Array.isArray(data) ? data : data.data || data.atendimentos || [];

    if (rows.length === 0) {
      if (isMockFallbackEnabled()) {
        return {
          data: getMockPatients(),
          usingMockFallback: true,
          error: 'API retornou lista vazia. Usando dados mockados.',
          errorCode: 'empty',
        };
      }
      return { data: [], usingMockFallback: false };
    }

    return {
      data: rows.map(normalizePatient).filter((patient) => patient.queueType !== 'support'),
      usingMockFallback: false,
    };
  } catch (error) {
    if (isMockFallbackEnabled()) {
      return {
        data: getMockPatients().filter((patient) => patient.queueType !== 'support'),
        usingMockFallback: true,
        ...fallbackReason(error),
      };
    }
    return {
      data: [],
      usingMockFallback: false,
      ...fallbackReason(error),
    };
  }
}

export async function getPatientById(id: string): Promise<ServiceResult<Patient | null>> {
  const {
    buildEligibilityPayload,
    getVisualSimulationPatientById,
    isVisualSimulationPatient,
    getVisualSimulationAtendimentos,
  } = await import('@/lib/visual-simulation-fila');
  if (isVisualSimulationPatient(id)) {
    const row = getVisualSimulationAtendimentos().find((item) => item.id === id);
    const sim = getVisualSimulationPatientById(id);
    if (sim && row) {
      try {
        const { checkEligibility } = await import('@/services/api');
        const decision = await checkEligibility(
          buildEligibilityPayload(row.dados_clinicos, row.condicao) as import('@/services/api').EligibilityRequest,
        );
        return {
          data: {
            ...sim,
            eligibility: {
              eligible: decision.eligible,
              reason: decision.reason,
            },
          },
          usingMockFallback: false,
        };
      } catch {
        return { data: sim, usingMockFallback: false };
      }
    }
  }

  try {
    const data = await apiClient.get<BackendPatient | { atendimento?: BackendPatient; data?: BackendPatient }>(`/api/atendimentos/${id}`);
    const row = unwrapAtendimento(data);

    return {
      data: normalizePatient(row, 0),
      usingMockFallback: false,
    };
  } catch (error) {
    if (isMockFallbackEnabled()) {
      return {
        data: getMockPatients().find((patient) => patient.id === id) || null,
        usingMockFallback: true,
        ...fallbackReason(error),
      };
    }
    return {
      data: null,
      usingMockFallback: false,
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
    if (isMockFallbackEnabled()) {
      const patient = getMockPatients().find((item) => item.id === id);
      return {
        data: patient ? { ...patient, status } : null,
        usingMockFallback: true,
        ...fallbackReason(error),
      };
    }
    return {
      data: null,
      usingMockFallback: false,
      ...fallbackReason(error),
    };
  }
}
