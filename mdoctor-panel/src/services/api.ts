import { API_BASE } from '@/config/api';

export { API_BASE };

export interface EligibilityRequest {
  condition: string;
  previous_prescription?: boolean;
  continuous_use_proof?: boolean;
  flags?: string[];
  [key: string]: unknown;
}

export interface EligibilityResponse {
  success: boolean;
  eligible: boolean;
  reason: string;
  timestamp: string;
}

export async function checkEligibility(data: EligibilityRequest): Promise<EligibilityResponse> {
  const res = await fetch(`${API_BASE}/api/eligibility`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Erro na API');
  return res.json();
}
