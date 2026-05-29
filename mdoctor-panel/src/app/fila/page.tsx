'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_BASE, checkEligibility } from '@/services/api';
import { authHeaders, clearSession, requireSession } from '@/services/auth.service';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';

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

type ColumnKey = 'queue' | 'review' | 'ready' | 'closed';
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
  },
  {
    key: 'closed',
    statuses: ['REJECTED', 'RECUSADO', 'FINISHED', 'DELIVERED'],
    title: 'FINALIZADOS',
    badgeClass: 'bg-slate-100 text-[#5B6475]',
    headerMark: 'bg-slate-100 text-[#5B6475]'
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
  if (status === 'REJECTED' || status === 'RECUSADO') return 'Recusado';
  if (status === 'DELIVERED') return 'Entregue';
  if (column === 'closed') return 'Finalizado';
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
      ready: filteredAtendimentos.filter((item) => ['VALIDATED', 'APROVADO', 'RECEITA_EMITIDA'].includes(item.status)).length,
      closed: filteredAtendimentos.filter((item) => ['REJECTED', 'RECUSADO', 'FINISHED', 'DELIVERED'].includes(item.status)).length
    };
  }, [filteredAtendimentos]);

  const grouped = useMemo(() => {
    return columns.reduce<Record<ColumnKey, Atendimento[]>>((acc, column) => {
      acc[column.key] = filteredAtendimentos.filter((item) => column.statuses.includes(item.status));
      return acc;
    }, { queue: [], review: [], ready: [], closed: [] });
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
    requireSession()
      .then(() => fetchAtendimentos())
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
            className="h-11 rounded-[10px] bg-[#1557FF] px-6 text-sm font-black text-white shadow-[0_8px_18px_rgba(21,87,255,0.18)] transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            ♙ ATENDER
          </button>
        </>
      );
    }

    if (column === 'review') {
      return (
        <>
          <a
            href={`/atendimento/${item.id}`}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-[10px] border border-[#080D33] bg-white px-4 text-xs font-black text-[#080D33] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition hover:-translate-y-0.5"
          >
            ◉ VISUALIZAR RECEITA
          </a>
          <button
            onClick={() => updateStatus(item.id, 'VALIDATED', 'Receita aceita pelo painel medico')}
            disabled={actionLoading === item.id || item.status !== 'AWAITING_VALIDATION'}
            className="h-11 flex-1 rounded-[10px] bg-[#F4B000] px-4 text-xs font-black text-white shadow-[0_8px_18px_rgba(244,176,0,0.18)] transition hover:-translate-y-0.5 disabled:opacity-50"
          >
            ✓ ACEITAR RECEITA
          </button>
        </>
      );
    }

    if (column === 'closed') {
      return (
        <a
          href={`/atendimento/${item.id}`}
          className="inline-flex h-9 items-center justify-center rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-bold text-[#1E1E1E] shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5"
        >
          VER PRONTUARIO
        </a>
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
                  ? 'h-11 w-full rounded-[10px] bg-[#0BA84F] px-4 text-xs font-black text-white shadow-[0_8px_18px_rgba(11,168,79,0.18)] transition hover:-translate-y-0.5 disabled:opacity-50'
                  : 'h-11 flex-1 rounded-[10px] border border-[#080D33] bg-white px-4 text-xs font-black text-[#080D33] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition hover:-translate-y-0.5 disabled:opacity-50'
              }
            >
              {actionLoading === loadingKey ? 'ENVIANDO...' : `${primary ? '◉ ' : ''}ENVIAR POR ${channelLabel(channel)}`}
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
    <main className="min-h-screen bg-[#F8FAFC] text-[#080D33]">
      <MedicalPanelHeader
        compact
        onLogout={logout}
        onOpenMedicalRecord={() => {
          const first = filteredAtendimentos[0];
          if (first) window.location.href = `/atendimento/${first.id}`;
        }}
      />

      <section className="px-5 py-6 sm:px-8">
        <div className="mb-4 flex justify-end">
          <button
            onClick={fetchAtendimentos}
            className="h-10 rounded-[8px] border border-[#D8DFEA] bg-white px-4 text-xs font-black text-[#080D33] shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition hover:-translate-y-0.5"
          >
            ATUALIZAR
          </button>
        </div>

        <div className="mb-4 hidden gap-3 rounded-[8px] border border-[#E5EAF2] bg-white p-3 shadow-[0_4px_14px_rgba(0,0,0,0.04)] md:grid-cols-[1.25fr_0.75fr_0.75fr_0.75fr_auto]">
          <label className="text-xs font-bold text-[#5B6475]">
            BUSCAR
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Paciente, telefone, condição, status..."
              className="mt-1 h-9 w-full rounded-[12px] border border-[#E5EAF2] px-3 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF]"
            />
          </label>

          <label className="text-xs font-bold text-[#5B6475]">
            STATUS
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | AtendimentoStatus)}
              className="mt-1 h-9 w-full rounded-[12px] border border-[#E5EAF2] px-3 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF]"
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
              className="mt-1 h-9 w-full rounded-[12px] border border-[#E5EAF2] px-3 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF]"
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
              className="mt-1 h-9 w-full rounded-[12px] border border-[#E5EAF2] px-3 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF]"
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
            className="h-9 self-end rounded-[12px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold text-[#1E1E1E]"
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

        <div className="grid gap-4 md:grid-cols-3">
          {columns.filter((column) => column.key !== 'closed').map((column) => (
            <section
              key={column.key}
              className="flex max-h-[calc(100vh-210px)] min-h-[560px] flex-col rounded-[12px] border border-[#E5EAF2] bg-white shadow-[0_10px_30px_rgba(8,13,51,0.06)]"
            >
              <div className="flex items-center justify-between border-b border-[#E5EAF2] px-7 py-6">
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-[8px] text-xl font-black ${column.headerMark}`}>
                    {column.key === 'queue' ? '◴' : column.key === 'review' ? '♙' : column.key === 'ready' ? '✓' : '•'}
                  </span>
                  <h2 className="text-base font-black tracking-normal">{column.title}</h2>
                </div>
                <span className="rounded-[8px] bg-[#FADADA] px-4 py-2 text-base font-black text-[#080D33]">
                  {grouped[column.key].length}
                </span>
              </div>

              <div className="space-y-4 overflow-y-auto p-4">
                {grouped[column.key].length ? (
                  grouped[column.key].map((item) => (
                    <article
                      key={item.id}
                      className="rounded-[12px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_18px_rgba(8,13,51,0.04)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-xl font-black text-[#1557FF]">
                          {initials(item.paciente_nome)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="truncate text-lg font-black">{item.paciente_nome}</h3>
                              <p className="text-sm font-bold text-[#26325F]">#{item.id.slice(0, 8).toUpperCase()}</p>
                            </div>
                            <span className={`shrink-0 rounded-[8px] px-3 py-2 text-xs font-bold ${column.badgeClass}`}>
                              {column.key === 'queue' ? waitingTime(item.criado_em) : statusLabel(item.status, column.key)}
                            </span>
                          </div>

                          <p className="mt-5 text-sm font-bold text-[#26325F]">
                            <span className="mr-2 text-[#0BA84F]">◉</span>
                            Contato paciente
                          </p>

                          {item.elegibilidade?.reason && (
                            <p className="mt-3 hidden rounded-[8px] bg-[#F8FAFC] p-3 text-xs leading-5 text-[#5B6475]">
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

                          <div className="mt-5 flex flex-wrap justify-end gap-3">
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

        {grouped.closed.length > 0 && (
          <section className="mt-5 rounded-[18px] border border-[#E5EAF2] bg-white p-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-slate-100 text-xs font-black text-[#5B6475]">FI</span>
                <h2 className="text-sm font-black tracking-normal">FINALIZADOS</h2>
              </div>
              <span className="rounded-[12px] bg-slate-100 px-3 py-1 text-xs font-black text-[#5B6475]">{grouped.closed.length}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {grouped.closed.map((item) => (
                <article key={item.id} className="flex items-center justify-between gap-3 rounded-[14px] border border-[#E5EAF2] p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{item.paciente_nome}</p>
                    <p className="text-xs text-[#5B6475]">{item.condicao || 'Condicao nao informada'} · {statusLabel(item.status, 'closed')}</p>
                  </div>
                  <a href={`/atendimento/${item.id}`} className="shrink-0 rounded-[12px] border border-[#E5EAF2] px-3 py-2 text-xs font-bold text-[#1E1E1E]">
                    VER
                  </a>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>

      <footer className="flex items-center justify-between border-t border-[#E5EAF2] bg-white px-16 py-5 text-sm font-medium text-[#26325F]">
        <div>
          <p className="font-black text-[#080D33]">▣ Ambiente protegido LGPD</p>
          <p>Dados protegidos e criptografados</p>
        </div>
        <p>Doctor Prescreve — Plataforma de Prescrição e Atendimento Médico</p>
        <p>CNPJ 50.871.173/0001-53</p>
      </footer>
    </main>
  );
}
