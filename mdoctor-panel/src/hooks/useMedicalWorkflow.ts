'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiBase, checkEligibility } from '@/services/api';
import { authHeaders, requireSession, type AuthUser } from '@/services/auth.service';
import {
  approveClinicalDecision,
  CLINICAL_REJECT_REASONS,
  CLINICAL_REJECT_WHATSAPP_MESSAGE,
  rejectClinicalDecision,
  type ClinicalRejectReasonCode,
} from '@/services/clinical-decision';
import { sendPrescriptionWhatsApp, validatePrescription } from '@/services/prescriptions';
import { hasPersistedMemedReceipt } from '@/lib/atendimento-status';

export type WorkflowAtendimento = {
  id: string;
  status: string;
  paciente_nome: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  condicao?: string;
  pagamento_status?: string;
  risco?: string | null;
  motivo_decisao?: string | null;
  dados_clinicos?: Record<string, unknown> & {
    medicacao_em_uso?: string;
    doenca_cronica?: string;
    queixa_principal?: string;
    historico_clinico?: string;
    conduta?: string;
    memed_receita?: {
      receitaId?: string;
      pdfUrl?: string;
      receitaUrl?: string;
      gerada_em?: string;
      validated_at?: string;
    };
  };
};

function normalizeStatus(status?: string) {
  return String(status || '').toLowerCase();
}

