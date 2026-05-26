'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_BASE, checkEligibility } from '@/services/api';
import { authHeaders, clearSession, getAuthUser, requireSession, type AuthUser } from '@/services/auth.service';

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

export default function AtendimentoPage({ params }: { params: { id: string } }) {
  const [atendimento, setAtendimento] = useState<Atendimento | null>(null);
  const [decisoes, setDecisoes] = useState<DecisaoLog[]>([]);
  const [motivo, setMotivo] = useState('');
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
        value: firstText(clinical.queixa_principal, clinical.notes, atendimento?.condicao, clinical.condition)
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
        value: firstText(clinical.exame_fisico, 'Sem sinais de urgência informados na triagem.')
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
        value: firstText(clinical.conduta, motivo, 'Renovação de prescrição após validação médica.')
      }
    ];
  }, [atendimento, motivo]);

  async function fetchAtendimento() {
    setError(null);
    try {
      const [detailRes, decisionsRes] = await Promise.all([
        fetch(`${API_BASE}/api/atendimentos/${params.id}`),
        fetch(`${API_BASE}/api/atendimentos/${params.id}/decisoes`)
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
  }

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
  }, [params.id]);

  async function updateStatus(status: AtendimentoStatus, requiresReason = false, reasonOverride?: string) {
    const finalReason = reasonOverride?.trim() || motivo.trim();

    if (requiresReason && !finalReason) {
      setError('Informe o motivo antes de reprovar o atendimento.');
      return false;
    }

    setActionLoading(status);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/atendimentos/${params.id}/status`, {
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

  async function approveAndOpenMemed() {
    setActionLoading('approve-memed');
    setError(null);
    try {
      const ok = await updateStatus('MEMED_PROCESSING');
      if (ok) window.location.href = `/receita?atendimentoId=${params.id}`;
    } finally {
      setActionLoading(null);
    }
  }

  async function acceptPrescription() {
    if (!latestReceipt?.receitaUrl && !latestReceipt?.pdfUrl) {
      setError('Nenhuma receita Memed vinculada a este atendimento ainda.');
      return;
    }
    await updateStatus('VALIDATED');
  }

  function viewPrescription() {
    const url = latestReceipt?.pdfUrl || latestReceipt?.receitaUrl;
    if (!url) {
      setError('Nenhuma receita disponível para visualização.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function viewAttachedPrescription() {
    const url = String(atendimento?.dados_clinicos?.foto_receita_url || '');
    if (!url) {
      setError('Nenhuma receita anexada foi informada na triagem.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function logout() {
    clearSession();
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
      const res = await fetch(`${API_BASE}/api/atendimentos/${params.id}/clinical`, {
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
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <header className="flex h-20 items-center justify-between bg-white px-8">
        <div className="flex items-center gap-4">
          <a
            href="/fila"
            className="inline-flex h-10 items-center rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5"
          >
            VOLTAR
          </a>
          <div>
            <h1 className="text-xl font-black">PRONTUÁRIO MÉDICO</h1>
            <p className="text-sm text-[#5B6475]">Avalie as informações do paciente e aprove o atendimento</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-[14px] border border-[#E5EAF2] bg-white px-3 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EEF4FF] text-xs font-black text-[#1557FF]">
              DM
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-bold leading-4">{user?.name || 'Médico'}</p>
              <p className="text-[11px] text-[#5B6475]">{user?.role === 'admin' ? 'Administrador' : 'Médico'}</p>
            </div>
          </div>
          <button onClick={logout} className="h-10 rounded-[14px] bg-[#FADADA] px-4 text-xs font-bold text-[#1E1E1E]">
            SAIR
          </button>
        </div>
      </header>

      <div className="h-1 bg-[#F4B000]" />

      <section className="px-8 py-6">
        <div className="mb-5 rounded-[20px] border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-[#0BA84F]">Paciente triado com sucesso pelo chatbot</p>
              <p className="mt-1 text-sm text-[#5B6475]">
                {atendimento.elegibilidade?.reason || 'Todos os critérios informados foram analisados.'}
              </p>
            </div>
            <span className="inline-flex h-9 items-center rounded-[12px] bg-white px-4 text-xs font-black text-[#0BA84F]">
              VERIFICADO
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[0.82fr_1.18fr]">
          <section className="space-y-5">
            <div className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
              <div className="mb-5 flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#EEF4FF] text-xl font-black text-[#1557FF]">
                  {initials(atendimento.paciente_nome)}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-black">{atendimento.paciente_nome}</h2>
                  <p className="mt-1 text-sm text-[#5B6475]">Registro {atendimento.id.slice(0, 8).toUpperCase()}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-[12px] bg-[#EEF4FF] px-3 py-1 text-xs font-bold text-[#1557FF]">
                      {atendimento.status}
                    </span>
                    <span className="rounded-[12px] bg-[#F8FAFC] px-3 py-1 text-xs font-bold text-[#1E1E1E]">
                      {atendimento.risco || 'RISCO NÃO DEFINIDO'}
                    </span>
                  </div>
                </div>
              </div>

              <h3 className="text-sm font-black">DADOS DO PACIENTE</h3>
              <dl className="mt-4 grid gap-3 text-sm">
                {[
                  ['Telefone', atendimento.paciente_telefone || 'Não informado'],
                  ['CPF', atendimento.paciente_cpf || 'Não informado'],
                  ['E-mail', atendimento.paciente_email || 'Não informado'],
                  ['Data de nascimento', firstText(clinical.data_nascimento, clinical.birth_date)],
                  ['Endereço', firstText(clinical.endereco, clinical.address)],
                  ['CEP', firstText(clinical.cep, clinical.postal_code)],
                  ['Pagamento', atendimento.pagamento_status || 'PENDENTE'],
                  ['Entrada', formatDate(atendimento.criado_em)]
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-[#E5EAF2] pb-2 last:border-0">
                    <dt className="text-[#5B6475]">{label}</dt>
                    <dd className="max-w-[210px] truncate text-right font-bold text-[#1E1E1E]">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
              <h3 className="text-sm font-black">ELEGIBILIDADE</h3>
              <div className="mt-3 rounded-[14px] bg-[#F8FAFC] p-4 text-sm text-[#5B6475]">
                <p className="font-bold text-[#1E1E1E]">{atendimento.elegibilidade?.eligible ? 'Elegível' : 'Não elegível ou pendente'}</p>
                <p className="mt-1">{atendimento.elegibilidade?.reason || 'Sem decisão automática registrada.'}</p>
              </div>
              <button
                onClick={runEligibility}
                disabled={actionLoading === 'eligibility'}
                className="mt-3 h-10 rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold text-[#1E1E1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)] disabled:opacity-50"
              >
                {actionLoading === 'eligibility' ? 'AVALIANDO...' : 'REAVALIAR ELEGIBILIDADE'}
              </button>
            </div>
          </section>

          <section className="space-y-5">
            <div className="p-1">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-black">HISTÓRIA CLÍNICA</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={viewAttachedPrescription}
                    className="h-9 rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold text-[#1E1E1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                  >
                    RECEITA ANEXADA
                  </button>
                  <button
                    onClick={openEditModal}
                    className="h-9 rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-bold text-[#1E1E1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                  >
                    EDITAR
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {clinicalBlocks.map((block) => (
                  <article key={block.title} className="rounded-[20px] border border-[#E5EAF2] bg-white p-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                    <div className="mb-3 flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#EEF4FF] text-xs font-black text-[#1557FF]">
                        {block.title.slice(0, 2).toUpperCase()}
                      </span>
                      <h3 className="text-sm font-black">{block.title}</h3>
                    </div>
                    <p className="text-sm leading-6 text-[#5B6475]">{block.value}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
              <label className="text-sm font-black" htmlFor="medical-notes">
                OBSERVAÇÕES MÉDICAS
              </label>
              <textarea
                id="medical-notes"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                placeholder="Digite aqui orientações adicionais, observações ou justificativas (opcional)..."
                className="mt-3 min-h-28 w-full resize-none rounded-[14px] border border-[#E5EAF2] bg-white p-4 text-sm outline-none focus:border-[#1557FF]"
              />

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => updateStatus('REJECTED', true)}
                  disabled={actionLoading === 'REJECTED'}
                  className="rounded-[14px] bg-[#FF2D2D] px-5 py-4 text-left text-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] disabled:opacity-50"
                >
                  <span className="block text-sm font-black">{actionLoading === 'REJECTED' ? 'SALVANDO...' : 'REPROVAR'}</span>
                  <span className="mt-1 block text-xs text-white/85">Não autorizar atendimento</span>
                </button>

                <button
                  onClick={approveAndOpenMemed}
                  disabled={actionLoading === 'approve-memed'}
                  className="rounded-[14px] bg-[#0BA84F] px-5 py-4 text-left text-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] disabled:opacity-50"
                >
                  <span className="block text-sm font-black">{actionLoading === 'approve-memed' ? 'ABRINDO MEMED...' : 'APROVAR'}</span>
                  <span className="mt-1 block text-xs text-white/85">Autorizar atendimento</span>
                </button>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
              <div className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                <h3 className="text-sm font-black">MEMED</h3>
                <p className="mt-2 text-sm leading-6 text-[#5B6475]">
                  Prescrição embedded, validação médica final e entrega ao paciente.
                </p>
                {latestReceipt?.receitaId && <p className="mt-2 text-xs font-bold text-[#5B6475]">ID Memed: {latestReceipt.receitaId}</p>}
                <div className="mt-4 grid gap-2">
                  <a
                    href={`/receita?atendimentoId=${atendimento.id}`}
                    className="inline-flex h-10 items-center justify-center rounded-[14px] bg-[#1557FF] px-4 text-xs font-bold text-white"
                  >
                    ABRIR PRESCRIÇÃO
                  </a>
                  <button
                    onClick={viewPrescription}
                    disabled={!latestReceipt?.receitaUrl && !latestReceipt?.pdfUrl}
                    className="h-10 rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold text-[#1E1E1E] disabled:opacity-50"
                  >
                    VISUALIZAR RECEITA
                  </button>
                  <button
                    onClick={acceptPrescription}
                    disabled={actionLoading === 'VALIDATED' || (!latestReceipt?.receitaUrl && !latestReceipt?.pdfUrl)}
                    className="h-10 rounded-[14px] bg-[#F4B000] px-4 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {actionLoading === 'VALIDATED' ? 'VALIDANDO...' : 'ACEITAR RECEITA'}
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
