'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Users as UsersIcon, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { authHeaders, logout, requireSession } from '@/services/auth.service';
import { getApiBase } from '@/services/api';
import {
  fetchAdminDashboard,
  fetchAdminAtendimentos,
  resolveAdminNote,
  type AdminAtendimento,
  type AdminDashboard,
} from '@/services/admin.service';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';
import { MedicalSupportBand, type SupportQueueItem } from '@/components/medical/MedicalSupportBand';
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
function isApproved(a: AdminAtendimento) {
  const v = (a.status || '').toLowerCase();
  return ['ready', 'validated', 'aprovado'].includes(v);
}

function isRejected(a: AdminAtendimento) {
  const v = (a.status || '').toLowerCase();
  return ['rejected', 'recusado', 'cancelado'].includes(v);
}

function firstPendingAdminNote(a: AdminAtendimento) {
  return (a.dados_clinicos?.observacoes_admin || []).find((n) => !n.resolvido) || null;
}

function hasPendingAdminNote(a: AdminAtendimento) {
  return firstPendingAdminNote(a) !== null;
}

// Motivo/etapa de reprovação: reaproveita dados_clinicos.motivo_rejeicao (já
// gravado pelo médico em /clinical/reject — ver clinical-decision.service.js)
// e o campo elegibilidade já existente para o caso de reprovação automática
// na triagem (sem revisão médica). Nenhuma classificação nova é criada.
function rejectionMotivo(a: AdminAtendimento): string {
  const manual = a.dados_clinicos?.motivo_rejeicao;
  if (manual?.label) return manual.detail ? `${manual.label} — ${manual.detail}` : manual.label;
  return a.elegibilidade?.reason || '—';
}

function rejectionEtapa(a: AdminAtendimento): string {
  return a.dados_clinicos?.motivo_rejeicao ? 'Avaliação médica' : 'Triagem';
}

function fmtDate(v?: string) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(v));
}

function fmtTime(v?: string) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(v));
}

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
    countBadgeClass: 'border-[#0BA84F]/30 bg-[#0BA84F] text-white',
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
  {
    key: 'pending',
    title: 'PENDÊNCIAS ADMINISTRATIVAS',
    icon: AlertTriangle,
    iconClass: 'bg-amber-100 text-amber-800',
    topBorderClass: 'border-t-4 border-t-amber-500',
    headBgClass: 'bg-amber-50',
    countBadgeClass: 'border-amber-500/30 bg-amber-500 text-white',
    match: hasPendingAdminNote,
  },
];

// Seção 4 — Indicadores de Tempo Médio: apenas placeholders visuais, sem
// nenhuma lógica/endpoint novo (implementação prevista para fase futura).
// Usa o mesmo componente/estilo dos Cards Quantitativos (metricTileClass +
// MetricTileContent), só com cor neutra e valor fixo "—".
const TIME_PLACEHOLDERS = [
  'Triagem',
  'Espera médica',
  'Avaliação',
  'Emissão da receita',
  'Jornada completa',
  'Suporte administrativo',
  'Suporte médico',
];

function metricTileClass(bg: string, border: string, interactive: boolean) {
  return `flex flex-col items-start rounded-[16px] border-2 p-3 text-left shadow-[0_2px_8px_rgba(0,0,0,0.05)] transition-all ${
    interactive ? 'hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(0,0,0,0.1)]' : ''
  } ${bg} ${border}`;
}

function MetricTileContent({ emoji, value, label }: { emoji: string; value: ReactNode; label: string }) {
  return (
    <>
      <span className="text-2xl leading-none" aria-hidden>
        {emoji}
      </span>
      <span className="mt-1.5 text-[28px] font-black leading-none text-[#1E1E1E]">{value}</span>
      <span className="mt-1 text-[10.5px] font-bold leading-tight text-[#5B6475]">{label}</span>
    </>
  );
}

