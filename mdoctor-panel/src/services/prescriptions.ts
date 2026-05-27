import { ApiError, apiClient } from '@/services/api';
import { getPatientById, mockPatients, type ServiceResult } from '@/services/patients';
import type { MockPrescription } from '@/types/memed';

type BackendPrescription = Partial<MockPrescription> & {
  receita?: Partial<MockPrescription>;
  medicamento?: string;
  orientacoes?: string;
  duracao?: string;
};

function fallbackReason(error: unknown) {
  if (error instanceof ApiError) {
    // 502 aqui indica que a integracao Memed/backend ainda nao esta disponivel.
    if (error.status === 502) {
      return {
        error: 'Memed real indisponivel. Exibindo receita simulada.',
        errorCode: 'memed_unavailable',
      };
    }

    return {
      error: error.code === 'unauthorized' ? 'Sessao local sem autorizacao da API. Usando receita mockada.' : 'API indisponivel. Usando receita mockada.',
      errorCode: error.code,
    };
  }

  return { error: 'Falha inesperada na API. Usando receita mockada.', errorCode: 'unknown' };
}

function buildMockPrescription(patientId: string): MockPrescription {
  const patient = mockPatients.find((item) => item.id === patientId) || mockPatients[0];

  return {
    id: `RX-${patient.id.toUpperCase()}`,
    patient,
    medication: patient.requestedMedication,
    dosage: 'Conforme posologia padrão e avaliação médica',
    instructions:
      'Utilizar conforme orientação médica. Procurar atendimento presencial em caso de piora, reação adversa ou sintomas de alarme.',
    duration: '30 dias',
    issuedBy: 'Dr. Max Matos',
    createdAt: 'Hoje',
  };
}

function normalizePrescription(patientId: string, data: BackendPrescription): MockPrescription {
  const payload = data.receita || data;
  const fallback = buildMockPrescription(patientId);

  return {
    ...fallback,
    ...payload,
    id: String(payload.id || fallback.id),
    medication: String(payload.medication || data.medicamento || fallback.medication),
    instructions: String(payload.instructions || data.orientacoes || fallback.instructions),
    duration: String(payload.duration || data.duracao || fallback.duration),
  };
}

function unwrapPrescription(data: BackendPrescription | { data?: BackendPrescription }): BackendPrescription {
  return 'data' in data && data.data ? data.data : data as BackendPrescription;
}

export async function getPrescriptionByPatient(id: string): Promise<ServiceResult<MockPrescription>> {
  try {
    const data = await apiClient.get<BackendPrescription | { data?: BackendPrescription }>(`/api/prescriptions/${id}`);
    const row = unwrapPrescription(data);

    return {
      data: normalizePrescription(id, row),
      usingMockFallback: false,
    };
  } catch (error) {
    const patientResult = await getPatientById(id);
    const fallback = buildMockPrescription(id);

    return {
      data: patientResult.data
        ? { ...fallback, patient: patientResult.data, medication: patientResult.data.requestedMedication }
        : fallback,
      usingMockFallback: true,
      ...fallbackReason(error),
    };
  }
}

export async function validatePrescription(id: string): Promise<ServiceResult<MockPrescription>> {
  try {
    const data = await apiClient.post<BackendPrescription | { data?: BackendPrescription }>(`/api/prescriptions/${id}`, {
      status: 'validated',
    });
    const row = unwrapPrescription(data);

    return {
      data: normalizePrescription(id, row),
      usingMockFallback: false,
    };
  } catch (error) {
    const fallback = await getPrescriptionByPatient(id);

    return {
      data: fallback.data,
      usingMockFallback: true,
      ...fallbackReason(error),
    };
  }
}

export async function markPrescriptionReady(id: string): Promise<ServiceResult<MockPrescription>> {
  return validatePrescription(id);
}

export async function sendPrescriptionWhatsApp(id: string): Promise<ServiceResult<{ sent: boolean }>> {
  try {
    // O frontend apenas solicita entrega ao backend; WhatsApp real fica no backend/n8n/API.
    const data = await apiClient.post<{ sent: boolean }>(`/api/atendimentos/${id}/deliver`, {
      channel: 'whatsapp',
    });

    return {
      data,
      usingMockFallback: false,
    };
  } catch (error) {
    return {
      data: { sent: true },
      usingMockFallback: true,
      ...fallbackReason(error),
    };
  }
}
