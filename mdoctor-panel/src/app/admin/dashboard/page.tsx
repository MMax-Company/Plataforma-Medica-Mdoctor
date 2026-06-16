'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout, requireSession } from '@/services/auth.service';
import {
  fetchAdminDashboard,
  type AdminAtendimento,
  type AdminDashboard,
} from '@/services/admin.service';
import { AppShell, Card, EmptyState, StatusPill } from '@/components/ui/DesignSystem';

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

export default function AdminDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [userName, setUserName] = useState('');
  const [userRole, setUserRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    requireSession()
      .then((user) => {
        setUserName(user.name);
        setUserRole(user.role);
        return fetchAdminDashboard();
      })
      .then(setData)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Erro ao carregar dashboard';
        setError(msg);
        if (msg.toLowerCase().includes('sess')) router.replace('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

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

  const navLinks = (
    <>
      <a
        href="/admin/pacientes"
        className="inline-flex h-10 items-center rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      >
        Todos os Pacientes
      </a>
      {userRole === 'admin' && (
        <a
          href="/fila"
          className="inline-flex h-10 items-center rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
        >
          Painel Médico
        </a>
      )}
    </>
  );

  return (
    <AppShell
      title="Painel Administrativo"
      subtitle="Central operacional — Doctor Prescreve"
      userLabel={userName ? `${userName} · ${userRole.toUpperCase()}` : undefined}
      actions={navLinks}
      onLogout={handleLogout}
    >
      <div className="space-y-6 p-4 sm:p-6">
        {error && (
          <div className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {data && (
          <>
            <section>
              <p className="mb-3 text-xs font-black uppercase tracking-[0.08em] text-[#5B6475]">
                Situação atual — {data.total} atendimento{data.total !== 1 ? 's' : ''} no sistema
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {CARDS.map((card) => {
                  const count = data.cards[card.key] ?? 0;
                  return (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => router.push(`/admin/pacientes?filter=${card.filter}`)}
                      className={`flex flex-col items-start rounded-[20px] border p-4 text-left shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] ${card.bg} ${card.border}`}
                    >
                      <span className="text-2xl" aria-hidden>
                        {card.emoji}
                      </span>
                      <span className="mt-3 text-3xl font-black text-[#1E1E1E]">{count}</span>
                      <span className="mt-1 text-[11px] font-semibold leading-tight text-[#5B6475]">
                        {card.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-[0.08em] text-[#5B6475]">
                  Pacientes recentes
                </p>
                <a
                  href="/admin/pacientes"
                  className="text-xs font-bold text-[#1557FF] hover:underline"
                >
                  Ver todos →
                </a>
              </div>

              {data.recentes.length === 0 ? (
                <EmptyState
                  title="Nenhum atendimento registrado"
                  description="Os pacientes aparecem aqui assim que chegam pelo Typebot."
                />
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] text-sm">
                      <thead>
                        <tr className="border-b border-[#E5EAF2] bg-[#F8FAFC] text-xs font-black text-[#5B6475]">
                          <th className="px-4 py-3 text-left">Paciente</th>
                          <th className="px-4 py-3 text-left">Doença</th>
                          <th className="px-4 py-3 text-left">Entrada</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-left">Pagamento</th>
                          <th className="px-4 py-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentes.map((p: AdminAtendimento) => (
                          <tr
                            key={p.id}
                            className="border-b border-[#E5EAF2] last:border-0 hover:bg-[#F8FAFC]"
                          >
                            <td className="px-4 py-3 font-bold text-[#1E1E1E]">
                              {p.paciente_nome}
                            </td>
                            <td className="px-4 py-3 text-[#5B6475]">{p.condicao || '—'}</td>
                            <td className="px-4 py-3 text-[#5B6475]">{fmt(p.criado_em)}</td>
                            <td className="px-4 py-3">
                              <StatusPill tone={statusTone(p.status)}>
                                {statusLabel(p.status)}
                              </StatusPill>
                            </td>
                            <td className="px-4 py-3">
                              <StatusPill
                                tone={
                                  p.pagamento_status === 'CONFIRMADO' ? 'success' : 'gold'
                                }
                              >
                                {p.pagamento_status === 'CONFIRMADO' ? 'Pago' : 'Pendente'}
                              </StatusPill>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => router.push(`/admin/paciente/${p.id}`)}
                                className="rounded-[12px] border border-[#E5EAF2] bg-white px-3 py-1.5 text-xs font-bold text-[#1557FF] hover:bg-[#EEF4FF]"
                              >
                                Ver jornada
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
