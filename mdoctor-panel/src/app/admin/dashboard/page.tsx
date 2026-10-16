'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Users as UsersIcon, CheckCircle2, XCircle, AlertTriangle, Eye } from 'lucide-react';
import { logout, requireSession } from '@/services/auth.service';
import {
  fetchAdminDashboard,
  fetchAdminAtendimentos,
  fetchSupportConversations,
  resolveAdminNote,
  type AdminAtendimento,
  type AdminDashboard,
  type SupportConversation,
} from '@/services/admin.service';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';
import { PendenciasDrawer } from '@/components/admin/PendenciasDrawer';
import { SupportChatColumn } from '@/components/admin/SupportChatColumn';
import { avatarInitials } from '@/lib/patient-display';

// Seção 2 — Cards Quantitativos: mesmos 6 indicadores já existentes hoje no
// Painel Administrativo (fetchAdminDashboard), apenas reposicionados na nova
// arquitetura. Nenhum cálculo novo.
const CARDS = [
  {
    key: 'pronto_para_avaliacao' as const,
    label: 'Pronto para avaliação médica',
    emoji: '🩺',
    bg: 'bg-[#EEF4FF]',
    border: 'border-[#BFD0FF]',
    filter: 'pronto_avaliacao',
  },
  {
    key: 'aguardando_pagamento' as const,
    label: 'Aguardando pagamento',
    emoji: '💰',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    filter: 'aguardando_pagamento',
  },
  {
    key: 'aguardando_receita_anterior' as const,
    label: 'Aguardando receita anterior',
    emoji: '📄',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    filter: 'aguardando_receita',
  },
  {
    key: 'em_atendimento' as const,
    label: 'Em atendimento médico',
    emoji: '⚕️',
    bg: 'bg-[#EEF4FF]',
    border: 'border-[#BFD0FF]',
    filter: 'em_atendimento',
  },
  {
    key: 'receitas_prontas' as const,
    label: 'Receitas prontas para envio',
    emoji: '✅',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    filter: 'receitas_prontas',
  },
  {
    key: 'pendencias_admin' as const,
    label: 'Pendências administrativas',
    emoji: '🔴',
    bg: 'bg-red-50',
    border: 'border-red-200',
    filter: 'pendencias_admin',
  },
];

// Seção 5 — Corpo Principal: reaproveita exatamente as regras de agrupamento
// já existentes em admin/pacientes (isReady) e no grupo "danger" de
// statusTone (rejected/recusado/cancelado), e o mesmo filtro de pendências
// administrativas já usado em pendencias_admin. Nenhuma regra nova.
// Inclui "delivered": receita já emitida e entregue é um caso aprovado
// (só avançou de estágio dentro da fila), não deixa de ser aprovação.
function isApproved(a: AdminAtendimento) {
  const v = (a.status || '').toLowerCase();
  return ['ready', 'validated', 'aprovado', 'delivered', 'finished'].includes(v);
}

function isRejected(a: AdminAtendimento) {
  const v = (a.status || '').toLowerCase();
  return ['rejected', 'recusado', 'cancelado'].includes(v);
}

function firstPendingAdminNote(a: AdminAtendimento) {
  return (a.dados_clinicos?.observacoes_admin || []).find((n) => !n.resolvido) || null;
}

function isWaitingForPayment(a: AdminAtendimento) {
  const status = (a.status || '').toLowerCase();
  const waiting = ['waiting', 'queue', 'fila', 'triaged'].includes(status);
  return waiting && String(a.pagamento_status || '').toUpperCase() !== 'CONFIRMADO';
}

function isAdministrativePending(a: AdminAtendimento) {
  return (
    firstPendingAdminNote(a) !== null ||
    (a.status || '').toLowerCase() === 'awaiting_prescription_upload' ||
    isWaitingForPayment(a)
  );
}

function administrativePendingReason(a: AdminAtendimento): string {
  const note = firstPendingAdminNote(a);
  if (note) return note.texto;
  if ((a.status || '').toLowerCase() === 'awaiting_prescription_upload') {
    return 'Receita anterior não enviada';
  }
  if (isWaitingForPayment(a)) return 'Pagamento não confirmado';
  return 'Pendência administrativa';
}

