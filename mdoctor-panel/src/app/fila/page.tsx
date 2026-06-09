'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProntuarioOperacionalModal } from '@/components/medical-record/ProntuarioOperacionalModal';
import { MemedEmissionOverlay } from '@/components/memed/MemedEmissionOverlay';
import { CheckCircle2, Clock3, User, UserRound } from 'lucide-react';

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
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
  paciente_cpf?: string;
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
    medicacao_em_uso?: string;
    data_nascimento?: string;
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
    statuses: ['EM_ATENDIMENTO', 'UNDER_REVIEW', 'MEMED_PROCESSING', 'AWAITING_VALIDATION', 'RECEITA_EMITIDA'],
    title: 'EM ATENDIMENTO',
    badgeClass: 'bg-[#F4B000] text-white',
    headerMark: 'bg-[#EEF4FF] text-[#1557FF]'
  },
  {
    key: 'ready',
    statuses: ['VALIDATED', 'APROVADO'],
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

function missingMemedFields(item: Atendimento): string[] {
  const missing: string[] = [];
  if (!item.paciente_nome?.trim()) missing.push('nome');
  const cpf = (item.paciente_cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) missing.push('CPF');
  if (!item.dados_clinicos?.data_nascimento) missing.push('data de nascimento');
  const phone = (item.paciente_telefone || '').replace(/\D/g, '');
  const phoneNorm = phone.startsWith('55') && phone.length >= 12 ? phone.slice(2) : phone;
  if (phoneNorm.length < 10 || phoneNorm.length > 11) missing.push('telefone válido (10–11 dígitos)');
  if (!item.dados_clinicos?.medicacao_em_uso?.trim()) missing.push('medicamento');
  return missing;
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
  const searchParams = useSearchParams();
  const [prontuarioId, setProntuarioId] = useState<string | null>(null);
  const [memedOverlayId, setMemedOverlayId] = useState<string | null>(null);
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
      review: filteredAtendimentos.filter((item) => ['EM_ATENDIMENTO', 'UNDER_REVIEW', 'MEMED_PROCESSING', 'AWAITING_VALIDATION', 'RECEITA_EMITIDA'].includes(item.status)).length,
      ready: filteredAtendimentos.filter((item) => ['VALIDATED', 'APROVADO'].includes(item.status)).length,
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
      const { isVisualSimulationMode, getVisualSimulationAtendimentos } = await import(
        '@/lib/visual-simulation-fila'
      );
      const res = await fetch(`${getApiBase()}/api/atendimentos/queue`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao buscar atendimentos');
      const rows = (data.atendimentos || []).map((item: Atendimento) => ({
        ...item,
        status: toPanelAtendimentoStatus(item.status),
      }));
      // Somente pacientes elegíveis com dados completos são exibidos no painel.
      const eligibleRows = rows.filter((item: Atendimento) => {
        if (item.elegibilidade?.eligible === false) return false;
        if (missingMemedFields(item).length > 0) return false;
        return true;
      });
      if (isVisualSimulationMode()) {
        const simRows = getVisualSimulationAtendimentos().map((item) => ({
          ...item,
          status: toPanelAtendimentoStatus(item.status),
        })) as Atendimento[];
        setAtendimentos(simRows.length ? simRows : eligibleRows);
      } else {
        setAtendimentos(eligibleRows);
      }
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
    const fromUrl =
      searchParams.get('atendimentoId')?.trim() || searchParams.get('atendimento')?.trim() || null;
    if (fromUrl) setProntuarioId(fromUrl);
  }, [searchParams]);

  function syncProntuarioUrl(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('atendimento');
    if (id) params.set('atendimentoId', id);
    else params.delete('atendimentoId');
    const query = params.toString();
    router.replace(query ? `/fila?${query}` : '/fila', { scroll: false });
  }

  function openProntuarioModal(id: string) {
    setProntuarioId(id);
    syncProntuarioUrl(id);
  }

  function closeProntuarioModal() {
    setProntuarioId(null);
    syncProntuarioUrl(null);
  }

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

    openProntuarioModal(id);

    if (['QUEUE', 'FILA', 'TRIAGED'].includes(item.status)) {
      setActionLoading(item.id);
      try {
        await updateStatus(id, 'EM_ATENDIMENTO', 'Atendimento iniciado pelo painel medico');
      } catch {
        /* modal já aberto; status pode falhar sem bloquear UX */
      } finally {
        setActionLoading(null);
      }
    }
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
      const missing = missingMemedFields(item);
      const blocked = missing.length > 0;
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
              <WhatsAppIcon className="h-3 w-3 shrink-0 text-[#25D366]" />
              Contato paciente
            </a>
          ) : (
            <span className="dp-btn dp-btn-secondary dp-btn-secondary-compact dp-btn-outline-soft inline-flex cursor-default gap-1.5 opacity-70">
              <WhatsAppIcon className="h-3 w-3 shrink-0 text-[#25D366]" />
              Contato paciente
            </span>
          )}
          {blocked ? (
            <div className="dp-action-slot flex flex-col items-end gap-1">
              <span className="rounded-[6px] bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                Cadastro incompleto: {missing.join(', ')}
              </span>
              <button
                type="button"
                disabled
                className="dp-btn dp-btn-card-primary dp-btn-blue gap-1.5 cursor-not-allowed opacity-40"
              >
                <UserRound className="h-4 w-4" aria-hidden="true" />
                ATENDER
              </button>
            </div>
          ) : (
            <div className="dp-action-slot">
              <button
                type="button"
                onClick={() => { void openAtendimento(item); }}
                disabled={actionLoading === item.id}
                className="dp-btn dp-btn-card-primary dp-btn-blue gap-1.5"
              >
                <UserRound className="h-4 w-4" aria-hidden="true" />
                ATENDER
              </button>
            </div>
          )}
        </div>
      );
    }

    if (column === 'review') {
      return (
        <div className="dp-patient-card__actions-slot dp-patient-card__actions-slot--review-stack">
          <button
            type="button"
            onClick={() => {
              const url = item.dados_clinicos?.memed_receita?.pdfUrl || item.dados_clinicos?.memed_receita?.receitaUrl;
              if (url) window.open(url, '_blank', 'noopener,noreferrer');
              else router.push(`/receita?atendimentoId=${encodeURIComponent(item.id)}`);
            }}
            className="dp-btn dp-btn-secondary dp-btn-review-stack dp-btn-outline-soft"
          >
            VISUALIZAR RECEITA
          </button>
          <button
            type="button"
            onClick={() => {
              void updateStatus(item.id, 'VALIDATED', 'Receita aceita pelo painel medico');
            }}
            disabled={actionLoading === item.id || !['AWAITING_VALIDATION', 'RECEITA_EMITIDA'].includes(item.status)}
            className="dp-btn dp-btn-card-primary dp-btn-review-stack dp-btn-orange"
          >
            ACEITAR RECEITA
          </button>
        </div>
      );
    }

    if (column === 'closed') {
      return (
        <button
          type="button"
          onClick={() => openProntuarioModal(item.id)}
          className="dp-btn dp-btn-outline-soft px-4"
        >
          VER PRONTUÁRIO
        </button>
      );
    }

    const whatsappLoading = actionLoading === `${item.id}-whatsapp`;
    const emailLoading = actionLoading === `${item.id}-email`;
    const smsLoading = actionLoading === `${item.id}-sms`;

    return (
      <div className="dp-patient-card__actions-slot dp-patient-card__actions-slot--ready-stack">
        <div className="dp-patient-card__ready-secondary">
          <button
            type="button"
            onClick={() => {
              void deliverPrescription(item, 'sms');
            }}
            disabled={smsLoading || !channelTarget(item, 'sms')}
            className="dp-btn dp-btn-secondary dp-btn-ready-mini dp-btn-outline-soft"
          >
            {smsLoading ? 'ENVIANDO...' : 'SMS'}
          </button>
          <button
            type="button"
            onClick={() => {
              void deliverPrescription(item, 'email');
            }}
            disabled={emailLoading || !channelTarget(item, 'email')}
            className="dp-btn dp-btn-secondary dp-btn-ready-mini dp-btn-outline-soft"
          >
            {emailLoading ? 'ENVIANDO...' : 'E-MAIL'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            void deliverPrescription(item, 'whatsapp');
          }}
          disabled={whatsappLoading || !channelTarget(item, 'whatsapp')}
          className="dp-btn dp-btn-card-primary dp-btn-ready-wa dp-btn-green"
        >
          <WhatsAppIcon className="h-3.5 w-3.5 shrink-0" />
          {whatsappLoading ? 'ENVIANDO...' : 'WHATSAPP'}
        </button>
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
      <main className="flex min-h-[40vh] w-full max-w-[1366px] items-center justify-center bg-[#F5F8FC] text-sm text-[#5B6475]">
        Carregando fila...
      </main>
    );
  }

  const visibleColumns = columns.filter((column) => column.key !== 'closed');

  return (
    <main
      className="relative flex min-h-0 w-full max-w-[1366px] flex-1 flex-col overflow-hidden bg-[#F6F9FD] text-[#071B3A]"
    >
      <MedicalPanelHeader
        operational
        onLogout={handleLogout}
        onOpenMedicalRecord={() => {
          const first = medicalAtendimentos[0];
          if (first) openProntuarioModal(first.id);
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

        <div className="grid min-h-0 flex-1 grid-cols-3 items-stretch gap-3">
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

                <div className="dp-fila-column__scroll space-y-2">
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

      <ProntuarioOperacionalModal
        atendimentoId={prontuarioId}
        open={Boolean(prontuarioId)}
        onClose={closeProntuarioModal}
        onCompleted={() => {
          void fetchAtendimentos();
        }}
        onApproved={(id) => {
          closeProntuarioModal();
          setMemedOverlayId(id);
        }}
      />

      {memedOverlayId && (
        <MemedEmissionOverlay
          atendimentoId={memedOverlayId}
          onClose={() => setMemedOverlayId(null)}
          onComplete={() => {
            setMemedOverlayId(null);
            void fetchAtendimentos();
          }}
        />
      )}
    </main>
  );
}
