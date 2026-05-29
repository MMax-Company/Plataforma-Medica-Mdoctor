import { ApiError, apiClient } from '@/services/api';
import { authHeaders } from '@/services/auth.service';
import { getPatientById, mockPatients, type ServiceResult } from '@/services/patients';
import type { DeliveryChannel } from '@/types/panel';
import type { MockPrescription } from '@/types/memed';

type BackendPrescription = Partial<MockPrescription> & {
  receita?: Partial<MockPrescription>;
  medicamento?: string;
  orientacoes?: string;
  duracao?: string;
};

type DeliverApiResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  delivery?: {
    id?: string;
    channel?: string;
    status?: string;
    sent_at?: string;
  };
};

export type PrescriptionDeliveryResult = ServiceResult<{
  sent: boolean;
  channel: DeliveryChannel;
  deliveryId?: string;
}> & {
  alreadySent?: boolean;
};

function fallbackReason(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 502) {
      return {
        error: 'Memed real indisponivel. Exibindo receita simulada.',
        errorCode: 'memed_unavailable',
      };
    }

    return {
      error: error.message || 'API indisponivel.',
      errorCode: error.code,
    };
  }

  return { error: 'Falha inesperada na API.', errorCode: 'unknown' };
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
  return 'data' in data && data.data ? data.data : (data as BackendPrescription);
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
    const validation = await apiClient.post<{ success: boolean; error?: string }>(
      `/api/atendimentos/${id}/clinical/validate`,
      { motivo: 'Receita validada pelo médico na etapa Memed' },
      { headers: authHeaders() },
    );
    if (validation.success === false) {
      throw new ApiError('http', validation.error || 'Falha ao validar receita.', 400);
    }
    const data = await apiClient.get<BackendPrescription | { data?: BackendPrescription }>(`/api/prescriptions/${id}`);
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

export async function sendPrescriptionDelivery(
  atendimentoId: string,
  channel: DeliveryChannel,
): Promise<PrescriptionDeliveryResult> {
  try {
    const data = await apiClient.post<DeliverApiResponse>(
      `/api/atendimentos/${atendimentoId}/deliver`,
      { channel },
      { headers: authHeaders() },
    );

    if (data.success === false) {
      const alreadySent = data.code === 'DELIVERY_ALREADY_SENT';
      throw new ApiError('http', data.error || 'Falha no envio da receita.', alreadySent ? 409 : 400);
    }

    return {
      data: {
        sent: true,
        channel,
        deliveryId: data.delivery?.id,
      },
      usingMockFallback: false,
      alreadySent: false,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        data: { sent: false, channel },
        usingMockFallback: true,
        error: error.message,
        errorCode: error.code,
        alreadySent: error.status === 409,
      };
    }

    return {
      data: { sent: false, channel },
      usingMockFallback: true,
      error: 'Falha inesperada no envio da receita.',
      errorCode: 'unknown',
    };
  }
}

export async function sendPrescriptionWhatsApp(atendimentoId: string): Promise<PrescriptionDeliveryResult> {
  return sendPrescriptionDelivery(atendimentoId, 'whatsapp');
}

export async function sendPrescriptionEmail(atendimentoId: string): Promise<PrescriptionDeliveryResult> {
  return sendPrescriptionDelivery(atendimentoId, 'email');
}

export async function sendPrescriptionSms(atendimentoId: string): Promise<PrescriptionDeliveryResult> {
  return sendPrescriptionDelivery(atendimentoId, 'sms');
}