// Linha operacional do paciente (não é card): Avatar | Nome | Data | Horário |
// campo(s) específico(s) da coluna | ação(ões) — tudo na mesma linha
// horizontal, como pedido para a central operacional de acompanhamento.
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
      className="w-full rounded-[7px] border-2 border-[#1557FF] bg-white px-2 py-1 text-[9.5px] font-bold text-[#1557FF] hover:bg-[#EEF4FF]"
    >
      Ver Jornada
    </button>
  );

  return (
    <div className="flex items-center gap-2 overflow-hidden rounded-[8px] border border-[#E5EAF2] bg-white px-2.5 py-1.5 hover:bg-[#F8FAFC]">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0F1D38] text-[9px] font-bold text-white"
        title={item.paciente_nome}
        aria-hidden="true"
      >
        {avatarInitials(item.paciente_nome)}
      </div>
      <span
        className="min-w-[80px] flex-[1.3] truncate text-[11px] font-bold text-[#071B3A]"
        title={item.paciente_nome}
      >
        {item.paciente_nome}
      </span>
      <span className="w-[66px] shrink-0 text-[10px] text-[#5B6475]">{fmtDate(item.criado_em)}</span>
      <span className="w-[38px] shrink-0 text-[10px] text-[#5B6475]">{fmtTime(item.criado_em)}</span>

      {column === 'approved' && (
        <>
          <span className="min-w-[60px] flex-1 truncate text-[10.5px] text-[#5B6475]" title={item.condicao}>
            {item.condicao || '—'}
          </span>
          <div className="w-[84px] shrink-0">{verJornadaBtn}</div>
        </>
      )}

      {column === 'rejected' && (
        <>
          <span className="min-w-[60px] flex-1 truncate text-[10.5px] text-[#5B6475]" title={rejectionMotivo(item)}>
            {rejectionMotivo(item)}
          </span>
          <span className="w-[78px] shrink-0 truncate text-[10.5px] text-[#5B6475]" title={rejectionEtapa(item)}>
            {rejectionEtapa(item)}
          </span>
          <div className="flex w-[84px] shrink-0 flex-col gap-1">
            {verJornadaBtn}
            <button
              type="button"
              disabled
              title="Ação ainda não definida — depende de decisão de regra de negócio"
              className="w-full cursor-not-allowed rounded-[7px] border border-[#E5EAF2] bg-[#F8FAFC] px-2 py-1 text-[9.5px] font-bold text-[#9AA5B4]"
            >
              Reiniciar
            </button>
          </div>
        </>
      )}

      {column === 'pending' && (() => {
        const note = firstPendingAdminNote(item);
        const resolving = note ? resolvingNoteId === note.id : false;
        return (
          <>
            <span className="min-w-[60px] flex-1 truncate text-[10.5px] text-[#5B6475]" title={note?.texto || '—'}>
              {note?.texto || '—'}
            </span>
            <div className="w-[84px] shrink-0">
              <button
                type="button"
                disabled={!note || resolving}
                onClick={() => note && onResolveNote(item.id, note.id)}
                className="w-full rounded-[7px] border-2 border-[#B45309] bg-white px-2 py-1 text-[9.5px] font-bold text-[#B45309] hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resolving ? 'Resolvendo...' : 'Resolver'}
              </button>
            </div>
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
  const [supportPatients, setSupportPatients] = useState<SupportQueueItem[]>([]);
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingNoteId, setResolvingNoteId] = useState<string | null>(null);

  async function refreshAtendimentos() {
    try {
      const list = await fetchAdminAtendimentos();
      setAtendimentos(list.atendimentos || []);
    } catch {
      /* mantém a lista anterior — próximo ciclo tenta de novo */
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

  async function fetchSupportQueue() {
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/support-queue`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok) return;
      const rows = Array.isArray(json) ? json : json.atendimentos || json.data || [];
      setSupportPatients(
        rows.map((item: any) => ({
          id: item.id,
          paciente_nome: item.paciente_nome,
          paciente_telefone: item.paciente_telefone,
          criado_em: item.criado_em,
          status: item.status,
          support_sub_status: item?.dados_clinicos?.support_sub_status,
        })),
      );
    } catch {
      setSupportPatients([]);
    }
  }

  useEffect(() => {
    requireSession()
      .then((user) => {
        setUserName(user.name);
        setUserRole(user.role);
        return Promise.all([fetchAdminDashboard(), fetchAdminAtendimentos(), fetchSupportQueue()]);
      })
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
  // status muda, sem precisar recarregar a página.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshAtendimentos();
        void fetchSupportQueue();
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const grouped = useMemo(() => {
    return bodyColumns.reduce<Record<BodyColumnKey, AdminAtendimento[]>>(
      (acc, column) => {
        acc[column.key] = atendimentos.filter(column.match);
        return acc;
      },
      { approved: [], rejected: [], pending: [] },
    );
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
    <main className="fila-page-dense relative flex min-h-0 w-full max-w-[1366px] flex-1 flex-col overflow-hidden bg-[#F6F9FD] text-[#071B3A]">
      {/* 1. Cabeçalho — MedicalPanelHeader reaproveitado, apenas título e botão adaptados */}
      <MedicalPanelHeader
        operational
        title="Painel Administrativo"
        titleAlign="left"
        recordButtonLabel="Relação de Pacientes"
        recordButtonIcon={<UsersIcon className="h-4 w-4" aria-hidden="true" />}
        onOpenMedicalRecord={() => router.push('/admin/pacientes')}
        onLogout={handleLogout}
      />

      <div className="panel-page-body">
        {error && (
          <div className="shrink-0 rounded-[14px] border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {data && (
          <>
            {/* 2. Cards Quantitativos — mesmos 6 cards/indicadores já existentes, com destaque */}
            <section className="shrink-0">
              <p className="mb-1.5 text-[10.5px] font-black uppercase tracking-[0.08em] text-[#5B6475]">
                Situação atual — {data.total} atendimento{data.total !== 1 ? 's' : ''} no sistema
                {userName ? ` · ${userName} · ${userRole.toUpperCase()}` : ''}
              </p>
              <div className="grid grid-cols-6 gap-2.5">
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

            {/* 3. Faixa de Suporte Administrativo — prioridade visual máxima, MedicalSupportBand em "lg" */}
            <MedicalSupportBand patients={supportPatients} onQueueRefresh={fetchSupportQueue} size="lg" />

            {/* 4. Indicadores de Tempo Médio — mesmo componente dos Cards Quantitativos,
                 cor neutra, sem lógica/endpoint novo (área reservada) */}
            <section className="shrink-0">
              <p className="mb-1.5 text-[10.5px] font-black uppercase tracking-[0.08em] text-[#5B6475]">
                Indicadores de tempo médio · área reservada
              </p>
              <div className="grid grid-cols-7 gap-2.5">
                {TIME_PLACEHOLDERS.map((label) => (
                  <div key={label} className={metricTileClass('bg-slate-50', 'border-slate-200', false)}>
                    <MetricTileContent emoji="⏱️" value="—" label={label} />
                  </div>
                ))}
              </div>
            </section>

            {/* 5. Corpo Principal — mesmo padrão visual de coluna do Painel Médico (fila),
                 com compactação extra (admin-corpo-dense) para caber a hierarquia toda em uma tela */}
            <div className="admin-corpo-dense grid min-h-0 flex-1 grid-cols-3 items-stretch gap-2">
              {bodyColumns.map((column) => {
                const Icon = column.icon;
                const items = grouped[column.key];
                return (
                  <section
                    key={column.key}
                    className={`dp-fila-column fila-column-scroll h-full min-h-0 min-w-0 ${column.topBorderClass}`}
                  >
                    <div
                      className={`dp-fila-column__head flex shrink-0 items-center justify-between border-b border-[#E4ECF7] px-3 ${column.headBgClass}`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`dp-col-heading-icon flex shrink-0 items-center justify-center rounded-full ${column.iconClass}`}
                        >
                          <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
                        </span>
                        <h2 className="dp-col-heading truncate">{column.title}</h2>
                      </div>
                      <span className={`dp-col-count ${column.countBadgeClass}`}>{items.length}</span>
                    </div>

                    <div className="dp-fila-column__scroll space-y-1.5">
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
                        <p className="dp-text-subtle rounded-[14px] border border-dashed border-[#E4ECF7] p-5 text-center text-[12px] font-semibold">
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

      {/* 6. Rodapé — mesmo rodapé institucional do Painel Médico */}
      <footer className="panel-footer">
        <span>
          Doctor Prescreve — Plataforma de Prescrição Médica | CNPJ: 50.871.173/0001-53 | © 2025 Todos os
          direitos reservados.
        </span>
      </footer>
    </main>
  );
}
