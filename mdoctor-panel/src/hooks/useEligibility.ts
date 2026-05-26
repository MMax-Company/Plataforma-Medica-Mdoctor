'use client';
import { useState, useCallback } from 'react';
import { checkEligibility, type EligibilityRequest, type EligibilityResponse } from '@/services/api';

export function useEligibility() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluate = useCallback(async (data: EligibilityRequest): Promise<EligibilityResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      return await checkEligibility(data);
    } catch (e: any) {
      setError(e.message || 'Erro ao avaliar elegibilidade');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { evaluate, loading, error };
}
