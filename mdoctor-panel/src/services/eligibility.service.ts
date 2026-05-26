// src/services/eligibility.service.ts

export interface EligibilityRequest {
  condition: string;
  previous_prescription?: boolean;
  continuous_use_proof?: boolean;
  flags?: string[];
  [key: string]: any;
}

export interface EligibilityResponse {
  success: boolean;
  eligible: boolean;
  reason: string;
  timestamp: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3004';

export async function checkEligibility(data: EligibilityRequest): Promise<EligibilityResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/eligibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error(`Erro HTTP: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('❌ Erro ao verificar elegibilidade:', error);
    throw error;
  }
}
