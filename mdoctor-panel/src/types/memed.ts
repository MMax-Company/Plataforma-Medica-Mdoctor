import type { Patient } from '@/types/panel';

export type MemedStepStatus = 'connected' | 'waiting' | 'generated';

export interface MemedStatusItem {
  id: string;
  label: string;
  description: string;
  status: MemedStepStatus;
}

export interface MockPrescription {
  id: string;
  patient: Patient;
  medication: string;
  dosage: string;
  instructions: string;
  duration: string;
  issuedBy: string;
  createdAt: string;
}
