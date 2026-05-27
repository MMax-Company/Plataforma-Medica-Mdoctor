export type PatientStatus = 'waiting' | 'under_review' | 'ready' | 'rejected' | 'memed_processing' | 'delivered';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Patient {
  id: string;
  name: string;
  age: number;
  phone: string;
  condition: string;
  requestedMedication: string;
  submittedAt: string;
  lastPrescription?: string;
  status: PatientStatus;
  risk: RiskLevel;
  source: 'Typebot' | 'WhatsApp' | 'Painel';
  paymentStatus: 'paid' | 'pending';
}

export interface PanelMetric {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: 'blue' | 'gold' | 'green' | 'danger';
}
