'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LayoutDashboard } from 'lucide-react';
import { logout, requireSession } from '@/services/auth.service';
import {
  fetchAdminAtendimentos,
  medicoResponsavel,
  type AdminAtendimento,
} from '@/services/admin.service';
import { Card, EmptyState, StatusPill, TextInput } from '@/components/ui/DesignSystem';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';

function fmt(v?: string) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(v));
}

function statusLabel(s: string) {
  const v = (s || '').toLowerCase();
  if (['waiting', 'queue', 'fila', 'triaged'].includes(v)) return 'Aguardando';
  if (v === 'awaiting_prescription_upload') return 'Aguardando receita';
  if (['em_atendimento', 'under_review', 'approved'].includes(v)) return 'Em atendimento';
  if (['receita_emitida', 'memed_processing', 'awaiting_validation', 'receita_em_edicao'].includes(v)) return 'Receita emitida';
  if (['ready', 'validated', 'aprovado'].includes(v)) return 'Receita pronta';
  if (['delivered', 'finished'].includes(v)) return 'Entregue';
  if (['rejected', 'recusado', 'cancelado'].includes(v)) return 'Recusado';
  return s;
}

function statusTone(s: string): 'primary' | 'success' | 'danger' | 'gold' | 'secondary' {
  const v = (s || '').toLowerCase();
  if (['waiting', 'queue', 'fila', 'triaged', 'awaiting_prescription_upload'].includes(v)) return 'primary';
  if (['em_atendimento', 'under_review', 'approved', 'receita_emitida', 'memed_processing', 'receita_em_edicao'].includes(v)) return 'gold';
  if (['ready', 'validated', 'aprovado', 'delivered', 'finished'].includes(v)) return 'success';
  if (['rejected', 'recusado', 'cancelado'].includes(v)) return 'danger';
  return 'secondary';
}

function isPaid(a: AdminAtendimento) {
  return String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
}

function isWaiting(a: AdminAtendimento) {
  const v = (a.status || '').toLowerCase();
  return ['waiting', 'queue', 'fila', 'triaged'].includes(v);
}

function isInFlow(a: AdminAtendimento) {
  const v = (a.status || '').toLowerCase();
  return ['em_atendimento', 'under_review', 'approved', 'receita_em_edicao', 'receita_emitida', 'memed_processing', 'awaiting_validation'].includes(v);
}

function isReady(a: AdminAtendimento) {
  const v = (a.status || '').toLowerCase();
  return ['ready', 'validated', 'aprovado'].includes(v);
}

function applyFilter(items: AdminAtendimento[], filter: string): AdminAtendimento[] {
  if (!filter || filter === 'all') return items;
  if (filter === 'aguardando_pagamento') return items.filter((a) => isWaiting(a) && !isPaid(a));
  if (filter === 'aguardando_receita') return items.filter((a) => a.status === 'awaiting_prescription_upload');
  if (filter === 'pronto_avaliacao') return items.filter((a) => isWaiting(a) && isPaid(a));
  if (filter === 'em_atendimento') return items.filter(isInFlow);
  if (filter === 'receitas_prontas') return items.filter(isReady);
  if (filter === 'pendencias_admin') {
    return items.filter((a) => {
      const notes = a.dados_clinicos?.observacoes_admin || [];
      return notes.some((n) => !n.resolvido);
    });
  }
  return items;
}

const FILTER_LABELS: Record<string, string> = {
  all: 'Todos',
  aguardando_pagamento: 'Aguardando pagamento',
  aguardando_receita: 'Aguardando receita anterior',
  pronto_avaliacao: 'Pronto para avaliação',
  em_atendimento: 'Em atendimento',
  receitas_prontas: 'Receitas prontas',
  pendencias_admin: 'Pendências administrativas',
};

function maskPhone(p?: string) {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  const n = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return p;
}

function PacientesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get('filter') || 'all';

  const [atendimentos, setAtendimentos] = useState<AdminAtendimento[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    requireSession()
      .then(() => fetchAdminAtendimentos())
      .then((r) => setAtendimentos(r.atendimentos || []))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Erro ao carregar pacientes';
        setError(msg);
        if (msg.toLowerCase().includes('sess')) router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  const filtered = useMemo(() => {
    let list = applyFilter(atendimentos, filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) =>
        [a.paciente_nome, a.paciente_telefone, a.paciente_cpf, a.condicao, a.status]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    return list;
  }, [atendimentos, filter, search]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-[#5B6475]">
        Carregando pacientes...
      </main>
    );
  }

  const subtitle =
    filter !== 'all' && FILTER_LABELS[filter]
      ? `Filtro: ${FILTER_LABELS[filter]}`
      : `${filtered.length} atendimento${filtered.length !== 1 ? 's' : ''}`;

  return (
    <main className="flex min-h-screen w-full flex-col bg-[#F6F9FD] text-[#071B3A]">
      <MedicalPanelHeader
        operational
        title="Relação de Pacientes"
        subtitle={subtitle}
        titleAlign="left"
        recordButtonLabel="Dashboard"
        recordButtonIcon={<LayoutDashboard className="h-4 w-4" aria-hidden="true" />}
        onOpenMedicalRecord={() => router.push('/admin/dashboard')}
        onLogout={handleLogout}
      />
      <div className="space-y-4 p-4 sm:p-6">
        {error && (
          <div className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <TextInput
            placeholder="Buscar por nome, telefone, doença..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-11 rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-sm text-[#1E1E1E] outline-none focus:border-[#1557FF] focus:ring-4 focus:ring-[#EEF4FF]"
          >
            {Object.entries(FILTER_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {(search || filter !== 'all') && (
            <button
              type="button"
              onClick={() => { setSearch(''); setFilter('all'); }}
              className="h-11 rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-sm font-bold text-[#5B6475] hover:bg-[#F8FAFC]"
            >
              Limpar
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="Nenhum paciente encontrado"
            description="Ajuste o filtro ou a busca para encontrar atendimentos."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-[#E5EAF2] bg-[#F8FAFC] text-xs font-black text-[#5B6475]">
                    <th className="px-4 py-3 text-left">Nome</th>
                    <th className="px-4 py-3 text-left">Telefone</th>
                    <th className="px-4 py-3 text-left">Doença</th>
                    <th className="px-4 py-3 text-left">Entrada</th>
                    <th className="px-4 py-3 text-left">Última atualiz.</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Pagamento</th>
                    <th className="px-4 py-3 text-left">Responsável</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const hasPendingNote = (a.dados_clinicos?.observacoes_admin || []).some(
                      (n) => !n.resolvido,
                    );
                    return (
                      <tr
                        key={a.id}
                        className="border-b border-[#E5EAF2] last:border-0 hover:bg-[#F8FAFC]"
                      >
                        <td className="px-4 py-3 font-bold text-[#1E1E1E]">
                          {a.paciente_nome}
                          {hasPendingNote && (
                            <span className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white">
                              !
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[#5B6475]">{maskPhone(a.paciente_telefone)}</td>
                        <td className="px-4 py-3 text-[#5B6475]">{a.condicao || '—'}</td>
                        <td className="px-4 py-3 text-[#5B6475]">{fmt(a.criado_em)}</td>
                        <td className="px-4 py-3 text-[#5B6475]">{fmt(a.atualizado_em)}</td>
                        <td className="px-4 py-3">
                          <StatusPill tone={statusTone(a.status)}>
                            {statusLabel(a.status)}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill tone={isPaid(a) ? 'success' : 'gold'}>
                            {isPaid(a) ? 'Pago' : 'Pendente'}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3 text-[#5B6475]">
                          {medicoResponsavel(a) || '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => router.push(`/admin/paciente/${a.id}`)}
                            className="rounded-[12px] border border-[#E5EAF2] bg-white px-3 py-1.5 text-xs font-bold text-[#1557FF] hover:bg-[#EEF4FF]"
                          >
                            Ver jornada
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}

const loadingFallback = (
  <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-[#5B6475]">
    Carregando pacientes...
  </main>
);

export default function AdminPacientesPage() {
  return (
    <Suspense fallback={loadingFallback}>
      <PacientesContent />
    </Suspense>
  );
}