// Rótulos de encerramento de suporte via WhatsApp (whatsapp-support.service.js
// SUPPORT_SUB) — não são motivo de reprovação clínica, então não usam o texto
// genérico de elegibilidade.reason (que fica sem sentido aqui, ex.: mostrar
// "Aguardando atendimento humano" para um ticket que já foi encerrado).
const SUPPORT_SUB_STATUS_LABELS: Record<string, string> = {
  closed_by_patient: 'Suporte encerrado pelo paciente',
  closed_inactive: 'Suporte encerrado por inatividade',
  converted_to_renewal: 'Suporte convertido em renovação',
  awaiting_patient_decision: 'Suporte aguardando decisão do paciente',
  em_atendimento: 'Suporte em atendimento',
  waiting: 'Suporte aguardando atendimento',
};

// Motivo de reprovação: reaproveita dados_clinicos.motivo_rejeicao (já
// gravado pelo médico em /clinical/reject — ver clinical-decision.service.js)
// e o campo elegibilidade já existente para o caso de reprovação automática
// na triagem (sem revisão médica). Nenhuma classificação nova é criada.
function rejectionMotivo(a: AdminAtendimento): string {
  if (a.elegibilidade?.reasonCode === 'human_support') {
    const sub = a.dados_clinicos?.support_sub_status;
    return (sub && SUPPORT_SUB_STATUS_LABELS[sub]) || 'Ticket de suporte via WhatsApp';
  }
  const manual = a.dados_clinicos?.motivo_rejeicao;
  if (manual?.label) return manual.detail ? `${manual.label} — ${manual.detail}` : manual.label;
  return a.elegibilidade?.reason || '—';
}

// Sem ano (DD/MM): operação é sempre do ano corrente, e o espaço ganho vai
// para nome/patologia/motivo, que são os campos com prioridade de leitura.
function fmtDate(v?: string) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(new Date(v));
}

function fmtTime(v?: string) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(v));
}

// Data e hora unificadas numa única informação (ex.: "26/07 • 21:07"), em vez
// de duas colunas separadas — reduz a quantidade de blocos visuais na linha.
function fmtDateTime(v?: string) {
  if (!v) return '—';
  return `${fmtDate(v)} • ${fmtTime(v)}`;
}

// Condição clínica padronizada em maiúsculas com "•" como separador
// (ex.: "has,dm" → "HAS • DM"), em vez do formato bruto salvo no banco.
function formatCondicao(condicao?: string): string {
  if (!condicao) return '—';
  return condicao
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' • ')
    .toUpperCase();
}

// 'pending' continua existindo como valor de BodyColumnKey — PatientRow
// ainda é usado com column="pending" dentro do drawer de Pendências
// Administrativas (ver PendenciasDrawer), só não faz mais parte do grid de
// 3 colunas (bodyColumns abaixo tem só approved/rejected agora; a coluna 3
// passou a ser SupportChatColumn).
type BodyColumnKey = 'approved' | 'rejected' | 'pending';

const bodyColumns: Array<{
  key: BodyColumnKey;
  title: string;
  icon: typeof CheckCircle2;
  iconClass: string;
  topBorderClass: string;
  headBgClass: string;
  countBadgeClass: string;
  match: (a: AdminAtendimento) => boolean;
}> = [
  {
    key: 'approved',
    title: 'PACIENTES APROVADOS',
    icon: CheckCircle2,
    iconClass: 'bg-[#E8F8EE] text-[#0B7F3C]',
    topBorderClass: 'border-t-4 border-t-[#0BA84F]',
    headBgClass: 'bg-[#E8F8EE]',
    countBadgeClass: 'border-[#B91C2B]/30 bg-[#B91C2B] text-white',
    match: isApproved,
  },
  {
    key: 'rejected',
    title: 'PACIENTES REJEITADOS',
    icon: XCircle,
    iconClass: 'bg-slate-100 text-[#5B6475]',
    topBorderClass: 'border-t-4 border-t-[#B91C2B]',
    headBgClass: 'bg-slate-100',
    countBadgeClass: 'border-[#B91C2B]/30 bg-[#B91C2B] text-white',
    match: isRejected,
  },
];

