import type { DeliveryChannel, Patient } from '@/types/panel';

const NAME_CONNECTORS = new Set(['da', 'de', 'do', 'dos', 'das', 'e']);

/**
 * Validação matemática de CPF (algoritmo oficial Receita Federal).
 * Rejeita CPFs vazios, com menos/mais de 11 dígitos, todos iguais e com dígitos verificadores errados.
 */
export function isValidCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]!) * (10 - i);
  let r = (sum * 10) % 11;
  if (r >= 10) r = 0;
  if (r !== parseInt(cpf[9]!)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]!) * (11 - i);
  r = (sum * 10) % 11;
  if (r >= 10) r = 0;
  return r === parseInt(cpf[10]!);
}

const STARTS_WITH_LETTER = /^[A-Za-zÀ-ÖØ-öø-ÿ]/;

function nameTokens(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/\./g, '').trim())
    .filter(Boolean)
    .filter((part) => !NAME_CONNECTORS.has(part.toLowerCase()))
    .filter((part) => STARTS_WITH_LETTER.test(part));
}

/** Avatar: apenas as 2 primeiras iniciais reais (ex.: Fernando Henrique Pereira → FH). */
export function avatarInitials(name: string): string {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return '—';
  const a = tokens[0]?.[0]?.toUpperCase() ?? '';
  const b = tokens[1]?.[0]?.toUpperCase() ?? '';
  return a + b;
}

/** Iniciais institucionais: todas as letras separadas por ponto com ponto final (ex.: Jose Maria da Silva → J.M.S.). */
export function patientInitials(name: string): string {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return '—';

  const letters = tokens
    .map((part) => {
      const first = [...part][0];
      return first ? first.toUpperCase() : '';
    })
    .filter(Boolean);

  return letters.join('.') + '.';
}

export function formatQueuePatientId(id: string): string {
  const compact = id.replace(/-/g, '').toUpperCase();
  return compact.length > 8 ? compact.slice(0, 8) : compact;
}

type MedicalQueueTimingSource = {
  criado_em?: string;
  atualizado_em?: string;
  dados_clinicos?: Record<string, unknown>;
};

/** Timestamp em que o paciente entrou na fila médica (não a triagem inicial). */
export function getMedicalQueueEnteredAt(item: MedicalQueueTimingSource): string | undefined {
  const clinical = item.dados_clinicos || {};
  const uploadSession = clinical.prescription_upload_session as { completed_at?: string } | undefined;
  const candidates = [
    clinical.medical_queue_entered_at,
    uploadSession?.completed_at,
    clinical.previous_prescription_uploaded_at,
    item.atualizado_em,
    item.criado_em,
  ];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return undefined;
}

export function formatMedicalWaitingTime(item: MedicalQueueTimingSource, nowMs = Date.now()): string {
  const enteredAt = getMedicalQueueEnteredAt(item);
  if (!enteredAt) return 'Agora';
  const diff = Math.max(0, nowMs - new Date(enteredAt).getTime());
  const hours = Math.floor(diff / 36e5);
  const minutes = Math.floor((diff % 36e5) / 6e4);
  return hours ? `${hours}h ${minutes}min` : `${minutes || 1}min`;
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

/** Coluna Em atendimento / fluxo Memed (não suporte humano). */
export function belongsToMemedProcessingQueue(patient: Patient): boolean {
  if (patient.queueType === 'support') return false;
  return (
    patient.status === 'under_review' ||
    patient.status === 'approved' ||
    patient.status === 'receita_em_edicao' ||
    patient.status === 'memed_processing' ||
    patient.status === 'receita_emitida'
  );
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
