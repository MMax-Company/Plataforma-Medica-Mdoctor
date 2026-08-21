import { CLINICAL_REJECT_REASONS, type ClinicalRejectReasonCode } from '@/constants/clinical-reject-reasons';
import { isMockFallbackEnabled } from '@/config/env';
import { ApiError, apiClient } from '@/services/api';
import { authHeaders } from '@/services/auth.service';
import type { ServiceResult } from '@/services/patients';

export { CLINICAL_REJECT_REASONS, type ClinicalRejectReasonCode };

type BackendAtendimento = {
  id?: string;
  status?: string;
  paciente_nome?: string;
  paciente_telefone?: string;
  dados_clinicos?: Record<string, unknown>;
};

export const CLINICAL_REJECT_WHATSAPP_MESSAGE =
  'Após avaliação médica, não foi possível emitir a receita solicitada.\n\nNossa equipe analisará as providências administrativas referentes ao pagamento.\n\nCaso precise de ajuda, digite 2 para falar com o suporte.';

function unwrapAtendimento(data: BackendAtendimento | { atendimento?: BackendAtendimento }): BackendAtendimento {
  if ('atendimento' in data && data.atendimento) return data.atendimento;
  return data as BackendAtendimento;
}

export type ClinicalDecisionPayload = {
  notes?: string;
  observacao_medica?: string;
  conduta_medica?: string;
  motivo?: string;
  reason_code?: ClinicalRejectReasonCode;
  mensagem_whatsapp?: string;
  dados_clinicos?: Record<string, unknown>;
};

export type ClinicalDecisionResult = ServiceResult<{ atendimentoId: string; status: string }> & {
  correlationId?: string;
  memedWarning?: string | null;
  notificationSent?: boolean;
};

type ApiDecisionResponse = {
  success?: boolean;
  error?: string;
  correlationId?: string;
  atendimento?: BackendAtendimento;
  memed?: { warning?: string | null; error?: unknown };
  notification?: { sent?: boolean; skipped?: boolean };
};

export async function approveClinicalDecision(
  atendimentoId: string,
  payload: ClinicalDecisionPayload = {},
): Promise<ClinicalDecisionResult> {
  try {
    const data = await apiClient.post<ApiDecisionResponse>(`/api/atendimentos/${atendimentoId}/clinical/approve`, {
      observacao_medica: payload.observacao_medica || payload.notes || null,
      conduta_medica: payload.conduta_medica || null,
      motivo: payload.motivo || 'Atendimento aprovado pelo médico no prontuário',
      dados_clinicos: payload.dados_clinicos || {},
    }, { headers: authHeaders() });

    if (data.success === false) {
      throw new ApiError('http', data.error || 'Falha ao aprovar atendimento.', 400);
    }

    const row = unwrapAtendimento(data);

    return {
      data: { atendimentoId, status: String(row.status || 'approved') },
      usingMockFallback: false,
      correlationId: data.correlationId,
      memedWarning: data.memed?.warning || null,
    };
  } catch (error) {
    if (!isMockFallbackEnabled()) {
      if (error instanceof ApiError) throw error;
      throw new Error('Falha inesperada ao aprovar atendimento.');
    }
    if (error instanceof ApiError) {
      return {
        data: { atendimentoId, status: 'approved' },
        usingMockFallback: true,
        error: error.message,
        errorCode: error.code,
      };
    }

    return {
      data: { atendimentoId, status: 'approved' },
      usingMockFallback: true,
      error: 'Falha inesperada ao aprovar atendimento.',
      errorCode: 'unknown',
    };
  }
}

export async function rejectClinicalDecision(
  atendimentoId: string,
  payload: ClinicalDecisionPayload = {},
): Promise<ClinicalDecisionResult> {
  try {
    const data = await apiClient.post<ApiDecisionResponse>(`/api/atendimentos/${atendimentoId}/clinical/reject`, {
      reason_code: payload.reason_code || 'OUTROS',
      observacao_medica: payload.observacao_medica || payload.notes || null,
      motivo: payload.motivo || payload.notes || undefined,
      // Texto literal digitado pelo médico no campo opcional — vira a conduta
      // médica oficial do prontuário, substituindo o texto padrão de
      // continuidade. Sem isso, o prontuário só teria o motivo estruturado.
      conduta_medica: payload.conduta_medica || payload.notes || undefined,
      mensagem_whatsapp: payload.mensagem_whatsapp || CLINICAL_REJECT_WHATSAPP_MESSAGE,
      dados_clinicos: payload.dados_clinicos || {},
    }, { headers: authHeaders() });

    if (data.success === false) {
      throw new ApiError('http', data.error || 'Falha ao reprovar atendimento.', 400);
    }

    const row = unwrapAtendimento(data);

    return {
      data: { atendimentoId, status: String(row.status || 'rejected') },
      usingMockFallback: false,
      correlationId: data.correlationId,
      notificationSent: data.notification?.sent === true,
    };
  } catch (error) {
    if (!isMockFallbackEnabled()) {
      if (error instanceof ApiError) throw error;
      throw new Error('Falha inesperada ao reprovar atendimento.');
    }
    if (error instanceof ApiError) {
      return {
        data: { atendimentoId, status: 'rejected' },
        usingMockFallback: true,
        error: error.message,
        errorCode: error.code,
      };
    }

    return {
      data: { atendimentoId, status: 'rejected' },
      usingMockFallback: true,
      error: 'Falha inesperada ao reprovar atendimento.',
      errorCode: 'unknown',
    };
  }
}
