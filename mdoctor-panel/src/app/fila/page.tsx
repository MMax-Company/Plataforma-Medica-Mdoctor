'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_BASE, checkEligibility } from '@/services/api';
import { authHeaders, clearSession, getAuthUser, requireSession, type AuthUser } from '@/services/auth.service';

type AtendimentoStatus =
  | 'QUEUE'
  | 'UNDER_REVIEW'
  | 'MEMED_PROCESSING'
  | 'AWAITING_VALIDATION'
  | 'VALIDATED'
  | 'REJECTED'
  | 'FINISHED'
  | 'DELIVERED'
  | 'TRIAGED'
  | 'FILA'
  | 'EM_ATENDIMENTO'
  | 'PRONTO_PARA_DECISAO'
  | 'APROVADO'
  | 'RECUSADO'
  | 'RECEITA_EMITIDA';

type Atendimento = {
  id: string;
  status: AtendimentoStatus;
  paciente_nome: string;
  paciente_telefone?: string;
  paciente_email?: string;
  condicao?: string;
  risco?: string | null;
  pagamento_status?: string;
  criado_em?: string;
  dados_clinicos?: {
    condition?: string;
    previous_prescription?: boolean;
    continuous_use_proof?: boolean;
    flags?: string[];
    memed_receita?: {
      receitaUrl?: string;
      pdfUrl?: string;
      receitaId?: string;
    };
    entrega_receita?: DeliveryAttempt;
    entregas_receita?: DeliveryAttempt[];
  };
  elegibilidade?: {
    eligible?: boolean;
    reason?: string;
  } | null;
};

type ColumnKey = 'queue' | 'review' | 'ready';
type DeliveryChannel = 'whatsapp' | 'email' | 'sms';
type DeliveryAttempt = {
  id?: string;
  channel?: DeliveryChannel;
  targetMasked?: string;
  provider?: string;
  status?: string;
  sent_at?: string;
  attempted_at?: string;
  error?: string;
};

const columns: Array<{
  key: ColumnKey;
  statuses: AtendimentoStatus[];
  title: string;
  badgeClass: string;
  headerMark: string;
}> = [
  {
    key: 'queue',
    statuses: ['QUEUE', 'FILA', 'TRIAGED'],
    title: 'FILA DE ESPERA',
    badgeClass: 'bg-[#FADADA] text-[#1E1E1E]',
    headerMark: 'bg-[#EEF4FF] text-[#1557FF]'
  },
  {
    key: 'review',
    statuses: ['EM_ATENDIMENTO', 'UNDER_REVIEW', 'MEMED_PROCESSING', 'AWAITING_VALIDATION'],
    title: 'EM ATENDIMENTO',
    badgeClass: 'bg-[#F4B000] text-white',
    headerMark: 'bg-[#EEF4FF] text-[#1557FF]'
  },
  {
    key: 'ready',
    statuses: ['VALIDATED', 'APROVADO', 'RECEITA_EMITIDA'],
    title: 'RECEITAS PRONTAS',
    badgeClass: 'bg-emerald-50 text-[#0BA84F]',
    headerMark: 'bg-emerald-50 text-[#0BA84F]'
  }
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'P') + (parts[1]?.[0] || '');
}

