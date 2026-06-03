'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase, checkEligibility } from '@/services/api';
import { authHeaders, getAuthUser, logout, requireSession, type AuthUser } from '@/services/auth.service';
import {
  approveClinicalDecision,
  CLINICAL_REJECT_REASONS,
  CLINICAL_REJECT_WHATSAPP_MESSAGE,
  rejectClinicalDecision,
  type ClinicalRejectReasonCode,
} from '@/services/clinical-decision';
import { sendPrescriptionWhatsApp, validatePrescription } from '@/services/prescriptions';
import { MedicalActionRail } from '@/components/medical/MedicalActionRail';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';
import { Button, Card, StatusPill } from '@/components/ui/DesignSystem';

type AtendimentoStatus =
  | 'TRIAGED'
  | 'QUEUE'
  | 'UNDER_REVIEW'
  | 'MEMED_PROCESSING'
  | 'AWAITING_VALIDATION'
  | 'VALIDATED'
  | 'FINISHED'
  | 'REJECTED'
  | 'DELIVERED'
  | 'TRIAGEM'
  | 'AGUARDANDO_PAGAMENTO'
  | 'FILA'
  | 'EM_ATENDIMENTO'
  | 'PRONTO_PARA_DECISAO'
  | 'APROVADO'
  | 'RECUSADO'
  | 'RECEITA_EMITIDA'
  | 'CANCELADO';

type Atendimento = {
  id: string;
  status: AtendimentoStatus;
  paciente_nome: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  condicao?: string;
  pagamento_status?: string;
  risco?: string | null;
  motivo_decisao?: string | null;
  criado_em?: string;
  atualizado_em?: string;
  elegibilidade?: { eligible?: boolean; reason?: string } | null;
  dados_clinicos?: Record<string, unknown> & {
    condition?: string;
    previous_prescription?: boolean;
    continuous_use_proof?: boolean;
    flags?: string[];
    medicacao_em_uso?: string;
    doenca_cronica?: string;
    queixa_principal?: string;
    historico_clinico?: string;
    exame_fisico?: string;
    alergias?: string;
    conduta?: string;
    foto_receita_url?: string;
    memed_receita?: {
      receitaUrl?: string;
      pdfUrl?: string;
      receitaId?: string;
      gerada_em?: string;
    };
  };
};

type DecisaoLog = {
  id: string;
  status_anterior?: string | null;
  status_novo: string;
  motivo?: string | null;
  medico_id?: string | null;
  snapshot?: Record<string, any>;
  criado_em?: string;
};

type ClinicalEditForm = {
  paciente_nome: string;
  paciente_telefone: string;
  paciente_cpf: string;
  paciente_email: string;
  condicao: string;
  pagamento_status: string;
  data_nascimento: string;
  endereco: string;
  cep: string;
  queixa_principal: string;
  historico_clinico: string;
  exame_fisico: string;
  alergias: string;
  medicacao_em_uso: string;
  conduta: string;
  foto_receita_url: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'P') + (parts[1]?.[0] || '');
}

function formatDate(value?: string) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function boolLabel(value?: boolean) {
  return value ? 'Sim' : 'Não';
}

function firstText(...values: Array<unknown>) {
  const found = values.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof found === 'string' ? found : 'Não informado';
}

function formText(...values: Array<unknown>) {
  const found = values.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof found === 'string' ? found : '';
}

function statusLabel(status?: string) {
  const normalized = String(status || '').toLowerCase();
  const labels: Record<string, string> = {
    waiting: 'Aguardando',
    em_atendimento: 'Em atendimento',
    approved: 'Aprovado — emitir receita',
    receita_em_edicao: 'Receita em edição (Memed)',
    receita_emitida: 'Receita emitida — validar',
    memed_processing: 'Receita emitida — validar',
    ready: 'Pronta para entrega',
    delivered: 'Entregue',
    rejected: 'Reprovado'
  };
  return labels[normalized] || status || 'Desconhecido';
}

