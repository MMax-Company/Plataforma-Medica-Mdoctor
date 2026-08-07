'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '@/services/api';
import { authHeaders } from '@/services/auth.service';
import {
  approveClinicalDecision,
  rejectClinicalDecision,
} from '@/services/clinical-decision';
import { formatQueuePatientId } from '@/lib/patient-display';
import { toPanelAtendimentoStatus } from '@/lib/atendimento-status';

export type ProntuarioAtendimento = {
  id: string;
  status: string;
  paciente_nome: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  condicao?: string;
  pagamento_status?: string;
  criado_em?: string;
  atualizado_em?: string;
  elegibilidade?: { eligible?: boolean; reason?: string } | null;
  dados_clinicos?: Record<string, unknown> & {
    condition?: string;
    nome_social?: string;
    social_name?: string;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Nomenclatura médica completa — não os códigos internos (has, dm2, dlp, hipo)
// nem os rótulos curtos do Typebot.
const CONDITION_LABELS: Array<{ label: string; terms: string[] }> = [
  { label: 'hipertensão arterial', terms: ['has', 'hipertensao', 'hipertensão', 'pressao alta', 'pressão alta'] },
  { label: 'diabetes mellitus tipo 2', terms: ['dm2', 'dm', 'diabetes'] },
  { label: 'dislipidemia', terms: ['dlp', 'dislipidemia', 'colesterol', 'triglicerides', 'triglicerídeos'] },
  { label: 'hipotireoidismo', terms: ['hipotireoidismo', 'tireoide', 'tiroide', 'levotiroxina'] },
];

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Lista médica das patologias informadas na triagem, ex.: "hipertensão arterial e dislipidemia". */
function buildPatologiasLabel(clinical: Record<string, unknown>) {
  const haystack = normalizeText(
    [clinical.doenca_cronica, clinical.chronic_condition, clinical.condition, clinical.condicao]
      .filter(Boolean)
      .join(' '),
  );
  const found = CONDITION_LABELS.filter((item) => item.terms.some((term) => haystack.includes(normalizeText(term)))).map(
    (item) => item.label,
  );
  if (!found.length) return 'condição crônica informada na triagem';
  if (found.length === 1) return found[0];
  return `${found.slice(0, -1).join(', ')} e ${found[found.length - 1]}`;
}

/** Tempo de uso contínuo, em texto legível, a partir dos dados reais da triagem. */
function buildTempoUsoLabel(clinical: Record<string, unknown>) {
  const daysRaw = clinical.continuous_use_days;
  const days = typeof daysRaw === 'number' ? daysRaw : Number(daysRaw);
  if (Number.isFinite(days) && days > 0) {
    // < 30 dias é cenário inelegível para renovação — não deve ser apresentado
    // como uma faixa clínica normal de uso contínuo.
    if (days < 30) return null;
    if (days < 90) return 'entre 30 dias e 3 meses';
    if (days < 180) return 'entre 3 e 6 meses';
    return 'há mais de 6 meses';
  }

  const text = normalizeText(clinical.tempo_uso);
  if (!text) return null;
  if (text.includes('mais_6') || text.includes('mais de 6')) return 'há mais de 6 meses';
  if (text.includes('3_a_6') || text.includes('3 a 6') || text.includes('3-6')) return 'entre 3 e 6 meses';
  if (text.includes('1_a_6') || text.includes('1 a 6') || text.includes('30') || text.includes('1 a 3') || text.includes('1-3')) {
    return 'entre 30 dias e 3 meses';
  }
  // "menos de 1 mês"/"menos de 30 dias" é o mesmo cenário inelegível acima —
  // tratado como dado incompatível, não como faixa válida.
  return null;
}

function buildQueixaPrincipal(clinical: Record<string, unknown>) {
  const patologias = buildPatologiasLabel(clinical);
  return `Solicita avaliação médica para continuidade de tratamento de ${patologias}, em uso regular das medicações informadas.`;
}

function buildHistoricoClinico(clinical: Record<string, unknown>) {
  const patologias = buildPatologiasLabel(clinical);
  const tempo = buildTempoUsoLabel(clinical);
  const tempoTrecho = tempo
    ? `com uso contínuo das medicações ${tempo}`
    : 'com tempo de uso contínuo das medicações não informado ou incompatível com os critérios de renovação';
  return `Refere diagnóstico prévio de ${patologias}, ${tempoTrecho}. Nega sinais de alerta, intercorrências recentes ou piora clínica. Dados e receita anterior avaliados conforme informações fornecidas pelo paciente.`;
}

const EXAME_FISICO_TEXT =
  'Atendimento realizado por telemedicina assíncrona, sem exame físico presencial. Avaliação baseada nas informações clínicas e documentos enviados. Ausência de achados objetivos não exclui alterações não identificáveis remotamente.';

const CONDUTA_APROVADA_TEXT =
  'Mantida a continuidade das medicações informadas, após análise dos dados clínicos e da receita anterior. Orientado manter acompanhamento médico periódico e procurar avaliação presencial em caso de sintomas novos, piora clínica, efeitos adversos ou sinais de alerta.';

type MotivoRejeicao = { label: string; detail: string | null };

function asMotivoRejeicao(value: unknown): MotivoRejeicao | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label.trim() : '';
  if (!label) return null;
  const detail = typeof record.detail === 'string' && record.detail.trim() ? record.detail.trim() : null;
  return { label, detail };
}

/**
 * Conduta médica real: só exibe o texto de continuidade em atendimentos
 * aprovados. Em reprovados:
 *  1) se o médico escreveu no campo "Conduta Médica Opcional" antes de
 *     reprovar, esse texto (dados_clinicos.conduta_medica) substitui
 *     integralmente a conduta padrão — nada de label/code/detail junto;
 *  2) se o campo ficou vazio, cai no motivo estruturado já existente
 *     (dados_clinicos.motivo_rejeicao.label) sem inventar texto clínico.
 */
function buildConduta(clinical: Record<string, unknown>) {
  const condutaMedica = formText(clinical.conduta_medica);
  if (condutaMedica) return condutaMedica;

  const motivo = asMotivoRejeicao(clinical.motivo_rejeicao);
  if (motivo) {
    return `Renovação não autorizada. Motivo: ${motivo.label}.`;
  }
  return CONDUTA_APROVADA_TEXT;
}

function buildAlergias(clinical: Record<string, unknown>) {
  const raw = formText(clinical.alergias);
  const normalized = normalizeText(raw);
  const negative = !raw || ['nao', 'não', 'nega', 'nenhuma', 'sem alergia', 'sem alergias', 'n/a', 'na'].some((term) =>
    normalized === term || normalized.startsWith(`${term} `),
  );
  if (negative) return 'Paciente nega alergias medicamentosas conhecidas.';
  return `Paciente refere alergia a ${raw.trim()}.`;
}

// Frequências como chegam da triagem (ex.: "12/12h", "24h", "8/8h") viradas em
// texto médico legível para o prontuário — a via/dose já vêm estruturadas.
function formatFrequencyLabel(frequency: unknown) {
  const raw = String(frequency ?? '').trim();
  if (!raw) return 'conforme orientação médica';
  const normalized = normalizeText(raw);

  const hourlyMatch = normalized.match(/^(\d+)\s*\/\s*(\d+)\s*h$/) || normalized.match(/^de\s*(\d+)\s*em\s*(\d+)\s*h(oras)?$/);
  if (hourlyMatch) return `a cada ${hourlyMatch[1]} horas`;

  const singleHourMatch = normalized.match(/^(\d+)\s*h$/);
  if (singleHourMatch) {
    const hours = Number(singleHourMatch[1]);
    if (hours === 24) return 'uma vez ao dia';
    return `a cada ${hours} horas`;
  }

  if (normalized.includes('1x') || normalized.includes('uma vez')) return 'uma vez ao dia';
  if (normalized.includes('2x') || normalized.includes('duas vezes')) return 'duas vezes ao dia';
  if (normalized.includes('3x') || normalized.includes('tres vezes') || normalized.includes('três vezes')) return 'três vezes ao dia';
  if (normalized.includes('4x') || normalized.includes('quatro vezes')) return 'quatro vezes ao dia';

  return raw;
}

function capitalizeFirst(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Lista dinâmica dos medicamentos informados na triagem, em texto médico. */
function formatMedications(clinical: Record<string, unknown>) {
  const medications = Array.isArray(clinical.medications) ? clinical.medications : [];
  if (!medications.length) return 'Nenhum medicamento estruturado informado na triagem.';
  return medications
    .map((entry) => {
      const med = asRecord(entry);
      const name = capitalizeFirst(firstText(med.name, med.label).trim());
      const dose = [med.dose, med.unit].filter(Boolean).join(' ').trim();
      const route = firstText(med.route, 'oral').toLowerCase();
      const frequency = formatFrequencyLabel(med.frequency);
      return `${name}${dose ? ` ${dose}` : ''} — via ${route}, ${frequency}.`;
    })
    .join('\n');
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
      queixa: buildQueixaPrincipal(c),
      historico: buildHistoricoClinico(c),
      exame: EXAME_FISICO_TEXT,
      alergias: buildAlergias(c),
      medicacao: formatMedications(c),
      conduta: buildConduta(c),
    };
  }, [atendimento]);

  const eligibilityMessage = useMemo(() => {
    const preferredOk = 'Paciente triado com sucesso pelo chatbot. Todos os critérios atendidos.';
    // O motivo salvo em elegibilidade.reason é gravado uma única vez no
    // upload da receita anterior ("Receita anterior recebida — aguardando
    // análise médica") e nunca é atualizado depois — para atendimento já
    // concluído/entregue, mostrar o estado real em vez desse texto obsoleto.
    const panelStatus = toPanelAtendimentoStatus(atendimento?.status);
    if (panelStatus === 'DELIVERED' || panelStatus === 'FINISHED') {
      return 'Atendimento concluído — prontuário disponível para consulta';
    }
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

    try {
      if (!storagePath) {
        setError('Nenhuma receita anexada foi informada na triagem.');
        return;
      }
      const res = await fetch(`${getApiBase()}/api/atendimentos/${atendimento.id}/previous-prescription/view-url`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.viewUrl) throw new Error(data.error || 'Não foi possível abrir a receita anexada.');
      window.open(String(data.viewUrl), '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir receita anexada.');
    }
  }

  async function approveAttendance() {
    if (!atendimentoId) return false;
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
    setActionLoading('reject');
    setError(null);
    try {
      const result = await rejectClinicalDecision(atendimentoId, {
        reason_code: 'FORA_DO_PROTOCOLO',
        observacao_medica: notes.trim() || undefined,
        motivo: notes.trim() || 'Atendimento reprovado pelo painel médico',
        // Só preenchido quando o médico realmente escreveu algo no campo
        // opcional — vira a conduta médica oficial do prontuário (ver
        // buildConduta). Vazio aqui = prontuário cai no motivo estruturado.
        conduta_medica: notes.trim() || undefined,
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