function formatDate(value?: string) {
  if (!value) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function waitingTime(value?: string) {
  if (!value) return 'Agora';
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const hours = Math.floor(diff / 36e5);
  const minutes = Math.floor((diff % 36e5) / 6e4);
  return hours ? `${hours}h ${minutes}min` : `${minutes || 1}min`;
}

function statusLabel(status: AtendimentoStatus, column: ColumnKey) {
  if (column === 'queue') return 'Aguardando atendimento';
  if (status === 'AWAITING_VALIDATION') return 'Aguardando validacao';
  if (status === 'MEMED_PROCESSING') return 'Memed em processamento';
  if (column === 'ready') return 'Receita validada';
  return 'Em revisao medica';
}

function latestDelivery(item: Atendimento) {
  const clinical = item.dados_clinicos || {};
  return clinical.entregas_receita?.[0] || clinical.entrega_receita || null;
}

function channelTarget(item: Atendimento, channel: DeliveryChannel) {
  return channel === 'email' ? item.paciente_email : item.paciente_telefone;
}

function channelLabel(channel: DeliveryChannel) {
  if (channel === 'whatsapp') return 'WHATSAPP';
  if (channel === 'email') return 'E-MAIL';
  return 'SMS';
}

export default function FilaPage() {
  const [atendimentos, setAtendimentos] = useState<Atendimento[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AtendimentoStatus>('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');

  const filteredAtendimentos = useMemo(() => {
    const query = search.trim().toLowerCase();
    return atendimentos.filter((item) => {
      const clinical = item.dados_clinicos || {};
      const haystack = [
        item.paciente_nome,
        item.paciente_telefone,
        item.paciente_email,
        item.condicao,
        item.status,
        item.risco,
        item.pagamento_status,
        clinical.condition
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const matchesSearch = !query || haystack.includes(query);
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesRisk = riskFilter === 'all' || (item.risco || 'SEM_RISCO') === riskFilter;
      const matchesPayment = paymentFilter === 'all' || (item.pagamento_status || 'PENDENTE') === paymentFilter;
      return matchesSearch && matchesStatus && matchesRisk && matchesPayment;
    });
  }, [atendimentos, paymentFilter, riskFilter, search, statusFilter]);

  const filterOptions = useMemo(() => {
    const statuses = Array.from(new Set(atendimentos.map((item) => item.status))).sort();
    const risks = Array.from(new Set(atendimentos.map((item) => item.risco || 'SEM_RISCO'))).sort();
    const payments = Array.from(new Set(atendimentos.map((item) => item.pagamento_status || 'PENDENTE'))).sort();
    return { statuses, risks, payments };
  }, [atendimentos]);

  const operationalMetrics = useMemo(() => {
    return {
      total: filteredAtendimentos.length,
      queue: filteredAtendimentos.filter((item) => ['QUEUE', 'FILA', 'TRIAGED'].includes(item.status)).length,
      review: filteredAtendimentos.filter((item) => ['EM_ATENDIMENTO', 'UNDER_REVIEW', 'MEMED_PROCESSING', 'AWAITING_VALIDATION'].includes(item.status)).length,
      ready: filteredAtendimentos.filter((item) => ['VALIDATED', 'APROVADO', 'RECEITA_EMITIDA'].includes(item.status)).length
    };
  }, [filteredAtendimentos]);

  const grouped = useMemo(() => {
    return columns.reduce<Record<ColumnKey, Atendimento[]>>((acc, column) => {
      acc[column.key] = filteredAtendimentos.filter((item) => column.statuses.includes(item.status));
      return acc;
    }, { queue: [], review: [], ready: [] });
  }, [filteredAtendimentos]);

  async function fetchAtendimentos() {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/atendimentos/queue`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao buscar atendimentos');
      setAtendimentos(data.atendimentos);
    } catch (e: any) {
      setError(e.message || 'Erro ao buscar fila');
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
        return fetchAtendimentos();
      })
      .catch((e: any) => {
        setError(e.message || 'Sessão expirada. Faça login novamente.');
        window.location.href = '/login';
      });
  }, []);

  async function updateStatus(id: string, status: AtendimentoStatus, notes = 'Acao via painel medico') {
    setActionLoading(id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/atendimentos/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status, notes })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao atualizar status');
      setAtendimentos((prev) => prev.map((item) => (item.id === id ? data.atendimento : item)));
    } catch (e: any) {
      setError(e.message || 'Erro ao atualizar status');
    } finally {
      setActionLoading(null);
    }
  }

  async function autoEvaluate(item: Atendimento) {
    setActionLoading(item.id);
    setError(null);
    try {
      const clinical = item.dados_clinicos || {};
      const decision = await checkEligibility({
        condition: clinical.condition || item.condicao || '',
        previous_prescription: Boolean(clinical.previous_prescription),
        continuous_use_proof: Boolean(clinical.continuous_use_proof),
        flags: clinical.flags || []
      });
      await updateStatus(item.id, decision.eligible ? 'UNDER_REVIEW' : 'REJECTED', 'Triagem automatica pelo painel medico');
    } catch (e: any) {
      setError(e.message || 'Erro ao avaliar elegibilidade');
      setActionLoading(null);
    }
  }

  async function deliverPrescription(item: Atendimento, channel: DeliveryChannel) {
    setActionLoading(`${item.id}-${channel}`);
    setError(null);
    setToast(null);
    try {
      const res = await fetch(`${API_BASE}/api/atendimentos/${item.id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ channel })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao entregar receita');
      setAtendimentos((prev) => prev.filter((current) => current.id !== item.id));
      setToast(`Receita enviada por ${channelLabel(channel).toLowerCase()}`);
      window.setTimeout(() => setToast(null), 2600);
    } catch (e: any) {
      setError(e.message || 'Erro ao entregar receita');
    } finally {
      setActionLoading(null);
    }
  }

  function logout() {
    clearSession();
    window.location.href = '/login';
  }

  function renderActions(item: Atendimento, column: ColumnKey) {
    if (column === 'queue') {
      return (
        <>
          <button
            onClick={() => autoEvaluate(item)}
            disabled={actionLoading === item.id}
            className="h-9 rounded-[14px] bg-[#1557FF] px-4 text-xs font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            ATENDER
          </button>
        </>
      );
    }

    if (column === 'review') {
      return (
        <>
          <a
            href={`/atendimento/${item.id}`}
            className="inline-flex h-9 items-center justify-center rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold text-[#1E1E1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5"
          >
            VISUALIZAR RECEITA
          </a>
          <button
            onClick={() => updateStatus(item.id, 'VALIDATED', 'Receita aceita pelo painel medico')}
            disabled={actionLoading === item.id || item.status !== 'AWAITING_VALIDATION'}
            className="h-9 rounded-[14px] bg-[#F4B000] px-4 text-xs font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            ACEITAR RECEITA
          </button>
        </>
      );
    }

    return (
      <>
        {(['whatsapp', 'email', 'sms'] as DeliveryChannel[]).map((channel) => {
          const hasTarget = Boolean(channelTarget(item, channel));
          const loadingKey = `${item.id}-${channel}`;
          const primary = channel === 'whatsapp';
          return (
            <button
              key={channel}
              onClick={() => deliverPrescription(item, channel)}
              disabled={actionLoading === loadingKey || !hasTarget}
              title={hasTarget ? `Enviar por ${channelLabel(channel)}` : `Contato ausente para ${channelLabel(channel)}`}
              className={
                primary
                  ? 'h-9 w-full rounded-[14px] bg-[#0BA84F] px-4 text-xs font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5 disabled:opacity-50'
                  : 'h-9 rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold text-[#1E1E1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5 disabled:opacity-50'
              }
            >
              {actionLoading === loadingKey ? 'ENVIANDO...' : `ENVIAR POR ${channelLabel(channel)}`}
            </button>
          );
        })}
      </>
    );
  }

  if (loading) {
    return <main className="min-h-screen bg-[#F8FAFC] p-6 text-sm text-[#5B6475]">Carregando fila...</main>;
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <header className="flex h-20 items-center justify-between bg-white px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#1557FF] text-sm font-black text-white">
            DP
          </div>
          <div>
            <p className="text-sm font-bold leading-5">Doctor Prescreve</p>
            <p className="text-xs text-[#5B6475]">Painel medico operacional</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href="/fila"
            className="hidden h-10 items-center rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:inline-flex"
          >
            PRONTUARIO
          </a>
          <a
            href="/admin"
            className="hidden h-10 items-center rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)] md:inline-flex"
          >
            MASTER
          </a>
          <div className="hidden h-10 items-center gap-2 rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-semibold text-[#1E1E1E] md:flex">
            <span className="h-2.5 w-2.5 rounded-full bg-[#0BA84F]" />
            Certificado digital conectado (Memed)
          </div>
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
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Fluxo operacional</h1>
            <p className="text-sm text-[#5B6475]">Atendimento, validacao Memed e entrega de receitas.</p>
          </div>
          <button
            onClick={fetchAtendimentos}
            className="h-10 rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-bold text-[#1E1E1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5"
          >
            ATUALIZAR
          </button>
        </div>

        <div className="mb-5 grid gap-3 rounded-[20px] border border-[#E5EAF2] bg-white p-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)] lg:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_auto]">
          <label className="text-xs font-bold text-[#5B6475]">
            BUSCAR
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Paciente, telefone, condição, status..."
              className="mt-2 h-10 w-full rounded-[14px] border border-[#E5EAF2] px-3 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF]"
            />
          </label>

          <label className="text-xs font-bold text-[#5B6475]">
            STATUS
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | AtendimentoStatus)}
              className="mt-2 h-10 w-full rounded-[14px] border border-[#E5EAF2] px-3 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF]"
            >
              <option value="all">Todos</option>
              {filterOptions.statuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-[#5B6475]">
            RISCO
            <select
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value)}
              className="mt-2 h-10 w-full rounded-[14px] border border-[#E5EAF2] px-3 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF]"
            >
              <option value="all">Todos</option>
              {filterOptions.risks.map((risk) => (
                <option key={risk} value={risk}>{risk}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-[#5B6475]">
            PAGAMENTO
            <select
              value={paymentFilter}
              onChange={(event) => setPaymentFilter(event.target.value)}
              className="mt-2 h-10 w-full rounded-[14px] border border-[#E5EAF2] px-3 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF]"
            >
              <option value="all">Todos</option>
              {filterOptions.payments.map((payment) => (
                <option key={payment} value={payment}>{payment}</option>
              ))}
            </select>
          </label>

          <button
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
              setRiskFilter('all');
              setPaymentFilter('all');
            }}
            className="h-10 self-end rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold text-[#1E1E1E]"
          >
            LIMPAR
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {toast && (
          <div className="fixed right-5 top-5 z-20 rounded-[14px] border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-[#0BA84F] shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
            {toast}
          </div>
        )}

        <div className="mb-5 grid gap-4 md:grid-cols-4">
          {[
            ['Total filtrado', operationalMetrics.total],
            ['Fila', operationalMetrics.queue],
            ['Em atendimento', operationalMetrics.review],
            ['Receitas prontas', operationalMetrics.ready]
          ].map(([label, value]) => (
            <article key={label} className="rounded-[20px] border border-[#E5EAF2] bg-white p-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
              <p className="text-xs font-black text-[#5B6475]">{label}</p>
              <p className="mt-2 text-2xl font-black">{value}</p>
            </article>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {columns.map((column) => (
            <section
              key={column.key}
              className="flex max-h-[calc(100vh-210px)] min-h-[560px] flex-col rounded-[20px] border border-[#E5EAF2] bg-white shadow-[0_4px_14px_rgba(0,0,0,0.04)]"
            >
              <div className="flex items-center justify-between border-b border-[#E5EAF2] px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-[12px] text-xs font-black ${column.headerMark}`}>
                    {column.key === 'queue' ? 'FE' : column.key === 'review' ? 'EA' : 'RP'}
                  </span>
                  <h2 className="text-sm font-black tracking-normal">{column.title}</h2>
                </div>
                <span className="rounded-[12px] bg-[#FADADA] px-3 py-1 text-xs font-black text-[#1E1E1E]">
                  {grouped[column.key].length}
                </span>
              </div>

              <div className="space-y-3 overflow-y-auto p-4">
                {grouped[column.key].length ? (
                  grouped[column.key].map((item) => (
                    <article
                      key={item.id}
                      className="rounded-[20px] border border-[#E5EAF2] bg-white p-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-sm font-black text-[#1557FF]">
                          {initials(item.paciente_nome)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-black">{item.paciente_nome}</h3>
                              <p className="text-xs text-[#5B6475]">Registro {item.id.slice(0, 8).toUpperCase()}</p>
                            </div>
                            <span className={`shrink-0 rounded-[12px] px-2.5 py-1 text-[11px] font-bold ${column.badgeClass}`}>
                              {column.key === 'queue' ? waitingTime(item.criado_em) : statusLabel(item.status, column.key)}
                            </span>
                          </div>

                          <dl className="mt-3 grid gap-2 text-xs text-[#5B6475]">
                            <div className="flex justify-between gap-2">
                              <dt>Contato paciente</dt>
                              <dd className="font-semibold text-[#0BA84F]">{item.paciente_telefone || 'Nao informado'}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>Condicao</dt>
                              <dd className="max-w-[150px] truncate text-right font-semibold text-[#1E1E1E]">
                                {item.condicao || 'Nao informada'}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt>Entrada</dt>
                              <dd className="font-semibold text-[#1E1E1E]">{formatDate(item.criado_em)}</dd>
                            </div>
                          </dl>

                          {item.elegibilidade?.reason && (
                            <p className="mt-3 rounded-[14px] bg-[#F8FAFC] p-3 text-xs leading-5 text-[#5B6475]">
                              {item.elegibilidade.reason}
                            </p>
                          )}

                          {latestDelivery(item) && (
                            <p className="mt-3 rounded-[14px] bg-[#EEF4FF] p-3 text-xs leading-5 text-[#5B6475]">
                              Última entrega: <span className="font-bold text-[#1E1E1E]">{latestDelivery(item)?.status}</span>
                              {' via '}
                              <span className="font-bold text-[#1E1E1E]">{latestDelivery(item)?.provider || latestDelivery(item)?.channel}</span>
                              {latestDelivery(item)?.error ? ` (${latestDelivery(item)?.error})` : ''}
                            </p>
                          )}

                          <div className="mt-4 flex flex-wrap gap-2">
                            {renderActions(item, column.key)}
                          </div>
                        </div>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="rounded-[20px] border border-dashed border-[#E5EAF2] p-5 text-center text-xs font-semibold text-[#5B6475]">
                    Sem atendimentos
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-[#E5EAF2] bg-white px-8 py-4 text-xs text-[#5B6475]">
        <div>
          <p className="font-bold text-[#1E1E1E]">Ambiente protegido LGPD</p>
          <p>Dados protegidos e criptografados</p>
        </div>
        <p>CNPJ 50.871.173/0001-53</p>
      </footer>
    </main>
  );
}
