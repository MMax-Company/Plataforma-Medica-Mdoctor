'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock3, MessageCircle, User, UserRound } from 'lucide-react';
import { getApiBase } from '@/services/api';
import { authHeaders, logout, requireSession } from '@/services/auth.service';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';
import { MedicalSupportBand, type SupportQueueItem } from '@/components/medical/MedicalSupportBand';
import { formatQueuePatientId, patientInitials, whatsappContactUrl as waUrlFromPhone } from '@/lib/patient-display';
import { toPanelAtendimentoStatus, type PanelAtendimentoStatus } from '@/lib/atendimento-status';

type AtendimentoStatus = PanelAtendimentoStatus;

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
    queue_type?: string;
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

function isSupportItem(item: Atendimento) {
  const clinical = item.dados_clinicos || {};
  return item.condicao === 'suporte_whatsapp' || clinical.queue_type === 'support';
}

function whatsappContactUrl(phone?: string) {
  if (!phone) return null;
  return waUrlFromPhone(phone);
}

function formatAttendanceId(id: string) {
  return formatQueuePatientId(id);
}

function statusLabel(status: AtendimentoStatus, column: ColumnKey) {
  if (column === 'queue') return 'Aguardando atendimento';
  if (status === 'AWAITING_VALIDATION') return 'Aguardando validação';
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

function columnCountClass() {
  return 'dp-col-count dp-col-count-alert';
}

const columnIcons: Record<'queue' | 'review' | 'ready', typeof Clock3> = {
  queue: Clock3,
  review: User,
  ready: CheckCircle2,
};

export default function FilaPage() {
  const router = useRouter();
  const [atendimentos, setAtendimentos] = useState<Atendimento[]>([]);
  const [supportPatients, setSupportPatients] = useState<SupportQueueItem[]>([]);
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

  const medicalAtendimentos = useMemo(
    () => filteredAtendimentos.filter((item) => !isSupportItem(item)),
    [filteredAtendimentos],
  );

  const grouped = useMemo(() => {
    return columns.reduce<Record<ColumnKey, Atendimento[]>>((acc, column) => {
      acc[column.key] = medicalAtendimentos.filter((item) => column.statuses.includes(item.status));
      return acc;
    }, { queue: [], review: [], ready: [], closed: [] });
  }, [medicalAtendimentos]);

  async function fetchAtendimentos() {
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/queue`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao buscar atendimentos');
      const rows = (data.atendimentos || []).map((item: Atendimento) => ({
        ...item,
        status: toPanelAtendimentoStatus(item.status),
      }));
      setAtendimentos(rows);
    } catch (e: any) {
      setError(e.message || 'Erro ao buscar fila');
    } finally {
      setLoading(false);
    }
  }

  async function fetchSupportQueue() {
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/support-queue`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) return;
      const rows = Array.isArray(data) ? data : data.atendimentos || data.data || [];
      setSupportPatients(
        rows.map((item: Atendimento) => ({
          id: item.id,
          paciente_nome: item.paciente_nome,
          paciente_telefone: item.paciente_telefone,
          criado_em: item.criado_em,
        })),
      );
    } catch {
      setSupportPatients([]);
    }
  }

  useEffect(() => {
    requireSession()
      .then(async () => {
        await Promise.all([fetchAtendimentos(), fetchSupportQueue()]);
      })
      .catch((e: any) => {
        setError(e.message || 'Sessão expirada. Faça login novamente.');
        window.location.href = '/login';
      });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchAtendimentos();
        void fetchSupportQueue();
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function updateStatus(id: string, status: AtendimentoStatus, notes = 'Acao via painel medico') {
    setActionLoading(id);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status, notes })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao atualizar status');
      const updated = data.atendimento
        ? { ...data.atendimento, status: toPanelAtendimentoStatus(data.atendimento.status) }
        : null;
      setAtendimentos((prev) => prev.map((item) => (item.id === id && updated ? updated : item)));
    } catch (e: any) {
      setError(e.message || 'Erro ao atualizar status');
    } finally {
      setActionLoading(null);
    }
  }

  async function openAtendimento(item: Atendimento) {
    const id = String(item.id || '').trim();
    if (!id) {
      setError('Atendimento sem identificador válido.');
      return;
    }

    setActionLoading(item.id);
    setError(null);
    try {
      if (['QUEUE', 'FILA', 'TRIAGED'].includes(item.status)) {
        await updateStatus(id, 'EM_ATENDIMENTO', 'Atendimento iniciado pelo painel medico');
      }
    } catch {
      // Abre o prontuário mesmo se a transição de status falhar (ex.: rede).
    } finally {
      setActionLoading(null);
    }

    router.push(`/atendimento/${id}`);
  }

  async function deliverPrescription(item: Atendimento, channel: DeliveryChannel) {
    setActionLoading(`${item.id}-${channel}`);
    setError(null);
    setToast(null);
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/${item.id}/deliver`, {
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

  async function handleLogout() {
    await logout();
    window.location.href = '/login';
  }

  function renderActions(item: Atendimento, column: ColumnKey) {

    if (column === 'queue') {
      const waUrl = whatsappContactUrl(item.paciente_telefone);
      return (
        <div className="dp-patient-card__actions-slot dp-patient-card__actions-slot--queue-row">
          {waUrl ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="dp-btn dp-btn-secondary dp-btn-secondary-compact dp-btn-outline-soft inline-flex gap-1.5"
              aria-label={`Contato paciente — ${item.paciente_nome}`}
            >
              <MessageCircle className="h-3 w-3 shrink-0 text-[#25D366]" aria-hidden="true" />
              Contato paciente
            </a>
          ) : (
            <span className="dp-btn dp-btn-secondary dp-btn-secondary-compact dp-btn-outline-soft inline-flex cursor-default gap-1.5 opacity-70">
              <MessageCircle className="h-3 w-3 shrink-0 text-[#25D366]" aria-hidden="true" />
              Contato paciente
            </span>
          )}
          <div className="dp-action-slot">
            <button
              type="button"
              onClick={() => {
                void openAtendimento(item);
              }}
              disabled={actionLoading === item.id}
              className="dp-btn dp-btn-card-primary dp-btn-blue gap-1.5"
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
              ATENDER
            </button>
          </div>
        </div>
      );
    }

    if (column === 'review') {
      return (
        <div className="dp-patient-card__actions-slot dp-patient-card__actions-slot--pair">
          <div className="dp-actions-pair">
          <a
            href={`/atendimento/${item.id}`}
            className="dp-btn dp-btn-secondary dp-btn-secondary-pair dp-btn-outline-soft"
          >
            VISUALIZAR RECEITA
          </a>
          <button
            type="button"
            onClick={() => {
              void updateStatus(item.id, 'VALIDATED', 'Receita aceita pelo painel medico');
            }}
            disabled={actionLoading === item.id || item.status !== 'AWAITING_VALIDATION'}
            className="dp-btn dp-btn-card-primary dp-btn-orange"
          >
            ACEITAR RECEITA
          </button>
          </div>
        </div>
      );
    }

    if (column === 'closed') {
      return (
        <a
          href={`/atendimento/${item.id}`}
          className="dp-btn dp-btn-outline-soft px-4"
        >
          VER PRONTUÁRIO
        </a>
      );
    }

    const whatsappLoading = actionLoading === `${item.id}-whatsapp`;
    const emailLoading = actionLoading === `${item.id}-email`;
    const smsLoading = actionLoading === `${item.id}-sms`;

    return (
      <div className="dp-patient-card__actions-slot dp-patient-card__actions-slot--ready-row">
        <div className="dp-patient-card__secondary-stack">
          <button
            type="button"
            onClick={() => {
              void deliverPrescription(item, 'sms');
            }}
            disabled={smsLoading || !channelTarget(item, 'sms')}
            className="dp-btn dp-btn-secondary dp-btn-secondary-ready dp-btn-outline-soft"
          >
            {smsLoading ? 'ENVIANDO...' : 'ENVIAR POR SMS'}
          </button>
          <button
            type="button"
            onClick={() => {
              void deliverPrescription(item, 'email');
            }}
            disabled={emailLoading || !channelTarget(item, 'email')}
            className="dp-btn dp-btn-secondary dp-btn-secondary-ready dp-btn-outline-soft"
          >
            {emailLoading ? 'ENVIANDO...' : 'ENVIAR POR E-MAIL'}
          </button>
        </div>
        <div className="dp-action-slot">
          <button
            type="button"
            onClick={() => {
              void deliverPrescription(item, 'whatsapp');
            }}
            disabled={whatsappLoading || !channelTarget(item, 'whatsapp')}
            className="dp-btn dp-btn-card-primary dp-btn-green dp-btn-green-nowrap"
          >
            <MessageCircle aria-hidden="true" />
            {whatsappLoading ? 'ENVIANDO...' : 'ENVIAR POR WHATSAPP'}
          </button>
        </div>
      </div>
    );
  }

  function renderStatusBadge(item: Atendimento, column: ColumnKey) {
    if (column === 'queue') {
      return (
        <span className="dp-status-badge dp-status-badge-neutral">
          {waitingTime(item.criado_em)}
        </span>
      );
    }
    if (column === 'review') {
      return (
        <span className="dp-status-badge dp-status-badge-warn">
          Aguardando validação
        </span>
      );
    }
    if (column === 'ready') {
      return (
        <span className="dp-status-badge dp-status-badge-success">
          Receita validada
        </span>
      );
    }
    return (
      <span className="dp-status-badge dp-status-badge-muted">
        {statusLabel(item.status, column)}
      </span>
    );
  }

  if (loading) {
    return (
      <main className="flex h-[720px] w-full max-w-[1366px] items-center justify-center bg-[#F5F8FC] text-sm text-[#5B6475]">
        Carregando fila...
      </main>
    );
  }

  const visibleColumns = columns.filter((column) => column.key !== 'closed');

  return (
    <main
      className="relative flex h-[720px] w-full max-w-[1366px] flex-col overflow-hidden bg-[#F6F9FD] text-[#071B3A]"
    >
      <MedicalPanelHeader
        onLogout={handleLogout}
        onOpenMedicalRecord={() => {
          const first = medicalAtendimentos[0];
          if (first) window.location.href = `/atendimento/${first.id}`;
        }}
      />

      <div className="panel-page-body">
        <MedicalSupportBand patients={supportPatients} />

        <div className="sr-only" aria-hidden>
          <button type="button" onClick={() => { fetchAtendimentos(); fetchSupportQueue(); }}>
            Atualizar
          </button>
        </div>

        <div className="sr-only" aria-hidden>
        <div className="mb-2 gap-2 rounded-[8px] border border-[#E5EAF2] bg-white p-2 xl:grid xl:grid-cols-[1.25fr_0.75fr_0.75fr_0.75fr_auto]">
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
        </div>

        {error && (
          <div className="shrink-0 rounded-[14px] border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {toast && (
          <div className="fixed right-5 top-20 z-40 rounded-[14px] border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-[#0BA84F] shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
            {toast}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-3 items-stretch gap-4">
          {visibleColumns.map((column) => {
            const Icon = columnIcons[column.key as 'queue' | 'review' | 'ready'];
            return (
              <section
                key={column.key}
                className="dp-fila-column fila-column-scroll h-full min-h-0 min-w-0"
              >
                <div className="dp-fila-column__head flex shrink-0 items-center justify-between border-b border-[#E4ECF7] px-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`dp-col-heading-icon flex shrink-0 items-center justify-center rounded-full ${
                        column.key === 'ready' ? 'bg-[#E8F8EE] text-[#0B7F3C]' : 'bg-[#E8F1FF] text-[#1557FF]'
                      }`}
                    >
                      <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
                    </span>
                    <h2 className="dp-col-heading truncate">{column.title}</h2>
                  </div>
                  <span className={columnCountClass()}>{grouped[column.key].length}</span>
                </div>

                <div className="dp-fila-column__scroll space-y-3">
                  {grouped[column.key].length ? (
                    grouped[column.key].map((item) => {
                      const patientLabel = patientInitials(item.paciente_nome);
                      return (
                        <article key={item.id} className={`dp-patient-card dp-patient-card--${column.key}`}>
                          <div className="dp-patient-card__inner">
                            <div
                              className={`dp-patient-avatar dp-patient-initials shrink-0 ${
                                patientLabel.length > 5 ? 'dp-patient-initials--compact' : ''
                              }`}
                              title={item.paciente_nome}
                              aria-hidden="true"
                            >
                              {patientLabel}
                            </div>
                            <div className="dp-patient-card__main">
                              <div className="dp-patient-card__head">
                                <div className="min-w-0">
                                  <h3
                                    className={`dp-patient-card-label truncate ${
                                      patientLabel.length > 5 ? 'dp-patient-card-label--compact' : ''
                                    }`}
                                    title={item.paciente_nome}
                                  >
                                    {patientLabel}
                                  </h3>
                                  <p className="dp-patient-id">#{formatAttendanceId(item.id)}</p>
                                </div>
                                {renderStatusBadge(item, column.key)}
                              </div>

                              <div className="dp-patient-card__meta">
                                {column.key === 'review' && item.elegibilidade?.reason ? (
                                  <p className="dp-text-muted line-clamp-2 text-[11px] leading-4">{item.elegibilidade.reason}</p>
                                ) : null}
                                {column.key === 'ready' && latestDelivery(item) ? (
                                  <p className="dp-text-muted line-clamp-2 text-[11px] leading-4">
                                    Última entrega: {latestDelivery(item)?.status}
                                  </p>
                                ) : null}
                              </div>

                              <div className="dp-patient-card__actions">{renderActions(item, column.key)}</div>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <p className="dp-text-subtle rounded-[14px] border border-dashed border-[#E4ECF7] p-5 text-center text-[12px] font-semibold">
                      Sem atendimentos
                    </p>
                  )}
                </div>
                <div className="dp-fila-column__footer" aria-hidden="true">
                  <div className="dp-fila-column__cap" />
                </div>
              </section>
            );
          })}
        </div>

        {grouped.closed.length > 0 && (
          <section className="sr-only" aria-hidden>
            {grouped.closed.map((item) => (
              <a key={item.id} href={`/atendimento/${item.id}`}>
                {item.paciente_nome}
              </a>
            ))}
          </section>
        )}
      </div>

      <footer className="panel-footer">
        <span>
          Doctor Prescreve — Plataforma de Prescrição Médica | CNPJ: 50.871.173/0001-53 | © 2025 Todos os
          direitos reservados.
        </span>
      </footer>
    </main>
  );
}
