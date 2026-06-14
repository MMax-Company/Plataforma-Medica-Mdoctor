'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '@/services/api';
import { authHeaders } from '@/services/auth.service';
import {
  approveClinicalDecision,
  rejectClinicalDecision,
} from '@/services/clinical-decision';
import { formatQueuePatientId } from '@/lib/patient-display';

export type ProntuarioAtendimento = {
  id: string;
  status: string;
  paciente_nome: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  condicao?: string;
  pagamento_status?: string;
  elegibilidade?: { eligible?: boolean; reason?: string } | null;
  dados_clinicos?: Record<string, unknown> & {
    condition?: string;
    data_nascimento?: string;
    birth_date?: string;
    idade?: string;
    age?: string;
    endereco?: string;
    address?: string;
    cep?: string;
    postal_code?: string;
    queixa_principal?: string;
    chief_complaint?: string;
    notes?: string;
    historico_clinico?: string;
    exame_fisico?: string;
    exame_fisico_telemedicina?: string;
    alergias?: string;
    medicacao_em_uso?: string;
    conduta?: string;
    conduta_medica?: string;
    conduta_sugerida?: string;
    flags?: string[];
    foto_receita_url?: string;
    previous_prescription_storage_path?: string;
    previous_prescription_url?: string;
    previous_prescription_file?: string;
    prescription_image_quality?: {
      grade: 'adequate' | 'marginal' | 'inadequate' | 'not_analyzed';
      score: number | null;
      analyzed_at: string;
      reason?: string;
      details?: {
        width: number;
        height: number;
        pixels: number;
        brightness: number;
        contrast: number;
        sharpness_variance: number;
        issues: string[];
      };
    };
  };
};

export type ClinicalEditForm = {
  queixa_principal: string;
  historico_clinico: string;
  exame_fisico: string;
  alergias: string;
  medicacao_em_uso: string;
  conduta: string;
  data_nascimento: string;
  endereco: string;
  cep: string;
  paciente_nome: string;
  paciente_telefone: string;
  paciente_cpf: string;
  paciente_email: string;
  condicao: string;
};

function firstText(...values: Array<unknown>) {
  const found = values.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof found === 'string' ? found : 'Não informado';
}

function formText(...values: Array<unknown>) {
  const found = values.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof found === 'string' ? found : '';
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'P';
  if (parts.length === 1) return parts[0].slice(0, 4).toUpperCase();
  return (parts[0][0] + (parts[parts.length - 1]?.[0] || '')).toUpperCase();
}

