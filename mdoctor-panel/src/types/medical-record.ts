import type { Patient, RiskLevel } from '@/types/panel';

export interface ClinicalSection {
  title: string;
  content: string;
}

export interface MedicalRecord {
  id: string;
  patient: Patient;
  eligibility: {
    approved: boolean;
    message: string;
    criteria: string[];
    badgeLabel?: string;
    riskStatus?: string;
    renewalStatus?: string;
    protocolVersion?: string;
  };
  clinicalSummary: {
    chiefComplaint: string;
    clinicalHistory: string;
    physicalExam: string;
    allergies: string;
    currentMedications: string;
    medicalConduct: string;
  };
  medicalHistory: {
    previousConditions: string[];
    previousPrescriptions: string[];
    risk: RiskLevel;
    chatbotCompletedAt: string;
    timeline: string[];
    highlightedMedication?: string;
  };
  audit: {
    approvedBy?: string;
    approvedAt?: string;
    correlationId?: string;
    mode?: string;
    decisionRationale?: string;
  };
  notes: string;
}