export function useMedicalWorkflow(atendimentoId: string) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [atendimento, setAtendimento] = useState<WorkflowAtendimento | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [rejectReasonCode, setRejectReasonCode] = useState<ClinicalRejectReasonCode>('FORA_DO_PROTOCOLO');
  const [toast, setToast] = useState<string | null>(null);

  const fetchAtendimento = useCallback(async () => {
    if (!atendimentoId) return;
    const res = await fetch(`${getApiBase()}/api/atendimentos/${atendimentoId}`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Atendimento não encontrado');
    setAtendimento(data.atendimento);
  }, [atendimentoId]);

  useEffect(() => {
    let cancelled = false;
    // Limpa dados do paciente anterior imediatamente para que os consumidores (ex. useMemedSinapse)
    // detectem a mudança de atendimento e resetem prescriptionOpenedOnce antes do fetch completar.
    setAtendimento(null);
    setLoading(true);
    (async () => {
      try {
        const sessionUser = await requireSession();
        if (cancelled) return;
        setUser(sessionUser);
        await fetchAtendimento();
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Sessão inválida');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAtendimento]);

  const hasReceipt = hasPersistedMemedReceipt(atendimento?.dados_clinicos);
  const receiptValidated = Boolean(atendimento?.dados_clinicos?.memed_receita?.validated_at);
  const status = normalizeStatus(atendimento?.status);

  const flags = useMemo(
    () => ({
      canApprove: ['waiting', 'em_atendimento', 'under_review', 'queue', 'triaged', 'fila'].includes(status),
      canEmit: ['approved', 'receita_em_edicao', 'receita_emitida', 'memed_processing'].includes(status),
      canValidate: hasReceipt && ['receita_emitida', 'memed_processing'].includes(status),
      canSend: hasReceipt && (receiptValidated || ['ready', 'receita_emitida'].includes(status)),
      canFinish: (hasReceipt && receiptValidated) || status === 'delivered',
      isDelivered: status === 'delivered',
    }),
    [status, hasReceipt, receiptValidated],
  );

  const saveClinical = useCallback(
    async (payload: Record<string, unknown>) => {
      setActionKey('save');
      setError(null);
      try {
        const res = await fetch(`${getApiBase()}/api/atendimentos/${atendimentoId}/clinical`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar prontuário');
        setAtendimento(data.atendimento);
        setToast('Prontuário salvo.');
        return true;
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar');
        return false;
      } finally {
        setActionKey(null);
      }
    },
    [atendimentoId],
  );

  const approve = useCallback(async () => {
    setActionKey('approve');
    setError(null);
    try {
      const result = await approveClinicalDecision(atendimentoId, {
        observacao_medica: motivo.trim() || undefined,
        motivo: motivo.trim() || 'Aprovado no Doctor Prescreve',
        conduta_medica: motivo.trim() || undefined,
      });
      if (result.usingMockFallback) throw new Error(result.error || 'Falha ao aprovar');
      await fetchAtendimento();
      setToast('Atendimento aprovado. Pronto para emitir receita.');
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao aprovar');
      return false;
    } finally {
      setActionKey(null);
    }
  }, [atendimentoId, motivo, fetchAtendimento]);

  const reject = useCallback(async () => {
    const selected = CLINICAL_REJECT_REASONS.find((r) => r.code === rejectReasonCode);
    const detail = motivo.trim();
    if (selected?.requiresDetail && detail.length < 5) {
      setError('Informe observações (mín. 5 caracteres) para o motivo selecionado.');
      return false;
    }
    setActionKey('reject');
    setError(null);
    try {
      const result = await rejectClinicalDecision(atendimentoId, {
        reason_code: rejectReasonCode,
        motivo: detail || undefined,
        observacao_medica: detail || undefined,
        mensagem_whatsapp: CLINICAL_REJECT_WHATSAPP_MESSAGE,
      });
      if (result.usingMockFallback) throw new Error(result.error || 'Falha ao reprovar');
      await fetchAtendimento();
      setToast('Atendimento reprovado. Automação notificada.');
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao reprovar');
      return false;
    } finally {
      setActionKey(null);
    }
  }, [atendimentoId, motivo, rejectReasonCode, fetchAtendimento]);

  const validateReceipt = useCallback(async () => {
    setActionKey('validate');
    setError(null);
    try {
      const result = await validatePrescription(atendimentoId);
      if (result.usingMockFallback && result.error) throw new Error(result.error);
      await fetchAtendimento();
      setToast('Receita validada.');
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao validar receita');
      return false;
    } finally {
      setActionKey(null);
    }
  }, [atendimentoId, fetchAtendimento]);

  const sendReceipt = useCallback(async () => {
    setActionKey('send');
    setError(null);
    try {
      if (flags.canValidate) await validatePrescription(atendimentoId);
      const result = await sendPrescriptionWhatsApp(atendimentoId);
      if (!result.data?.sent && result.error) throw new Error(result.error);
      await fetchAtendimento();
      setToast('Receita enviada ao paciente.');
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar receita');
      return false;
    } finally {
      setActionKey(null);
    }
  }, [atendimentoId, flags.canValidate, fetchAtendimento]);

  const finishAttendance = useCallback(async () => {
    setActionKey('finish');
    setError(null);
    try {
      if (!flags.isDelivered) {
        const sent = await sendPrescriptionWhatsApp(atendimentoId);
        if (!sent.data?.sent && sent.error && !sent.alreadySent) {
          throw new Error(sent.error);
        }
      }
      const res = await fetch(`${getApiBase()}/api/atendimentos/${atendimentoId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: 'delivered', motivo: 'Atendimento finalizado no Doctor Prescreve' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao finalizar');
      await fetchAtendimento();
      setToast('Atendimento finalizado.');
      router.push('/fila');
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao finalizar');
      return false;
    } finally {
      setActionKey(null);
    }
  }, [atendimentoId, flags.isDelivered, fetchAtendimento, router]);

  const openPrescription = useCallback(
    async (options?: { autoEmit?: boolean }) => {
      if (flags.canApprove) {
        const ok = await approve();
        if (!ok) return;
      }
      const query = new URLSearchParams({ atendimentoId });
      if (options?.autoEmit) query.set('emit', '1');
      router.push(`/receita?${query.toString()}`);
    },
    [atendimentoId, flags.canApprove, approve, router],
  );

  const runEligibility = useCallback(async () => {
    if (!atendimento) return;
    setActionKey('eligibility');
    try {
      const clinical = atendimento.dados_clinicos || {};
      await checkEligibility({
        condition: String(clinical.condition || atendimento.condicao || ''),
        previous_prescription: Boolean(clinical.previous_prescription),
        continuous_use_proof: Boolean(clinical.continuous_use_proof),
        flags: Array.isArray(clinical.flags) ? clinical.flags : [],
      });
      setToast('Elegibilidade reavaliada.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro na elegibilidade');
    } finally {
      setActionKey(null);
    }
  }, [atendimento]);

  return {
    user,
    atendimento,
    loading,
    error,
    setError,
    toast,
    setToast,
    motivo,
    setMotivo,
    rejectReasonCode,
    setRejectReasonCode,
    actionKey,
    hasReceipt,
    flags,
    refresh: fetchAtendimento,
    saveClinical,
    approve,
    reject,
    validateReceipt,
    sendReceipt,
    finishAttendance,
    openPrescription,
    runEligibility,
    rejectReasons: CLINICAL_REJECT_REASONS,
  };
}
