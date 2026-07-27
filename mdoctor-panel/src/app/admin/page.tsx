'use client';

import { useEffect, useMemo, useState } from 'react';
import { getApiBase } from '@/services/api';
import { authHeaders, logout, requireSession } from '@/services/auth.service';
import { Button, Card, MetricCard, StatusPill } from '@/components/ui/DesignSystem';

type Check = {
  name: string;
  ok: boolean;
  message: string;
  severity: 'fail' | 'warning';
};

type AdminStatus = {
  user: { id: string; name: string; role: string };
  readiness: {
    status: 'ok' | 'warning' | 'fail';
    production: boolean;
    checkedAt: string;
    checks: Check[];
    failures: Check[];
    warnings: Check[];
  };
  metrics: {
    total: number;
    queue: number;
    inMedicalFlow: number;
    readyToDeliver: number;
    delivered: number;
    rejected: number;
    byStatus: Record<string, number>;
  };
  audit: Array<{
    id: string;
    atendimento_id?: string;
    status_anterior?: string | null;
    status_novo: string;
    motivo?: string | null;
    medico_id?: string | null;
    criado_em?: string;
  }>;
  integrations: {
    memed: { configured: boolean; environment: string };
    supabase: { configured: boolean };
    delivery: { twilioWhatsapp: boolean; twilioSms: boolean; resendEmail: boolean };
  };
};

