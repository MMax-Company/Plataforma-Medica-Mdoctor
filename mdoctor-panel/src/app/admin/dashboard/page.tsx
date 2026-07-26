'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users as UsersIcon, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { authHeaders, logout, requireSession } from '@/services/auth.service';
import { getApiBase } from '@/services/api';
import {
  fetchAdminDashboard,
  fetchAdminAtendimentos,
  type AdminAtendimento,
  type AdminDashboard,
} from '@/services/admin.service';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';
import { MedicalSupportBand, type SupportQueueItem } from '@/components/medical/MedicalSupportBand';
import { avatarInitials, patientInitials, formatQueuePatientId } from '@/lib/patient-display';

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

function hasPendingAdminNote(a: AdminAtendimento) {
  return (a.dados_clinicos?.observacoes_admin || []).some((n) => !n.resolvido);
}

function fmt(v?: string) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v));
}

type BodyColumnKey = 'approved' | 'rejected' | 'pending';

const bodyColumns: Array<{
  key: BodyColumnKey;
  title: string;
  icon: typeof CheckCircle2;
  iconClass: string;
  match: (a: AdminAtendimento) => boolean;
}> = [
  {
    key: 'approved',
    title: 'PACIENTES APROVADOS',
    icon: CheckCircle2,
    iconClass: 'bg-[#E8F8EE] text-[#0B7F3C]',
    match: isApproved,
  },
  {
    key: 'rejected',
    title: 'PACIENTES REJEITADOS',
    icon: XCircle,
    iconClass: 'bg-slate-100 text-[#5B6475]',
    match: isRejected,
  },
  {
    key: 'pending',
    title: 'PENDÊNCIAS ADMINISTRATIVAS',
    icon: AlertTriangle,
    iconClass: 'bg-amber-50 text-amber-700',
    match: hasPendingAdminNote,
  },
];

// Seção 4 — Indicadores de Tempo Médio: apenas placeholders visuais, sem
// nenhuma lógica/endpoint novo (implementação prevista para fase futura).
const TIME_PLACEHOLDERS = [
  'Tempo médio de triagem',
  'Tempo médio de espera médica',
  'Tempo médio de avaliação',
  'Tempo médio até emissão da receita',
  'Tempo médio da jornada completa',
  'Tempo médio de suporte administrativo',
  'Tempo médio de suporte médico',
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [atendimentos, setAtendimentos] = useState<AdminAtendimento[]>([]);
  const [supportPatients, setSupportPatients] = useState<SupportQueueItem[]>([]);
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
                {CARDS.map((card) => {
                  const count = data.cards[card.key] ?? 0;
                  return (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => router.push(`/admin/pacientes?filter=${card.filter}`)}
                      className={`flex flex-col items-start rounded-[16px] border-2 p-3 text-left shadow-[0_2px_8px_rgba(0,0,0,0.05)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(0,0,0,0.1)] ${card.bg} ${card.border}`}
                    >
                      <span className="text-2xl leading-none" aria-hidden>
                        {card.emoji}
                      </span>
                      <span className="mt-1.5 text-[28px] font-black leading-none text-[#1E1E1E]">{count}</span>
                      <span className="mt-1 text-[10.5px] font-bold leading-tight text-[#5B6475]">
                        {card.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* 3. Faixa de Suporte Administrativo — prioridade visual máxima, MedicalSupportBand em "lg" */}
            <MedicalSupportBand patients={supportPatients} onQueueRefresh={fetchSupportQueue} size="lg" />

            {/* 4. Indicadores de Tempo Médio — área reservada visível, porém a menos prioritária */}
            <section className="shrink-0 rounded-[12px] border border-dashed border-[#C9D4E6] bg-[#F8FAFC] px-3 py-2">
              <p className="mb-1 text-[9.5px] font-black uppercase tracking-[0.06em] text-[#5B6475]">
                Indicadores de tempo médio · área reservada
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {TIME_PLACEHOLDERS.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#E5EAF2] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#5B6475]"
                  >
                    {label}
                    <strong className="font-black text-[#1E1E1E]">—</strong>
                  </span>
                ))}
              </div>
            </section>

            {/* 5. Corpo Principal — mesmo padrão visual de coluna do Painel Médico (fila) */}
            <div className="grid min-h-0 flex-1 grid-cols-3 items-stretch gap-2">
              {bodyColumns.map((column) => {
                const Icon = column.icon;
                const items = grouped[column.key];
                return (
                  <section key={column.key} className="dp-fila-column fila-column-scroll h-full min-h-0 min-w-0">
                    <div className="dp-fila-column__head flex shrink-0 items-center justify-between border-b border-[#E4ECF7] px-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`dp-col-heading-icon flex shrink-0 items-center justify-center rounded-full ${column.iconClass}`}
                        >
                          <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
                        </span>
                        <h2 className="dp-col-heading truncate">{column.title}</h2>
                      </div>
                      <span className="dp-col-count dp-col-count-alert">{items.length}</span>
                    </div>

                    <div className="dp-fila-column__scroll space-y-2">
                      {items.length ? (
                        items.map((item) => {
                          const patientLabel = patientInitials(item.paciente_nome);
                          const patientAvatar = avatarInitials(item.paciente_nome);
                          return (
                            <article key={item.id} className="dp-patient-card">
                              <div className="dp-patient-card__inner">
                                <div
                                  className="dp-patient-avatar dp-patient-initials shrink-0"
                                  title={item.paciente_nome}
                                  aria-hidden="true"
                                >
                                  {patientAvatar}
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
                                      <p className="dp-patient-id">#{formatQueuePatientId(item.id)}</p>
                                    </div>
                                    <span className="dp-status-badge dp-status-badge-neutral whitespace-nowrap">
                                      {fmt(item.atualizado_em || item.criado_em)}
                                    </span>
                                  </div>

                                  <div className="dp-patient-card__actions">
                                    <button
                                      type="button"
                                      onClick={() => router.push(`/admin/paciente/${item.id}`)}
                                      className="rounded-[8px] border border-[#E5EAF2] bg-white px-2.5 py-1 text-[10px] font-bold text-[#1557FF] hover:bg-[#EEF4FF]"
                                    >
                                      Ver jornada
                                    </button>
                                  </div>
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
