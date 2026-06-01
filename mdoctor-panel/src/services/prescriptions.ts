import { ApiError, apiClient } from '@/services/api';
import { isMemedRealEnabled, isMockFallbackEnabled } from '@/config/env';
import { authHeaders } from '@/services/auth.service';
import { getPatientById, mockPatients, type ServiceResult } from '@/services/patients';
import type { DeliveryChannel } from '@/types/panel';
import type { MockPrescription } from '@/types/memed';

type AtendimentoReceita = {
  dados_clinicos?: {
    memed_receita?: {
      receitaId?: string;
      pdfUrl?: string;
      receitaUrl?: string;
      gerada_em?: string;
    };
  };
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
    return {
      error: error.message || 'API indisponível.',
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

function prescriptionFromAtendimento(id: string, atendimento: AtendimentoReceita): MockPrescription | null {
  const receipt = atendimento.dados_clinicos?.memed_receita;
  if (!receipt?.receitaId && !receipt?.pdfUrl && !receipt?.receitaUrl) {
    return null;
  }

  const fallback = buildMockPrescription(id);
  return {
    ...fallback,
    id: String(receipt.receitaId || fallback.id),
    instructions: 'Receita emitida e assinada no widget Memed/Sinapse (Bird ID).',
    createdAt: receipt.gerada_em || fallback.createdAt,
  };
}

/** Visualização pós-emissão — fonte: `dados_clinicos.memed_receita` (não emite receita). */
export async function getPrescriptionByPatient(id: string): Promise<ServiceResult<MockPrescription>> {
  try {
    const data = await apiClient.get<{ success: boolean; atendimento?: AtendimentoReceita }>(
      `/api/atendimentos/${id}`,
      { headers: authHeaders() },
    );
    const fromMemed = data.atendimento ? prescriptionFromAtendimento(id, data.atendimento) : null;
    if (fromMemed) {
      return { data: fromMemed, usingMockFallback: false };
    }

    if (isMemedRealEnabled()) {
      return {
        data: null as unknown as MockPrescription,
        usingMockFallback: false,
        error: 'Receita ainda não vinculada — emita no widget Memed (/receita).',
        errorCode: 'memed_receipt_missing',
      };
    }

    const patientResult = await getPatientById(id);
    const fallback = buildMockPrescription(id);
    return {
      data: patientResult.data
        ? { ...fallback, patient: patientResult.data, medication: patientResult.data.requestedMedication }
        : fallback,
      usingMockFallback: true,
      error: 'Receita ainda não vinculada — emita no widget Memed (/receita).',
      errorCode: 'memed_receipt_missing',
    };
  } catch (error) {
    if (isMemedRealEnabled() || !isMockFallbackEnabled()) {
      return {
        data: null as unknown as MockPrescription,
        usingMockFallback: false,
        ...fallbackReason(error),
      };
    }
    const fallback = buildMockPrescription(id);
    return {
      data: fallback,
      usingMockFallback: true,
      ...fallbackReason(error),
    };
  }
}

/** Validação clínica pós-emissão Memed — não emite nem assina receita. */
export async function validatePrescription(id: string): Promise<ServiceResult<MockPrescription>> {
  try {
    const validation = await apiClient.post<{ success: boolean; error?: string }>(
      `/api/atendimentos/${id}/clinical/validate`,
      { motivo: 'Receita validada pelo médico após emissão no widget Memed' },
      { headers: authHeaders() },
    );
    if (validation.success === false) {
      throw new ApiError('http', validation.error || 'Falha ao validar receita.', 400);
    }
    return getPrescriptionByPatient(id);
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