function canEmitReceipt(status?: string) {
  const normalized = String(status || '').toLowerCase();
  return ['approved', 'receita_em_edicao', 'receita_emitida', 'memed_processing'].includes(normalized);
}

function canValidateReceipt(status: string | undefined, hasReceipt: boolean) {
  const normalized = String(status || '').toLowerCase();
  return hasReceipt && ['receita_emitida', 'memed_processing'].includes(normalized);
}

function canSendReceipt(status: string | undefined, hasReceipt: boolean) {
  const normalized = String(status || '').toLowerCase();
  return hasReceipt && ['ready', 'receita_emitida', 'memed_processing', 'validated'].includes(normalized);
}

function canFinishAttendance(status: string | undefined, hasReceipt: boolean) {
  const normalized = String(status || '').toLowerCase();
  return hasReceipt && !['delivered', 'rejected', 'cancelado'].includes(normalized);
}

function canApproveStatus(status?: string) {
  const normalized = String(status || '').toLowerCase();
  return ['waiting', 'em_atendimento', 'under_review', 'queue', 'triaged', 'fila'].includes(normalized);
}

export default function AtendimentoPage({ params }: { params: { id: string } }) {
  const [atendimento, setAtendimento] = useState<Atendimento | null>(null);
  const [decisoes, setDecisoes] = useState<DecisaoLog[]>([]);
  const [motivo, setMotivo] = useState('');
  const [rejectReasonCode, setRejectReasonCode] = useState<ClinicalRejectReasonCode>('FORA_DO_PROTOCOLO');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<ClinicalEditForm | null>(null);

  const latestReceipt = useMemo(() => {
    const direct = atendimento?.dados_clinicos?.memed_receita;
    if (direct?.receitaUrl || direct?.pdfUrl) return direct;

    const decisionReceipt = decisoes.find((item) => item.snapshot?.receitaUrl || item.snapshot?.pdfUrl)?.snapshot;
    return decisionReceipt
      ? {
          receitaUrl: decisionReceipt.receitaUrl,
          pdfUrl: decisionReceipt.pdfUrl,
          receitaId: decisionReceipt.receitaId,
          gerada_em: decisionReceipt.gerada_em
        }
      : null;
  }, [atendimento, decisoes]);

  const clinicalBlocks = useMemo(() => {
    const clinical = atendimento?.dados_clinicos || {};
    return [
      {
        title: 'Queixa Principal',
        value: firstText(clinical.queixa_principal, clinical.chief_complaint, clinical.notes, atendimento?.condicao, clinical.condition)
      },
      {
        title: 'Histórico Clínico',
        value: firstText(
          clinical.historico_clinico,
          clinical.doenca_cronica,
          `Paciente em renovação de receita para ${atendimento?.condicao || clinical.condition || 'condição não informada'}.`
        )
      },
      {
        title: 'Exame Físico',
        value: firstText(clinical.exame_fisico, clinical.exame_fisico_telemedicina, 'Sem sinais de urgência informados na triagem.')
      },
      {
        title: 'Alergias',
        value: firstText(clinical.alergias, Array.isArray(clinical.flags) && clinical.flags.length ? clinical.flags.join(', ') : 'Não informadas')
      },
      {
        title: 'Medicações em Uso',
        value: firstText(clinical.medicacao_em_uso, 'Não informado')
      },
      {
        title: 'Conduta Médica',
        value: firstText(clinical.conduta, clinical.conduta_medica, clinical.conduta_sugerida, motivo, 'Renovação de prescrição após validação médica.')
      }
    ];
  }, [atendimento, motivo]);

  const fetchAtendimento = useCallback(async () => {
    setError(null);
    try {
      const [detailRes, decisionsRes] = await Promise.all([
        fetch(`${getApiBase()}/api/atendimentos/${params.id}`, { headers: authHeaders() }),
        fetch(`${getApiBase()}/api/atendimentos/${params.id}/decisoes`, { headers: authHeaders() })
      ]);
      const detail = await detailRes.json();
      const history = await decisionsRes.json();
      if (!detailRes.ok || !detail.success) throw new Error(detail.error || 'Atendimento não encontrado');
      setAtendimento(detail.atendimento);
      if (history.success) setDecisoes(history.decisoes);
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar atendimento');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    const cachedUser = getAuthUser();
    if (cachedUser) setUser(cachedUser);

    requireSession()
      .then((sessionUser) => {
        setUser(sessionUser);
        return fetchAtendimento();
      })
      .catch((e: any) => {
        setError(e.message || 'Sessão expirada. Faça login novamente.');
        window.location.href = '/login';
      });
  }, [fetchAtendimento]);

  async function updateStatus(status: AtendimentoStatus, requiresReason = false, reasonOverride?: string) {
    const finalReason = reasonOverride?.trim() || motivo.trim();

    if (requiresReason && !finalReason) {
      setError('Informe o motivo antes de reprovar o atendimento.');
      return false;
    }

    setActionLoading(status);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${params.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          status,
          motivo: finalReason || `Status alterado para ${status}`
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao atualizar atendimento');
      setAtendimento(data.atendimento);
      setMotivo('');
      await fetchAtendimento();
      return true;
    } catch (e: any) {
      setError(e.message || 'Erro ao atualizar atendimento');
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  async function rejectAttendance() {
    const selectedReason = CLINICAL_REJECT_REASONS.find((item) => item.code === rejectReasonCode);
    const detail = motivo.trim();
    if (selectedReason?.requiresDetail && detail.length < 5) {
      setError('Para o motivo "Outros", informe observações com pelo menos 5 caracteres.');
      return;
    }

    setActionLoading('reject');
    setError(null);
    try {
      const result = await rejectClinicalDecision(String(params.id), {
        reason_code: rejectReasonCode,
        motivo: detail || undefined,
        observacao_medica: detail || undefined,
        mensagem_whatsapp: CLINICAL_REJECT_WHATSAPP_MESSAGE,
      });
      if (result.usingMockFallback) {
        throw new Error(result.error || 'Falha ao reprovar atendimento.');
      }
      setMotivo('');
      await fetchAtendimento();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao reprovar atendimento');
    } finally {
      setActionLoading(null);
    }
  }

  async function approveAttendance() {
    setActionLoading('approve');
    setError(null);
    try {
      const result = await approveClinicalDecision(String(params.id), {
        observacao_medica: motivo.trim() || undefined,
        motivo: motivo.trim() || 'Atendimento aprovado no Doctor Prescreve',
        conduta_medica: motivo.trim() || undefined,
      });
      if (result.usingMockFallback) {
        throw new Error(result.error || 'Falha ao aprovar atendimento.');
      }
      await fetchAtendimento();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao aprovar atendimento');
    } finally {
      setActionLoading(null);
    }
  }

  async function openPrescriptionModule() {
    if (canApproveStatus(atendimento?.status)) {
      await approveAttendance();
    }
    window.location.href = `/receita?atendimentoId=${params.id}&emit=1`;
  }

  async function sendReceiptToPatient() {
    setActionLoading('send');
    setError(null);
    try {
      if (canValidateReceipt(atendimento?.status, Boolean(latestReceipt?.receitaId || latestReceipt?.pdfUrl))) {
        await validatePrescription(String(params.id));
      }
      const result = await sendPrescriptionWhatsApp(String(params.id));
      if (!result.data?.sent && result.error) throw new Error(result.error);
      await fetchAtendimento();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar receita');
    } finally {
      setActionLoading(null);
    }
  }

  async function finishAttendance() {
    setActionLoading('finish');
    setError(null);
    try {
      if (String(atendimento?.status || '').toLowerCase() !== 'delivered') {
        await sendPrescriptionWhatsApp(String(params.id));
      }
      const res = await fetch(`${getApiBase()}/api/atendimentos/${params.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: 'delivered', motivo: 'Finalizado no Doctor Prescreve' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao finalizar');
      window.location.href = '/fila';
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao finalizar atendimento');
    } finally {
      setActionLoading(null);
    }
  }

  async function acceptPrescription() {
    setActionLoading('VALIDATED');
    setError(null);
    try {
      const result = await validatePrescription(String(params.id));
      if (result.usingMockFallback) {
        throw new Error(result.error || 'Falha ao validar receita.');
      }
      await fetchAtendimento();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao validar receita');
    } finally {
      setActionLoading(null);
    }
  }

  function viewPrescription() {
    const url = latestReceipt?.pdfUrl || latestReceipt?.receitaUrl;
    if (!url) {
      setError('Nenhuma receita disponível para visualização.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function viewAttachedPrescription() {
    if (!atendimento) return;
    setError(null);
    const clinical = atendimento.dados_clinicos || {};
    const storagePath = String(clinical.previous_prescription_storage_path || '');
    const directUrl = String(
      clinical.previous_prescription_url || clinical.foto_receita_url || clinical.previous_prescription_file || ''
    );

    try {
      if (storagePath || directUrl.includes('/storage/v1/object/')) {
        const res = await fetch(`${getApiBase()}/api/atendimentos/${atendimento.id}/previous-prescription/view-url`, {
          headers: authHeaders()
        });
        const data = await res.json();
        if (!res.ok || !data.viewUrl) {
          throw new Error(data.error || 'Não foi possível abrir a receita anexada.');
        }
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

  async function handleLogout() {
    await logout();
    window.location.href = '/login';
  }

  function openEditModal() {
    if (!atendimento) return;
    const clinical = atendimento.dados_clinicos || {};
    setEditForm({
      paciente_nome: atendimento.paciente_nome || '',
      paciente_telefone: atendimento.paciente_telefone || '',
      paciente_cpf: atendimento.paciente_cpf || '',
      paciente_email: atendimento.paciente_email || '',
      condicao: atendimento.condicao || String(clinical.condition || ''),
      pagamento_status: atendimento.pagamento_status || 'PENDENTE',
      data_nascimento: formText(clinical.data_nascimento, clinical.birth_date),
      endereco: formText(clinical.endereco, clinical.address),
      cep: formText(clinical.cep, clinical.postal_code),
      queixa_principal: formText(clinical.queixa_principal, clinical.notes),
      historico_clinico: formText(clinical.historico_clinico),
      exame_fisico: formText(clinical.exame_fisico),
      alergias: formText(clinical.alergias),
      medicacao_em_uso: formText(clinical.medicacao_em_uso),
      conduta: formText(clinical.conduta),
      foto_receita_url: formText(clinical.foto_receita_url)
    });
    setEditing(true);
  }

  function updateEditField(field: keyof ClinicalEditForm, value: string) {
    setEditForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function saveClinicalEdit() {
    if (!editForm) return;
    setActionLoading('clinical-edit');
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${params.id}/clinical`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          paciente_nome: editForm.paciente_nome,
          paciente_telefone: editForm.paciente_telefone,
          paciente_cpf: editForm.paciente_cpf,
          paciente_email: editForm.paciente_email,
          condicao: editForm.condicao,
          pagamento_status: editForm.pagamento_status,
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
            foto_receita_url: editForm.foto_receita_url
          }
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar prontuário');
      setAtendimento(data.atendimento);
      setEditing(false);
      setEditForm(null);
      await fetchAtendimento();
    } catch (e: any) {
      setError(e.message || 'Erro ao salvar prontuário');
    } finally {
      setActionLoading(null);
    }
  }

  async function runEligibility() {
    if (!atendimento) return;
    setActionLoading('eligibility');
    setError(null);
    try {
      const clinical = atendimento.dados_clinicos || {};
      const decision = await checkEligibility({
        condition: String(clinical.condition || atendimento.condicao || ''),
        previous_prescription: Boolean(clinical.previous_prescription),
        continuous_use_proof: Boolean(clinical.continuous_use_proof),
        flags: Array.isArray(clinical.flags) ? clinical.flags : []
      });
      await updateStatus(
        decision.eligible ? 'UNDER_REVIEW' : 'REJECTED',
        !decision.eligible,
        decision.reason || 'Reavaliação automática de elegibilidade'
      );
    } catch (e: any) {
      setError(e.message || 'Erro ao avaliar elegibilidade');
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) return <main className="min-h-screen bg-[#F8FAFC] p-6 text-sm text-[#5B6475]">Carregando prontuário...</main>;

  if (error && !atendimento) {
    return (
      <main className="min-h-screen bg-[#F8FAFC] p-6">
        <a href="/fila" className="text-sm font-bold text-[#1557FF]">Voltar para fila</a>
        <div className="mt-4 rounded-[14px] border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      </main>
    );
  }

  if (!atendimento) return null;

  const clinical = atendimento.dados_clinicos || {};

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#080D33]">
      <MedicalPanelHeader compact onLogout={handleLogout} />

      <section className="dp-panel-shell pb-28 pt-2">
        <div className="mb-2 grid items-center gap-2 md:grid-cols-[auto_1fr]">
          <a
            href="/fila"
            className="inline-flex h-10 items-center justify-center rounded-[8px] border border-[#D8DFEA] bg-white px-4 text-panel-sm font-bold shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition hover:-translate-y-0.5"
          >
            ← Voltar para painel
          </a>
          <div className="text-center md:text-left">
            <h1 className="text-panel-xl font-bold">Prontuário médico</h1>
            <p className="mt-1 text-panel-sm text-[#5B6475]">Avalie as informações do paciente e aprove o atendimento</p>
          </div>
        </div>

        <div className="mb-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#0BA84F] text-lg text-white">✓</span>
              <div>
              <p className="text-panel-sm font-bold text-[#080D33]">Critérios de elegibilidade</p>
              <p className="mt-0.5 text-panel-xs text-[#080D33]">
                {atendimento.elegibilidade?.reason || 'Todos os critérios informados foram analisados.'}
              </p>
              </div>
            </div>
            <StatusPill tone="success">Verificado</StatusPill>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
          <section className="space-y-5">
            <Card className="h-full rounded-[8px] p-4 sm:p-5">
              <h3 className="mb-4 text-panel-sm font-bold">Dados do paciente</h3>
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-base font-bold text-[#1557FF]">
                  {initials(atendimento.paciente_nome)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-panel-lg font-bold">{atendimento.paciente_nome}</h2>
                    <span className="rounded-[8px] bg-[#EEF4FF] px-2 py-0.5 text-panel-xs font-bold text-[#1557FF]">
                      {firstText(clinical.idade, clinical.age, '36 anos')}
                    </span>
                  </div>
                  <p className="mt-1 text-panel-xs font-medium">Prontuário: <span className="text-[#1557FF]">#{atendimento.id.slice(0, 8).toUpperCase()}</span></p>
                  <p className="mt-2 text-panel-xs font-medium text-[#0BA84F]">Contato via WhatsApp</p>
                </div>
              </div>

              <dl className="mt-4 grid gap-3 text-panel-sm">
                {[
                  ['Data de nascimento', firstText(clinical.data_nascimento, clinical.birth_date)],
                  ['CPF', atendimento.paciente_cpf || 'Não informado'],
                  ['E-mail', atendimento.paciente_email || 'Não informado'],
                  ['WhatsApp', atendimento.paciente_telefone || 'Não informado'],
                  ['Endereço', firstText(clinical.endereco, clinical.address)],
                  ['CEP', firstText(clinical.cep, clinical.postal_code)]
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[1fr_1.2fr] gap-3 border-b border-[#E5EAF2] pb-3 last:border-0">
                    <dt className="font-medium text-[#26325F]">{label}</dt>
                    <dd className="text-right font-semibold text-[#080D33]">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </section>

          <section className="space-y-5">
              <div className="max-h-[40vh] overflow-y-auto rounded-[8px] border border-[#E5EAF2] bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-panel-sm font-bold">História clínica</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={viewAttachedPrescription}
                    tone="secondary"
                    className="h-10 rounded-[8px] text-panel-xs"
                    disabled={
                      !String(
                        clinical.previous_prescription_storage_path ||
                          clinical.previous_prescription_url ||
                          clinical.foto_receita_url ||
                          clinical.previous_prescription_file ||
                          ''
                      )
                    }
                  >
                    ▤ RECEITA ANEXADA — VISUALIZAR IMAGEM
                  </Button>
                  <Button
                    onClick={openEditModal}
                    tone="soft"
                    className="h-10 rounded-[8px] text-panel-xs"
                  >
                    Editar
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-2 lg:grid-cols-2">
                {clinicalBlocks.map((block, index) => (
                  <Card key={block.title} className={`${index < 3 || block.title === 'Conduta Médica' ? 'lg:col-span-2' : ''} rounded-[8px] p-3`}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#EEF4FF] text-sm font-bold text-[#080D33]">
                        {['☏', '▤', '♬', '♢', '◒', '☑'][index]}
                      </span>
                      <h3 className="text-panel-xs font-bold uppercase">{block.title}</h3>
                    </div>
                    <p className="text-panel-sm leading-6 text-[#080D33]">{block.value}</p>
                  </Card>
                ))}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-[14px] border border-[#D6E4FF] bg-gradient-to-br from-white to-[#F8FAFF] p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-[#080D33]">Prescrição digital integrada</h3>
                  <StatusPill tone={canValidateReceipt(atendimento.status, Boolean(latestReceipt?.receitaId)) ? 'success' : 'secondary'}>
                    {statusLabel(atendimento.status)}
                  </StatusPill>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#5B6475]">
                  Emissão dentro do Doctor Prescreve — paciente, medicamentos e orientações já preparados. Assinatura digital na
                  mesma sessão.
                </p>
                {latestReceipt?.receitaId ? (
                  <p className="mt-2 text-xs font-bold text-[#5B6475]">Receita: {latestReceipt.receitaId}</p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void openPrescriptionModule()}
                    className="inline-flex h-10 items-center justify-center rounded-[10px] bg-[#1557FF] px-4 text-xs font-bold text-white"
                  >
                    Abrir módulo de prescrição
                  </button>
                  <button
                    type="button"
                    onClick={viewPrescription}
                    disabled={!latestReceipt?.receitaUrl && !latestReceipt?.pdfUrl}
                    className="inline-flex h-10 items-center justify-center rounded-[10px] border border-[#D8DFEA] bg-white px-4 text-xs font-bold disabled:opacity-50"
                  >
                    Visualizar PDF
                  </button>
                </div>
              </div>

              <div className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                <h3 className="text-sm font-black">HISTÓRICO</h3>
                <div className="mt-4 max-h-64 space-y-3 overflow-y-auto">
                  {decisoes.length ? (
                    decisoes.map((item) => (
                      <div key={item.id} className="rounded-[14px] border border-[#E5EAF2] p-3 text-sm">
                        <p className="font-bold text-[#1E1E1E]">
                          {item.status_anterior || 'Inicial'} {'->'} {item.status_novo}
                        </p>
                        <p className="mt-1 text-[#5B6475]">{item.motivo || 'Sem motivo informado'}</p>
                        <p className="mt-2 text-xs text-[#5B6475]">{formatDate(item.criado_em)}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-[14px] border border-dashed border-[#E5EAF2] p-4 text-center text-sm text-[#5B6475]">
                      Nenhuma decisão registrada
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>

      <MedicalActionRail
        motivo={motivo}
        onMotivoChange={setMotivo}
        rejectReasonCode={rejectReasonCode}
        onRejectReasonChange={setRejectReasonCode}
        rejectReasons={CLINICAL_REJECT_REASONS}
        actionKey={actionLoading}
        flags={{
          canApprove: canApproveStatus(atendimento.status),
          canEmit: canEmitReceipt(atendimento.status) || canApproveStatus(atendimento.status),
          canSend: canSendReceipt(atendimento.status, Boolean(latestReceipt?.receitaId || latestReceipt?.pdfUrl)),
          canFinish: canFinishAttendance(atendimento.status, Boolean(latestReceipt?.receitaId || latestReceipt?.pdfUrl)),
          isDelivered: String(atendimento.status).toLowerCase() === 'delivered',
        }}
        hasReceipt={Boolean(latestReceipt?.receitaId || latestReceipt?.pdfUrl || latestReceipt?.receitaUrl)}
        onApprove={() => void approveAttendance()}
        onReject={() => void rejectAttendance()}
        onSave={() => {
          if (!atendimento) return;
          const clinical = atendimento.dados_clinicos || {};
          void (async () => {
            setActionLoading('save');
            try {
              const res = await fetch(`${getApiBase()}/api/atendimentos/${params.id}/clinical`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                  dados_clinicos: { ...clinical, conduta: motivo.trim() || clinical.conduta },
                }),
              });
              const data = await res.json();
              if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao salvar');
              await fetchAtendimento();
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Erro ao salvar');
            } finally {
              setActionLoading(null);
            }
          })();
        }}
        onEmit={() => void openPrescriptionModule()}
        onSend={() => void sendReceiptToPatient()}
        onFinish={() => void finishAttendance()}
      />

      {editing && editForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/35 p-4">
          <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">EDITAR PRONTUÁRIO</h2>
                <p className="text-sm text-[#5B6475]">Atualize dados clínicos e informações do paciente</p>
              </div>
              <button
                onClick={() => setEditing(false)}
                className="h-10 rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-bold"
              >
                FECHAR
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {[
                ['paciente_nome', 'Nome do paciente'],
                ['paciente_telefone', 'Telefone'],
                ['paciente_cpf', 'CPF'],
                ['paciente_email', 'E-mail'],
                ['condicao', 'Condição'],
                ['pagamento_status', 'Pagamento'],
                ['data_nascimento', 'Data de nascimento'],
                ['cep', 'CEP'],
                ['endereco', 'Endereço'],
                ['foto_receita_url', 'URL da receita anexada']
              ].map(([field, label]) => (
                <label key={field} className="text-sm font-bold text-[#1E1E1E]">
                  {label}
                  <input
                    value={editForm[field as keyof ClinicalEditForm]}
                    onChange={(event) => updateEditField(field as keyof ClinicalEditForm, event.target.value)}
                    className="mt-2 h-11 w-full rounded-[14px] border border-[#E5EAF2] px-4 text-sm outline-none focus:border-[#1557FF]"
                  />
                </label>
              ))}
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {[
                ['queixa_principal', 'Queixa principal'],
                ['historico_clinico', 'Histórico clínico'],
                ['exame_fisico', 'Exame físico'],
                ['alergias', 'Alergias'],
                ['medicacao_em_uso', 'Medicações em uso'],
                ['conduta', 'Conduta médica']
              ].map(([field, label]) => (
                <label key={field} className="text-sm font-bold text-[#1E1E1E]">
                  {label}
                  <textarea
                    value={editForm[field as keyof ClinicalEditForm]}
                    onChange={(event) => updateEditField(field as keyof ClinicalEditForm, event.target.value)}
                    className="mt-2 min-h-24 w-full resize-none rounded-[14px] border border-[#E5EAF2] p-4 text-sm outline-none focus:border-[#1557FF]"
                  />
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setEditing(false)}
                className="h-11 rounded-[14px] border border-[#1E1E1E] bg-white px-5 text-xs font-bold"
              >
                CANCELAR
              </button>
              <button
                onClick={saveClinicalEdit}
                disabled={actionLoading === 'clinical-edit'}
                className="h-11 rounded-[14px] bg-[#1557FF] px-5 text-xs font-bold text-white disabled:opacity-50"
              >
                {actionLoading === 'clinical-edit' ? 'SALVANDO...' : 'SALVAR PRONTUÁRIO'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
