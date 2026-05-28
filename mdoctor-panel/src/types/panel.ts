export type PatientStatus = 'waiting' | 'under_review' | 'ready' | 'rejected' | 'memed_processing' | 'delivered';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface PatientEligibility {
  eligible: boolean;
  reason?: string;
  reasonCode?: string;
  criteriaUsed?: string[];
  protocolVersion?: string;
  renewalStatus?: string;
  riskLevel?: string;
}

export interface PatientClinicalData {
  protocol_version?: string;
  clinical_summary?: string;
  queixa_principal?: string;
  historico_clinico?: string;
  exame_fisico_telemedicina?: string;
  conduta_sugerida?: string;
  orientacoes_clinicas?: string;
  data_nascimento?: string;
  paciente_cpf?: string;
  endereco?: string;
  tempo_uso_dias?: number;
  flags?: string[];
  medicacao_em_uso?: string;
  criteria_used?: string[];
  renewal_status?: string;
  risk_level?: string;
  decision_meta?: {
    reasonCode?: string;
    criteriaUsed?: string[];
    riskLevel?: string;
    renewalStatus?: string;
    protocolVersion?: string;
  };
  clinical_audit?: {
    approvedBy?: string | null;
    approvedAt?: string | null;
    criteriaUsed?: string[];
    protocolVersion?: string;
    mode?: string;
    correlationId?: string;
    decisionRationale?: string;
  };
  [key: string]: unknown;
}

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
  cpf?: string;
  email?: string;
  birthDate?: string;
  address?: string;
  eligibility?: PatientEligibility;
  clinicalData?: PatientClinicalData;
}

export interface PanelMetric {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: 'blue' | 'gold' | 'green' | 'danger';
}
