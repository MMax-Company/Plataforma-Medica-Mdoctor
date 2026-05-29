import { ApiError, apiClient } from '@/services/api';
import { authHeaders } from '@/services/auth.service';

export type SaveClinicalRecordPayload = {
  dados_clinicos: Record<string, unknown>;
  paciente_nome?: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  condicao?: string;
};

export async function saveClinicalRecord(atendimentoId: string, payload: SaveClinicalRecordPayload): Promise<void> {
  const data = await apiClient.patch<{ success: boolean; error?: string }>(`/api/atendimentos/${atendimentoId}/clinical`, payload, {
    headers: authHeaders(),
  });

  if (!data.success) {
    throw new ApiError('http', data.error || 'Não foi possível salvar o prontuário automaticamente.');
  }
}
