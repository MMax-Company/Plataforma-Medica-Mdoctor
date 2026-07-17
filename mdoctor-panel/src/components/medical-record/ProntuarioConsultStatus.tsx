'use client';

import { toPanelAtendimentoStatus } from '@/lib/atendimento-status';
import type { ProntuarioAtendimento } from '@/hooks/useProntuarioAtendimento';

const STATUS_LABELS: Record<string, string> = {
  QUEUE: 'Na fila',
  EM_ATENDIMENTO: 'Em atendimento',
  MEMED_PROCESSING: 'Processando receita',
  RECEITA_EMITIDA: 'Receita emitida',
  VALIDATED: 'Receita pronta',
  DELIVERED: 'Entregue',
  FINISHED: 'Finalizado',
  REJECTED: 'Recusado',
  RECUSADO: 'Recusado',
};

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

interface ProntuarioConsultStatusProps {
  atendimento: ProntuarioAtendimento;
}

export function ProntuarioConsultStatus({ atendimento }: ProntuarioConsultStatusProps) {
  const clinical = atendimento.dados_clinicos || {};
  const historico = asRecord(clinical.historico_receita);
  const memed = asRecord(clinical.memed_receita);
  const entrega = asRecord(clinical.entrega_receita);
  const panelStatus = toPanelAtendimentoStatus(atendimento.status);
  const statusKey = panelStatus || String(atendimento.status || '').toUpperCase();
  const statusLabel = STATUS_LABELS[statusKey] || atendimento.status || '—';

  const historyRows = [
    { label: 'Abertura do atendimento', value: formatDateTime(atendimento.criado_em) },
    { label: 'Última atualização', value: formatDateTime(atendimento.atualizado_em) },
    {
      label: 'Receita emitida',
      value: formatDateTime(
        String(historico.emitida_em || memed.gerada_em || historico.validada_em || ''),
      ),
    },
    {
      label: 'Receita validada',
      value: formatDateTime(String(historico.validada_em || memed.validated_at || '')),
    },
    {
      label: 'Último envio',
      value: formatDateTime(String(historico.ultimo_envio_em || entrega.sent_at || entrega.attempted_at || '')),
    },
    {
      label: 'Canal de entrega',
      value: String(historico.ultimo_canal || entrega.channel || '—'),
    },
    {
      label: 'ID receita Memed',
      value: String(historico.receita_id || memed.receitaId || '—'),
    },
  ].filter((row) => row.value !== '—' || row.label.startsWith('Abertura') || row.label.startsWith('Última'));

  return (
    <section className="mb-2 shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Status e histórico</h3>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-bold uppercase text-slate-700">
          {statusLabel}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {historyRows.map((row) => (
          <div key={row.label} className="flex min-w-0 items-start justify-between gap-2 text-[10px]">
            <span className="shrink-0 text-slate-400">{row.label}</span>
            <span className="truncate text-right font-semibold text-slate-800">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
