import type { DeliveryChannel, Patient } from '@/types/panel';

/** Iniciais: primeiro nome + último sobrenome (ex.: Max Matos → MM, Pedro Henrique → PH). */
export function patientInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatQueuePatientId(id: string): string {
  const compact = id.replace(/-/g, '').toUpperCase();
  return compact.length > 8 ? compact.slice(0, 8) : compact;
}

export function whatsappContactUrl(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}`;
}

function clinicalRecord(patient: Patient): Record<string, unknown> {
  if (!patient.clinicalData || typeof patient.clinicalData !== 'object') return {};
  return patient.clinicalData;
}

export function hasPrescriptionPhoto(patient: Patient): boolean {
  const clinical = clinicalRecord(patient);
  return Boolean(clinical.foto_receita_url || clinical.previous_prescription_file);
}

export function hasPreviousPrescription(patient: Patient): boolean {
  const clinical = clinicalRecord(patient);
  return Boolean(
    clinical.previous_prescription ||
      clinical.has_previous_prescription ||
      clinical.previous_prescription_file ||
      clinical.foto_receita_url,
  );
}

/** Fila de espera médica: elegível, pago, com receita/foto, fora do suporte WhatsApp. */
export function belongsToMedicalWaitingQueue(patient: Patient): boolean {
  if (patient.queueType === 'support') return false;
  if (patient.status !== 'waiting') return false;
  if (patient.paymentStatus !== 'paid') return false;
  if (patient.eligibility?.eligible === false) return false;

  const clinical = clinicalRecord(patient);
  const hasClinicalPayload = Object.keys(clinical).length > 0;

  if (!hasClinicalPayload) {
    return true;
  }

  return hasPreviousPrescription(patient) && hasPrescriptionPhoto(patient);
}

/** Coluna Em atendimento: processamento/validação Memed (não suporte humano). */
export function belongsToMemedProcessingQueue(patient: Patient): boolean {
  if (patient.queueType === 'support') return false;
  return patient.status === 'under_review' || patient.status === 'memed_processing';
}

export function extractSentDeliveryChannels(patient: Patient): DeliveryChannel[] {
  if (patient.sentDeliveryChannels?.length) return patient.sentDeliveryChannels;

  const clinical = clinicalRecord(patient);
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

export function isPrescriptionValidated(patient: Patient): boolean {
  if (patient.prescriptionValidated === true) return true;
  const clinical = clinicalRecord(patient);
  const receipt = clinical.memed_receita;
  if (!receipt || typeof receipt !== 'object') return patient.status === 'ready';
  return Boolean((receipt as { validated_at?: string; validatedAt?: string }).validated_at || (receipt as { validatedAt?: string }).validatedAt);
}

/** Coluna Receitas prontas: receitas validadas Memed, pagas e ainda não entregues. */
export function belongsToReadyPrescriptionQueue(patient: Patient): boolean {
  if (patient.queueType === 'support') return false;
  if (patient.status !== 'ready') return false;
  if (patient.paymentStatus !== 'paid') return false;
  return isPrescriptionValidated(patient);
}
