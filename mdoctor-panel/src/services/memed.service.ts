// src/services/memed.service.ts
import { authHeaders } from './auth.service';
export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
}

export interface PrescriptionData {
  patientId: string;
  patientName: string;
  patientDocument: string;
  patientBirthDate: string;
  patientPhone: string;
  patientEmail: string;
  doctorName: string;
  doctorCrm: string;
  doctorUf: string;
  medications: Medication[];
  notes?: string;
}

export interface MemedConfig {
  enabled: boolean;
  environment: string;
  scriptUrl: string;
  containerId: string;
  primaryColor: string;
  dimensions: {
    minWidth: number;
    minHeight: number;
  };
}

export interface MemedAuthResponse {
  success: boolean;
  token: string;
  prescriber?: {
    id?: string;
    nome?: string;
    crm?: string;
    uf?: string;
    mode?: string;
  };
}

export interface MemedReceiptPayload {
  atendimentoId: string;
  receitaUrl?: string;
  receitaId?: string;
  pdfUrl?: string;
  payload?: unknown;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3004';

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data?.success === false) {
    throw new Error(data?.details || data?.error || `HTTP ${response.status}`);
  }
  return data;
}

export async function getMemedConfig(): Promise<MemedConfig> {
  const response = await fetch(`${API_BASE}/api/memed/config`);
  const data = await readJson<{ success: boolean; config: MemedConfig }>(response);
  return data.config;
}

export async function getMemedToken(): Promise<MemedAuthResponse> {
  const response = await fetch(`${API_BASE}/api/memed/token`, {
    headers: authHeaders()
  });
  return readJson<MemedAuthResponse>(response);
}

export async function saveMemedReceipt(data: MemedReceiptPayload) {
  const response = await fetch(`${API_BASE}/api/memed/receita`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data)
  });
  return readJson(response);
}

export async function issuePrescription(data: PrescriptionData) {
  const response = await fetch(`${API_BASE}/api/prescriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error('Erro ao emitir receita');
  return response.json();
}

export async function downloadPrescriptionPdf(prescriptionId: string) {
  const response = await fetch(`${API_BASE}/api/prescriptions/${prescriptionId}/pdf`, {
    headers: authHeaders()
  });
  if (!response.ok) throw new Error('Erro ao baixar PDF');
  return response.blob();
}