export function useProntuarioAtendimento(atendimentoId: string | null, enabled: boolean) {
  const [atendimento, setAtendimento] = useState<ProntuarioAtendimento | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<ClinicalEditForm | null>(null);

  const fetchAtendimento = useCallback(async () => {
    if (!atendimentoId) return;
    setError(null);
    setLoading(true);
    try {
      const { isVisualSimulationPatient, getVisualSimulationAtendimentos } = await import(
        '@/lib/visual-simulation-fila'
      );
      if (isVisualSimulationPatient(atendimentoId)) {
        const sim = getVisualSimulationAtendimentos().find((row) => row.id === atendimentoId);
        if (!sim) throw new Error('Paciente de simulação não encontrado');
        setAtendimento({
          ...sim,
          paciente_cpf: sim.dados_clinicos.paciente_cpf,
          elegibilidade: {
            eligible: true,
            reason: 'Paciente triado com sucesso pelo chatbot. Todos os critérios atendidos.',
          },
        } as ProntuarioAtendimento);
        return;
      }

      const res = await fetch(`${getApiBase()}/api/atendimentos/${atendimentoId}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Atendimento não encontrado');
      setAtendimento(data.atendimento);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar atendimento');
      setAtendimento(null);
    } finally {
      setLoading(false);
    }
  }, [atendimentoId]);

  useEffect(() => {
    if (!enabled || !atendimentoId) {
      setAtendimento(null);
      setEditing(false);
      setEditForm(null);
      setNotes('');
      return;
    }
    void fetchAtendimento();
  }, [enabled, atendimentoId, fetchAtendimento]);

  const clinical = atendimento?.dados_clinicos || {};

  const displayBlocks = useMemo(() => {
    if (!atendimento) return null;
    const c = atendimento.dados_clinicos || {};
    return {
      queixa: firstText(c.queixa_principal, c.chief_complaint, c.notes, atendimento.condicao, c.condition),
      historico: firstText(
        c.historico_clinico,
        c.doenca_cronica,
        'Paciente faz uso de medicação para doença crônica de forma contínua.',
      ),
      exame: firstText(c.exame_fisico, c.exame_fisico_telemedicina, 'Paciente nega alterações físicas ou clínicas relevantes.'),
      alergias: firstText(c.alergias, 'Nega alergias medicamentosas ou alimentares.'),
      medicacao: firstText(c.medicacao_em_uso, 'Já declarado na teletriagem.'),
      conduta: firstText(
        c.conduta,
        c.conduta_medica,
        c.conduta_sugerida,
        'Renovação de prescrição após validação médica.',
      ),
    };
  }, [atendimento]);

  const eligibilityMessage = useMemo(() => {
    const preferredOk = 'Paciente triado com sucesso pelo chatbot. Todos os critérios atendidos.';
    if (atendimento?.elegibilidade?.eligible === false) {
      return atendimento.elegibilidade.reason || 'Critérios de elegibilidade não atendidos.';
    }
    const reason = (atendimento?.elegibilidade?.reason || '').trim();
    if (!reason || /baixo risco|filtrado como|renovação clínica coerente/i.test(reason)) {
      return preferredOk;
    }
    return reason;
  }, [atendimento]);

  const hasAttachedPrescription = Boolean(
    clinical.previous_prescription_storage_path ||
      clinical.previous_prescription_url ||
      clinical.foto_receita_url ||
      clinical.previous_prescription_file,
  );

  function buildEditForm(record: ProntuarioAtendimento): ClinicalEditForm {
    const c = record.dados_clinicos || {};
    return {
      paciente_nome: record.paciente_nome || '',
      paciente_telefone: record.paciente_telefone || '',
      paciente_cpf: record.paciente_cpf || '',
      paciente_email: record.paciente_email || '',
      condicao: record.condicao || String(c.condition || ''),
      data_nascimento: formText(c.data_nascimento, c.birth_date),
      endereco: formText(c.endereco, c.address),
      cep: formText(c.cep, c.postal_code),
      queixa_principal: formText(c.queixa_principal, c.notes),
      historico_clinico: formText(c.historico_clinico),
      exame_fisico: formText(c.exame_fisico),
      alergias: formText(c.alergias),
      medicacao_em_uso: formText(c.medicacao_em_uso),
      conduta: formText(c.conduta, c.conduta_medica),
    };
  }

  function startEditing() {
    if (!atendimento) return;
    setEditForm(buildEditForm(atendimento));
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditForm(null);
  }

  function updateEditField(field: keyof ClinicalEditForm, value: string) {
    setEditForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function saveClinicalEdit() {
    if (!atendimentoId || !editForm) return false;
    setActionLoading('save');
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${atendimentoId}/clinical`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          paciente_nome: editForm.paciente_nome,
          paciente_telefone: editForm.paciente_telefone,
          paciente_cpf: editForm.paciente_cpf,
          paciente_email: editForm.paciente_email,
          condicao: editForm.condicao,
          dados_clinicos: {
            condition: editForm.condicao,
            data_nascimento: editForm.data_nascimento,
            endereco: editForm.endereco,
            cep: editForm.cep,
            queixa_principal: editForm.queixa_principal,
            historico_clinico: editForm.historico_clinico,
            exame_fisico: editForm.exame_fisico,
            alergias: editForm.alergias,
            medicacao_em_uso: editForm.medicacao_em_uso,
            conduta: editForm.conduta,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar prontuário');
      setAtendimento(data.atendimento);
      setEditing(false);
      setEditForm(null);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar prontuário');
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  async function viewAttachedPrescription() {
    if (!atendimento) return;
    setError(null);
    const c = atendimento.dados_clinicos || {};
    const storagePath = String(c.previous_prescription_storage_path || '');
    const directUrl = String(c.previous_prescription_url || c.foto_receita_url || c.previous_prescription_file || '');

    try {
      if (storagePath || directUrl.includes('/storage/v1/object/')) {
        const res = await fetch(`${getApiBase()}/api/atendimentos/${atendimento.id}/previous-prescription/view-url`, {
          headers: authHeaders(),
        });
        const data = await res.json();
        if (!res.ok || !data.viewUrl) throw new Error(data.error || 'Não foi possível abrir a receita anexada.');
        window.open(String(data.viewUrl), '_blank', 'noopener,noreferrer');
        return;
      }
      if (!directUrl) {
        setError('Nenhuma receita anexada foi informada na triagem.');
        return;
      }
      window.open(directUrl, '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir receita anexada.');
    }
  }

  async function approveAttendance() {
    if (!atendimentoId) return false;
    const { isVisualSimulationPatient } = await import('@/lib/visual-simulation-fila');
    if (isVisualSimulationPatient(atendimentoId)) return true;

    setActionLoading('approve');
    setError(null);
    try {
      const result = await approveClinicalDecision(atendimentoId, {
        observacao_medica: notes.trim() || undefined,
        motivo: notes.trim() || 'Atendimento aprovado no Doctor Prescreve',
        conduta_medica: notes.trim() || undefined,
      });
      if (result.usingMockFallback) throw new Error(result.error || 'Falha ao aprovar atendimento.');
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao aprovar atendimento');
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  async function rejectAttendance() {
    if (!atendimentoId) return false;
    const { isVisualSimulationPatient } = await import('@/lib/visual-simulation-fila');
    if (isVisualSimulationPatient(atendimentoId)) return true;

    setActionLoading('reject');
    setError(null);
    try {
      const result = await rejectClinicalDecision(atendimentoId, {
        reason_code: 'FORA_DO_PROTOCOLO',
        observacao_medica: notes.trim() || undefined,
        motivo: notes.trim() || 'Atendimento reprovado pelo painel médico',
      });
      if (result.usingMockFallback) throw new Error(result.error || 'Falha ao reprovar atendimento.');
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao reprovar atendimento');
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  return {
    atendimento,
    clinical,
    displayBlocks,
    eligibilityMessage,
    loading,
    error,
    setError,
    notes,
    setNotes,
    editing,
    editForm,
    actionLoading,
    hasAttachedPrescription,
    fetchAtendimento,
    startEditing,
    cancelEditing,
    updateEditField,
    saveClinicalEdit,
    viewAttachedPrescription,
    approveAttendance,
    rejectAttendance,
    initials,
    firstText,
    formatRecordId: (id: string) => formatQueuePatientId(id),
  };
}
