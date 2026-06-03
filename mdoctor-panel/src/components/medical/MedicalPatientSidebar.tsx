'use client';

import { StatusPill } from '@/components/ui/DesignSystem';
import type { WorkflowAtendimento } from '@/hooks/useMedicalWorkflow';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || 'P') + (parts[1]?.[0] || '');
}

function statusLabel(status?: string) {
  const s = String(status || '').toLowerCase();
  const map: Record<string, string> = {
    waiting: 'Aguardando',
    em_atendimento: 'Em atendimento',
    approved: 'Aprovado',
    receita_em_edicao: 'Prescrição em andamento',
    receita_emitida: 'Receita emitida',
    memed_processing: 'Receita emitida',
    ready: 'Pronta para envio',
    delivered: 'Finalizado',
    rejected: 'Reprovado',
  };
  return map[s] || status || '—';
}

type MedicalPatientSidebarProps = {
  atendimento: WorkflowAtendimento | null;
  stepHint?: string;
};

export function MedicalPatientSidebar({ atendimento, stepHint }: MedicalPatientSidebarProps) {
  const clinical = atendimento?.dados_clinicos || {};
  const receipt = clinical.memed_receita;

  return (
    <div className="space-y-3">
      <div className="rounded-[12px] border border-[#E5EAF2] bg-white p-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-panel-sm font-bold">Paciente</h2>
          <StatusPill tone={atendimento ? 'success' : 'secondary'}>
            {atendimento ? statusLabel(atendimento.status) : '—'}
          </StatusPill>
        </div>

        {atendimento ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EEF4FF] text-sm font-bold text-[#1557FF]">
                {initials(atendimento.paciente_nome)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-panel-sm font-bold">{atendimento.paciente_nome}</p>
                <p className="text-panel-xs text-[#5B6475]">#{atendimento.id.slice(0, 8).toUpperCase()}</p>
              </div>
            </div>

            <dl className="space-y-2 text-panel-xs">
              <div>
                <dt className="font-semibold text-[#5B6475]">Condição</dt>
                <dd className="mt-0.5 font-medium">{atendimento.condicao || String(clinical.doenca_cronica || '—')}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#5B6475]">Medicação em uso</dt>
                <dd className="mt-0.5 font-medium">{String(clinical.medicacao_em_uso || '—')}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[#5B6475]">WhatsApp</dt>
                <dd className="mt-0.5 font-medium">{atendimento.paciente_telefone || '—'}</dd>
              </div>
              {receipt?.receitaId ? (
                <div>
                  <dt className="font-semibold text-[#5B6475]">Receita digital</dt>
                  <dd className="mt-0.5 font-mono text-[11px]">{receipt.receitaId}</dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <p className="text-panel-xs text-[#5B6475]">Carregando contexto do atendimento…</p>
        )}
      </div>

      {stepHint ? (
        <div className="rounded-[12px] border border-[#D6E4FF] bg-[#F0F5FF] px-3 py-2.5 text-panel-xs leading-relaxed text-[#1E3A6E]">
          {stepHint}
        </div>
      ) : null}

      <div className="rounded-[12px] border border-[#E5EAF2] bg-white p-3 text-panel-xs text-[#5B6475]">
        <p className="font-bold text-[#080D33]">Histórico resumido</p>
        <p className="mt-2 leading-relaxed">
          {String(clinical.queixa_principal || clinical.historico_clinico || 'Sem histórico adicional registrado.')}
        </p>
      </div>
    </div>
  );
}