// Seção 4 — Indicadores de Tempo Médio: calculados pelo backend
// (/api/admin/dashboard → tempos, ver computeTempos em admin.routes.js) a
// partir de timestamps reais já gravados no fluxo (jornada.triagem_iniciada_em,
// criado_em da entrada na fila, medical_decisions da transição
// "em_atendimento", clinical_audit.approvedAt/rejectedAt,
// entrega_receita.sent_at e jornada.primeiro_oi_em). "Suporte
// administrativo"/"Suporte médico" não têm evento distinto — recebem "—" em
// vez de um número fabricado (o backend retorna null nesses casos).
const TIME_METRIC_KEYS = [
  'pagamento_fila',
  'triagem',
  'espera_medica',
  'avaliacao',
  'emissao_receita',
  'suporte_administrativo',
  'suporte_medico',
  'jornada_completa',
] as const;

const TIME_METRIC_LABELS: Record<(typeof TIME_METRIC_KEYS)[number], string> = {
  pagamento_fila: 'Fila Pagamento',
  triagem: 'Triagem Clínica',
  espera_medica: 'Espera Atendimento Médico',
  avaliacao: 'Atendimento Médico',
  emissao_receita: 'Emissão da Receita',
  suporte_administrativo: 'Suporte Administrativo',
  suporte_medico: 'Suporte Médico',
  jornada_completa: 'Jornada Completa',
};

// Amostra própria de cada indicador (nº de atendimentos reais que entraram no
// cálculo). "Suporte adm/médico" não têm evento no modelo de dados — sem
// amostra. Evita o "amostra: 0" genérico enganoso no cabeçalho.
const TIME_METRIC_SAMPLE_KEYS: Partial<Record<(typeof TIME_METRIC_KEYS)[number], string>> = {
  pagamento_fila: 'pagamento_fila',
  triagem: 'triagem',
  espera_medica: 'espera_medica',
  avaliacao: 'avaliacao',
  emissao_receita: 'emissao_receita',
  jornada_completa: 'jornada_completa',
};

function metricTileClass(bg: string, border: string, interactive: boolean) {
  return `flex flex-col items-start rounded-[10px] border p-2 text-left shadow-[0_1px_4px_rgba(0,0,0,0.04)] transition-all ${
    interactive ? 'hover:-translate-y-0.5 hover:shadow-[0_4px_10px_rgba(0,0,0,0.08)]' : ''
  } ${bg} ${border}`;
}

function MetricTileContent({
  emoji,
  value,
  label,
  sample,
}: {
  emoji: string;
  value: ReactNode;
  label: string;
  sample?: string;
}) {
  return (
    <>
      <span className="text-base leading-none" aria-hidden>
        {emoji}
      </span>
      <span className="mt-1 text-[17px] font-black leading-none text-[#1E1E1E]">{value}</span>
      <span className="mt-0.5 text-[9px] font-bold leading-tight text-[#5B6475]">{label}</span>
      {sample !== undefined && (
        <span className="mt-0.5 text-[8px] font-semibold leading-tight text-[#94A3B8]">{sample}</span>
      )}
    </>
  );
}

// Identificador curto do atendimento (numero_curto, backfillado por migração
// em 27/07) — usado só nas colunas do painel (tela de monitoramento) para
// deixar claro que cada linha é um ATENDIMENTO, não um paciente, sem repetir
// o nome completo várias vezes. A Jornada do Atendimento (tela de detalhe)
// continua mostrando o nome completo normalmente — nada mudou lá.
function shortId(item: AdminAtendimento): string {
  return item.numero_curto ? `DP-${item.numero_curto}` : `#${item.id.slice(0, 8)}`;
}

