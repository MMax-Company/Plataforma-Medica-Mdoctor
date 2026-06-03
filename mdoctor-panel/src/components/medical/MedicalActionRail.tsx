'use client';

import type { ClinicalRejectReasonCode } from '@/services/clinical-decision';

type MedicalActionRailProps = {
  motivo: string;
  onMotivoChange: (value: string) => void;
  rejectReasonCode: ClinicalRejectReasonCode;
  onRejectReasonChange: (code: ClinicalRejectReasonCode) => void;
  rejectReasons: Array<{ code: ClinicalRejectReasonCode; label: string }>;
  actionKey: string | null;
  flags: {
    canApprove: boolean;
    canEmit: boolean;
    canSend: boolean;
    canFinish: boolean;
    isDelivered: boolean;
  };
  hasReceipt: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSave: () => void;
  onEmit: () => void;
  onSend: () => void;
  onFinish: () => void;
  compact?: boolean;
};

export function MedicalActionRail({
  motivo,
  onMotivoChange,
  rejectReasonCode,
  onRejectReasonChange,
  rejectReasons,
  actionKey,
  flags,
  hasReceipt,
  onApprove,
  onReject,
  onSave,
  onEmit,
  onSend,
  onFinish,
  compact = false,
}: MedicalActionRailProps) {
  const busy = (key: string) => actionKey === key;

  return (
    <div className="medical-action-rail fixed inset-x-0 bottom-0 z-40 border-t border-[#E5EAF2] bg-white/97 shadow-[0_-8px_24px_rgba(7,27,58,0.08)] backdrop-blur-md">
      <div className="mx-auto max-w-panel px-3 py-2.5 sm:px-4">
        {!compact ? (
          <div className="mb-2 hidden gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_200px]">
            <textarea
              value={motivo}
              onChange={(e) => onMotivoChange(e.target.value)}
              placeholder="Conduta / observações médicas (opcional)…"
              className="min-h-[2.5rem] w-full resize-none rounded-[10px] border border-[#D8DFEA] bg-white px-3 py-2 text-panel-xs outline-none focus:border-[#1557FF]"
            />
            <label className="text-[10px] font-bold uppercase text-[#5B6475]">
              Motivo reprovação
              <select
                value={rejectReasonCode}
                onChange={(e) => onRejectReasonChange(e.target.value as ClinicalRejectReasonCode)}
                className="mt-1 h-9 w-full rounded-[10px] border border-[#D8DFEA] px-2 text-panel-xs"
              >
                {rejectReasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-between">
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={onReject}
              disabled={Boolean(actionKey) || flags.isDelivered}
              className="medical-action-btn medical-action-btn--danger"
            >
              {busy('reject') ? '…' : 'Reprovar'}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={Boolean(actionKey)}
              className="medical-action-btn medical-action-btn--soft"
            >
              {busy('save') ? '…' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={Boolean(actionKey) || !flags.canApprove}
              className="medical-action-btn medical-action-btn--success"
            >
              {busy('approve') ? '…' : 'Aprovar'}
            </button>
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={onEmit}
              disabled={Boolean(actionKey) || (!flags.canEmit && !flags.canApprove)}
              className="medical-action-btn medical-action-btn--primary"
            >
              {busy('emit') ? '…' : 'Emitir Receita'}
            </button>
            <button
              type="button"
              onClick={onSend}
              disabled={Boolean(actionKey) || !hasReceipt || !flags.canSend}
              className="medical-action-btn medical-action-btn--accent"
            >
              {busy('send') ? '…' : 'Enviar Receita'}
            </button>
            <button
              type="button"
              onClick={onFinish}
              disabled={Boolean(actionKey) || !flags.canFinish}
              className="medical-action-btn medical-action-btn--finish"
            >
              {busy('finish') ? '…' : 'Finalizar Atendimento'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