function badgeClass(ok: boolean) {
  return ok ? 'bg-emerald-50 text-[#0BA84F]' : 'bg-[#FADADA] text-[#1E1E1E]';
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

export default function AdminPage() {
  const [data, setData] = useState<AdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const deliveryReady = useMemo(() => {
    if (!data) return false;
    return data.integrations.delivery.twilioWhatsapp || data.integrations.delivery.twilioSms || data.integrations.delivery.resendEmail;
  }, [data]);

  async function fetchStatus() {
    setError(null);
    try {
      await requireSession();
      const response = await fetch(`${getApiBase()}/api/admin/status`, {
        headers: authHeaders()
      });
      const payload = await response.json();
      if (response.status === 403) throw new Error('Seu perfil não tem acesso ao Painel de Monitoramento.');
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Falha ao carregar painel de monitoramento');
      setData(payload);
    } catch (e: any) {
      setError(e.message || 'Falha ao carregar painel de monitoramento');
      if (String(e.message || '').includes('Sessão')) window.location.href = '/login';
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await logout();
    window.location.href = '/login';
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  if (loading) return <main className="min-h-screen bg-[#F8FAFC] p-6 text-sm text-[#5B6475]">Carregando painel de monitoramento...</main>;

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-[#1E1E1E]">
      <header className="flex h-20 items-center justify-between bg-white px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#1557FF] text-sm font-black text-white">
            DP
          </div>
          <div>
            <h1 className="text-lg font-black">Painel de Monitoramento</h1>
            <p className="text-sm text-[#5B6475]">Monitoramento da infraestrutura, integrações e operação do sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.user && (
            <span className="hidden rounded-[14px] bg-[#EEF4FF] px-4 py-3 text-xs font-black text-[#1557FF] md:inline-flex">
              {data.user.name} · {data.user.role.toUpperCase()}
            </span>
          )}
          <a href="/fila" className="inline-flex h-10 items-center rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
            Fila
          </a>
          <Button onClick={fetchStatus} className="h-10 text-xs">Atualizar</Button>
          <Button onClick={handleLogout} tone="soft" className="h-10 text-xs">Sair</Button>
        </div>
      </header>
      <div className="h-1 bg-[#F4B000]" />

      <section className="px-8 py-6">
        {error && <div className="mb-4 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

        {data && (
          <>
            <Card className="mb-5 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-black text-[#5B6475]">STATUS DO AMBIENTE</p>
                  <h2 className="mt-1 text-2xl font-black">
                    {data.readiness.status === 'ok' ? 'Produção liberada' : 'Pendências antes da produção'}
                  </h2>
                  <p className="mt-1 text-sm text-[#5B6475]">
                    {data.readiness.failures.length
                      ? `${data.readiness.failures.length} bloqueio(s) impedem o deploy final.`
                      : 'Readiness sem bloqueios críticos.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={`${getApiBase()}/readyz`} target="_blank" className="inline-flex h-10 items-center rounded-[14px] border border-[#1E1E1E] bg-white px-4 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                    Abrir readiness
                  </a>
                  <a href="/receita" className="inline-flex h-10 items-center rounded-[14px] border border-[#E5EAF2] bg-white px-4 text-xs font-bold shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
                    Testar Memed
                  </a>
                </div>
              </div>
            </Card>

            <div className="mb-5 grid gap-4 lg:grid-cols-5">
              {[
                ['Fila', data.metrics.queue],
                ['Em atendimento', data.metrics.inMedicalFlow],
                ['Receitas prontas', data.metrics.readyToDeliver],
                ['Entregues', data.metrics.delivered],
                ['Recusados', data.metrics.rejected]
              ].map(([label, value]) => (
                <MetricCard key={label} label={String(label)} value={value} />
              ))}
            </div>

            <div className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
              <section className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-black">READINESS DE PRODUÇÃO</h2>
                  <span className={`rounded-[12px] px-3 py-1 text-xs font-black ${badgeClass(data.readiness.status === 'ok')}`}>
                    {data.readiness.status.toUpperCase()}
                  </span>
                </div>
                <div className="space-y-3">
                  {data.readiness.checks.map((item) => (
                    <div key={item.name} className="flex items-start justify-between gap-4 rounded-[14px] border border-[#E5EAF2] p-3 text-sm">
                      <div>
                        <p className="font-bold">{item.name}</p>
                        <p className="mt-1 text-[#5B6475]">{item.message}</p>
                      </div>
                      <StatusPill tone={item.ok ? 'success' : item.severity === 'fail' ? 'danger' : 'gold'} className="shrink-0">
                        {item.ok ? 'OK' : item.severity.toUpperCase()}
                      </StatusPill>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-5">
                <article className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                  <h2 className="text-sm font-black">INTEGRAÇÕES</h2>
                  <div className="mt-4 grid gap-3 text-sm">
                    <p className="flex justify-between"><span>Memed</span><strong>{data.integrations.memed.configured ? data.integrations.memed.environment : 'pendente'}</strong></p>
                    <p className="flex justify-between"><span>Supabase</span><strong>{data.integrations.supabase.configured ? 'configurado' : 'pendente'}</strong></p>
                    <p className="flex justify-between"><span>Entrega real</span><strong>{deliveryReady ? 'configurada' : 'pendente'}</strong></p>
                    <p className="flex justify-between"><span>WhatsApp</span><strong>{data.integrations.delivery.twilioWhatsapp ? 'Twilio' : 'pendente'}</strong></p>
                    <p className="flex justify-between"><span>E-mail</span><strong>{data.integrations.delivery.resendEmail ? 'Resend' : 'pendente'}</strong></p>
                  </div>
                </article>

                <article className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                  <h2 className="text-sm font-black">STATUS OPERACIONAL</h2>
                  <div className="mt-4 max-h-72 space-y-2 overflow-y-auto text-sm">
                    {Object.entries(data.metrics.byStatus).map(([status, count]) => (
                      <p key={status} className="flex justify-between rounded-[14px] bg-[#F8FAFC] px-3 py-2">
                        <span>{status}</span>
                        <strong>{count}</strong>
                      </p>
                    ))}
                  </div>
                </article>

                <article className="rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
                  <h2 className="text-sm font-black">ALERTAS PRIORITÁRIOS</h2>
                  <div className="mt-4 space-y-2 text-sm">
                    {data.readiness.failures.length ? (
                      data.readiness.failures.map((item) => (
                        <p key={item.name} className="rounded-[14px] bg-[#FADADA] px-3 py-2 font-semibold text-[#1E1E1E]">
                          {item.message}
                        </p>
                      ))
                    ) : (
                      <p className="rounded-[14px] bg-emerald-50 px-3 py-2 font-semibold text-[#0BA84F]">Sem bloqueios críticos</p>
                    )}
                  </div>
                </article>
              </section>
            </div>

            <section className="mt-5 rounded-[20px] border border-[#E5EAF2] bg-white p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-black">AUDITORIA RECENTE</h2>
                <span className="rounded-[12px] bg-[#EEF4FF] px-3 py-1 text-xs font-black text-[#1557FF]">
                  {data.audit.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs font-black text-[#5B6475]">
                    <tr>
                      <th className="border-b border-[#E5EAF2] py-3">Data</th>
                      <th className="border-b border-[#E5EAF2] py-3">Atendimento</th>
                      <th className="border-b border-[#E5EAF2] py-3">Transição</th>
                      <th className="border-b border-[#E5EAF2] py-3">Médico</th>
                      <th className="border-b border-[#E5EAF2] py-3">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.audit.map((item) => (
                      <tr key={item.id}>
                        <td className="border-b border-[#E5EAF2] py-3 text-[#5B6475]">{formatDate(item.criado_em)}</td>
                        <td className="border-b border-[#E5EAF2] py-3 font-bold">{item.atendimento_id?.slice(0, 8).toUpperCase()}</td>
                        <td className="border-b border-[#E5EAF2] py-3">
                          {item.status_anterior || 'Inicial'} {'->'} {item.status_novo}
                        </td>
                        <td className="border-b border-[#E5EAF2] py-3 text-[#5B6475]">{item.medico_id || 'Sistema'}</td>
                        <td className="border-b border-[#E5EAF2] py-3 text-[#5B6475]">{item.motivo || 'Sem motivo'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