// Linha operacional do atendimento — NÃO é card: sem borda ao redor, sem
// fundo próprio, sem cantos arredondados, sem hover na linha inteira. Só uma
// divisória fina embaixo, como item de lista/tabela. Único elemento
// clicável da linha são os botões de ação.
// Avatar (iniciais) | Nº do atendimento | Data | Horário | campo específico da coluna | ação.
function PatientRow({
  column,
  item,
  onVerJornada,
  onResolveNote,
  resolvingNoteId,
}: {
  column: BodyColumnKey;
  item: AdminAtendimento;
  onVerJornada: () => void;
  onResolveNote: (atendimentoId: string, noteId: string) => void;
  resolvingNoteId: string | null;
}) {
  const verJornadaBtn = (
    <button
      type="button"
      onClick={onVerJornada}
      title="Ver jornada do atendimento"
      aria-label="Ver jornada do atendimento"
      className="flex h-6 w-6 items-center justify-center rounded-[7px] border-2 border-[#1557FF] bg-white text-[#1557FF] hover:bg-[#EEF4FF]"
    >
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );

  return (
    <div className="flex items-center gap-1.5 border-b border-[#EEF2F7] px-1 py-1.5 last:border-0">
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0F1D38] text-[8.5px] font-bold text-white"
        title={item.paciente_nome}
        aria-hidden="true"
      >
        {avatarInitials(item.paciente_nome)}
      </div>
      <span className="min-w-[66px] shrink-0 text-[13px] font-black text-[#071B3A]" title={item.paciente_nome}>
        {shortId(item)}
      </span>
      <span className="w-[92px] shrink-0 text-[10px] text-[#5B6475]">{fmtDateTime(item.criado_em)}</span>

      {column === 'approved' && (
        <>
          <span className="w-[110px] shrink-0 truncate text-[10.5px] text-[#5B6475]" title={formatCondicao(item.condicao)}>
            {formatCondicao(item.condicao)}
          </span>
          {verJornadaBtn}
        </>
      )}

      {column === 'rejected' && (
        <>
          <span className="w-[110px] shrink-0 truncate text-[10.5px] text-[#5B6475]" title={rejectionMotivo(item)}>
            {rejectionMotivo(item)}
          </span>
          {verJornadaBtn}
        </>
      )}

      {column === 'pending' && (() => {
        const note = firstPendingAdminNote(item);
        const resolving = note ? resolvingNoteId === note.id : false;
        return (
          <>
            <span className="min-w-[90px] flex-1 truncate text-[10.5px] text-[#5B6475]" title={administrativePendingReason(item)}>
              {administrativePendingReason(item)}
            </span>
            {note ? (
              <div className="w-[84px] shrink-0">
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => onResolveNote(item.id, note.id)}
                  className="w-full rounded-[7px] border-2 border-[#B45309] bg-white px-2 py-1 text-[9.5px] font-bold text-[#B45309] hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resolving ? 'Resolvendo...' : 'Resolver'}
                </button>
              </div>
            ) : verJornadaBtn}
          </>
        );
      })()}
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [atendimentos, setAtendimentos] = useState<AdminAtendimento[]>([]);
  const [supportConversations, setSupportConversations] = useState<SupportConversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingNoteId, setResolvingNoteId] = useState<string | null>(null);
  const [isPendingDrawerOpen, setPendingDrawerOpen] = useState(false);

  async function refreshAtendimentos() {
    try {
      const list = await fetchAdminAtendimentos();
      setAtendimentos(list.atendimentos || []);
    } catch {
      /* mantém a lista anterior — próximo ciclo tenta de novo */
    }
  }

  async function refreshDashboard() {
    try {
      const dashboard = await fetchAdminDashboard();
      setData(dashboard);
    } catch {
      /* mantém os cards/indicadores anteriores — próximo ciclo tenta de novo */
    }
  }

  async function handleResolveNote(atendimentoId: string, noteId: string) {
    setResolvingNoteId(noteId);
    try {
      await resolveAdminNote(atendimentoId, noteId);
      await refreshAtendimentos();
    } catch {
      /* best-effort — usuário pode tentar de novo */
    } finally {
      setResolvingNoteId(null);
    }
  }

  // Fila do Chat Administrativo de Suporte V1 — substitui o antigo polling
  // de /api/atendimentos/support-queue (ticket WhatsApp + wa.me externo,
  // eliminado desta página; MedicalSupportBand e o Painel Médico continuam
  // usando esse fluxo antigo, intocados). Best-effort: com
  // SUPPORT_CHAT_UI_ENABLED desligada, a API responde 503 e a fila
  // simplesmente fica vazia, sem erro visível.
  async function fetchSupportConversationsForPage() {
    try {
      const res = await fetchSupportConversations();
      setSupportConversations(res.success ? res.conversations : []);
    } catch {
      setSupportConversations([]);
    }
  }

  useEffect(() => {
    requireSession()
      .then(() => Promise.all([fetchAdminDashboard(), fetchAdminAtendimentos(), fetchSupportConversationsForPage()]))
      .then(([dashboard, list]) => {
        setData(dashboard);
        setAtendimentos(list.atendimentos || []);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Erro ao carregar dashboard';
        setError(msg);
        if (msg.toLowerCase().includes('sess')) router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  // Lista dinâmica: mesma cadência de atualização automática do Painel
  // Médico (fila/page.tsx) — pacientes sobem/descem de coluna conforme o
  // status muda, sem precisar recarregar a página. Mesmo timer único de
  // sempre — só ganhou mais uma chamada, não um segundo polling paralelo.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshAtendimentos();
        void refreshDashboard();
        void fetchSupportConversationsForPage();
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const grouped = useMemo(() => {
    // Atendimentos encaminhados ao médico (fluxo Suporte Médico) somem das
    // colunas administrativas enquanto aguardam resposta — reaparecem quando
    // o médico resolve ou devolve ao suporte.
    const visiveis = atendimentos.filter((a) => a.dados_clinicos?.queue_type !== 'medical_support');
    const base = bodyColumns.reduce<Record<BodyColumnKey, AdminAtendimento[]>>(
      (acc, column) => {
        acc[column.key] = visiveis.filter(column.match);
        return acc;
      },
      { approved: [], rejected: [], pending: [] },
    );
    // Pendências administrativas: não faz mais parte do grid de 3 colunas,
    // mas continua sendo calculada aqui — agora alimenta o drawer.
    base.pending = visiveis.filter(isAdministrativePending);
    return base;
  }, [atendimentos]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-[#5B6475]">
        Carregando painel administrativo...
      </main>
    );
  }

  return (
    <main className="admin-dashboard flex min-h-screen w-full flex-col bg-[#F6F9FD] text-[#071B3A]">
      <MedicalPanelHeader
        operational
        title="Painel Administrativo"
        titleAlign="left"
        recordButtonLabel="Relação de Pacientes"
        recordButtonIcon={<UsersIcon className="h-4 w-4" aria-hidden="true" />}
        onOpenMedicalRecord={() => router.push('/admin/pacientes')}
        secondaryButtonLabel="Pendências administrativas"
        secondaryButtonIcon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
        onOpenSecondary={() => setPendingDrawerOpen(true)}
        onLogout={handleLogout}
      />

      <div className="admin-dashboard__content mx-auto w-full max-w-[1280px] space-y-3 p-3 sm:p-4">
        {error && (
          <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Composição desktop baseada no mock aprovado:
                 - colunas 1+2: cards quantitativos -> indicadores -> financeiro -> pacientes;
                 - coluna 3: suporte começa logo abaixo da faixa dourada, ao lado dos cards quantitativos;
                 - suporte segue até a base; somente o conteúdo interno das três colunas rola. */}
            <div className="admin-dashboard__main-grid grid grid-cols-1 gap-2 lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_minmax(0,1fr)]">
              <section className="lg:col-start-1 lg:col-end-3 lg:row-start-1 lg:row-end-2">
                <div className="admin-dashboard__summary grid grid-cols-6 gap-1.5">
                  {CARDS.map((card) => {
                    const count = data.cards[card.key] ?? 0;
                    return (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => router.push(`/admin/pacientes?filter=${card.filter}`)}
                        className={metricTileClass(card.bg, card.border, true)}
                      >
                        <MetricTileContent emoji={card.emoji} value={count} label={card.label} />
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="admin-dashboard__time-zone lg:col-start-1 lg:col-end-3 lg:row-start-2 lg:row-end-3">
                <p className="admin-dashboard__time-heading">
                  Indicadores de tempo médio
                  <span className="admin-dashboard__time-heading-note">
                    · cada indicador mostra a própria amostra de atendimentos reais
                  </span>
                </p>
                <div className="admin-dashboard__time" aria-label="Indicadores de tempo médio">
                  {TIME_METRIC_KEYS.map((key) => {
                    const sampleKey = TIME_METRIC_SAMPLE_KEYS[key];
                    const sampleCount = sampleKey
                      ? data.tempos.amostra_por_indicador?.[sampleKey]
                      : undefined;
                    const sampleLabel =
                      sampleCount === undefined
                        ? undefined
                        : `${sampleCount} atend.${sampleCount === 0 ? ' — sem dados ainda' : ''}`;
                    return (
                      <div
                        key={key}
                        className="admin-dashboard__time-tile"
                        data-metric={key}
                        title={`${TIME_METRIC_LABELS[key]}: ${data.tempos[key] ?? '—'}${sampleLabel ? ` · ${sampleLabel}` : ''}`}
                        aria-label={`${TIME_METRIC_LABELS[key]}: ${data.tempos[key] ?? '—'}${sampleLabel ? ` · ${sampleLabel}` : ''}`}
                      >
                        <span className="admin-dashboard__time-icon" aria-hidden="true">⏱️</span>
                        <span className="admin-dashboard__time-value">{data.tempos[key] ?? '—'}</span>
                        <svg
                          className="admin-dashboard__time-label-arc"
                          viewBox="0 0 100 100"
                          aria-hidden="true"
                        >
                          <defs>
                            <path
                              id={`time-label-path-${key}`}
                              d="M 5 68 Q 50 94 95 68"
                            />
                          </defs>
                          <text>
                            <textPath
                              href={`#time-label-path-${key}`}
                              startOffset="50%"
                              textAnchor="middle"
                            >
                              {TIME_METRIC_LABELS[key]}
                            </textPath>
                          </text>
                        </svg>
                      </div>
                    );
                  })}
                </div>
              </section>

              <div className="lg:col-start-1 lg:col-end-3 lg:row-start-3 lg:row-end-4">
                <div className="admin-dashboard__finance grid grid-cols-3 gap-1.5">
                  <div className={metricTileClass('bg-emerald-50', 'border-emerald-200', false)}>
                    <MetricTileContent emoji="💵" value={data.financeiro.receita_total_label} label="Receita confirmada" />
                  </div>
                  <div className={metricTileClass('bg-emerald-50', 'border-emerald-200', false)}>
                    <MetricTileContent emoji="🧾" value={data.financeiro.atendimentos_pagos} label="Atendimentos pagos" />
                  </div>
                  <div className={metricTileClass('bg-emerald-50', 'border-emerald-200', false)}>
                    <MetricTileContent emoji="🏷️" value={data.financeiro.valor_unitario_label} label="Valor por consulta" />
                  </div>
                </div>
              </div>

              <div className="admin-dashboard__support-cell lg:col-start-3 lg:col-end-4 lg:row-start-1 lg:row-end-5">
                <SupportChatColumn conversations={supportConversations} />
              </div>

              {bodyColumns.map((column, index) => {
                const Icon = column.icon;
                const items = grouped[column.key];
                return (
                  <section
                    key={column.key}
                    className={`admin-dashboard-journey-card flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[#E4ECF7] bg-[#F7FAFF] shadow-[0_2px_8px_rgba(15,23,42,0.04)] lg:row-start-4 lg:row-end-5 ${
                      index === 0 ? 'lg:col-start-1 lg:col-end-2' : 'lg:col-start-2 lg:col-end-3'
                    } ${column.topBorderClass}`}
                  >
                    <div
                      className={`flex shrink-0 items-center justify-between border-b border-[#E4ECF7] px-2.5 py-1.5 ${column.headBgClass}`}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${column.iconClass}`}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <h2 className="truncate text-[11px] font-black tracking-[0.02em] text-[#071B3A]">{column.title}</h2>
                      </div>
                      <span className={`dp-col-count ${column.countBadgeClass}`}>{items.length}</span>
                    </div>

                    <div className="overflow-y-auto">
                      {items.length ? (
                        items.map((item) => (
                          <PatientRow
                            key={item.id}
                            column={column.key}
                            item={item}
                            onVerJornada={() => router.push(`/admin/paciente/${item.id}`)}
                            onResolveNote={handleResolveNote}
                            resolvingNoteId={resolvingNoteId}
                          />
                        ))
                      ) : (
                        <p className="dp-text-subtle rounded-[10px] border border-dashed border-[#E4ECF7] p-3 text-center text-[11px] font-semibold">
                          Sem atendimentos
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>

      <PendenciasDrawer
        isOpen={isPendingDrawerOpen}
        onClose={() => setPendingDrawerOpen(false)}
        count={grouped.pending.length}
      >
        {grouped.pending.length ? (
          grouped.pending.map((item) => (
            <PatientRow
              key={item.id}
              column="pending"
              item={item}
              onVerJornada={() => router.push(`/admin/paciente/${item.id}`)}
              onResolveNote={handleResolveNote}
              resolvingNoteId={resolvingNoteId}
            />
          ))
        ) : (
          <p className="dp-text-subtle p-4 text-center text-[11px] font-semibold">Sem pendências administrativas</p>
        )}
      </PendenciasDrawer>
    </main>
  );
}
