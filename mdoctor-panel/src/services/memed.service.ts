// src/services/memed.service.ts
import { getApiBase } from '@/config/api';
import { authHeaders } from './auth.service';
export interface MemedConfig {
  enabled: boolean;
  environment: string;
  realMode?: boolean;
  mockFallbackAllowed?: boolean;
  emissionMode?: string;
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
  digitalLink?: string;
  digital_link?: string;
  unlockCode?: string;
  unlock_code?: string;
  payload?: unknown;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data?.success === false) {
    throw new Error(data?.details || data?.error || `HTTP ${response.status}`);
  }
  return data;
}

export async function getMemedConfig(): Promise<MemedConfig> {
  const response = await fetch(`${getApiBase()}/api/memed/config`);
  const data = await readJson<{ success: boolean; config: MemedConfig }>(response);
  return data.config;
}

export async function getMemedToken(options?: { refresh?: boolean }): Promise<MemedAuthResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  const response = await fetch(`${getApiBase()}/api/memed/token${query}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  return readJson<MemedAuthResponse>(response);
}

export async function notifyMemedPrescriptionCancelled(atendimentoId: string, payload?: unknown) {
  const response = await fetch(`${getApiBase()}/api/memed/receita/cancelada`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ atendimentoId, payload }),
  });
  return readJson(response);
}

export async function startMemedEmission(atendimentoId: string) {
  const response = await fetch(`${getApiBase()}/api/memed/iniciar-emissao`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ atendimentoId })
  });
  return readJson(response);
}

/** Persistência oficial após callback `prescricaoImpressa` no widget Memed/Sinapse. */
export async function saveMemedReceipt(data: MemedReceiptPayload) {
  const response = await fetch(`${getApiBase()}/api/memed/receita`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data)
  });
  return readJson(response);
}
