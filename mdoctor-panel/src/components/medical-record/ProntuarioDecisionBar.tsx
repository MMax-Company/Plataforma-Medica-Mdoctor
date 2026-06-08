'use client';

import { Loader2 } from 'lucide-react';

interface ProntuarioDecisionBarProps {
  notes: string;
  onNotesChange: (value: string) => void;
  onReject: () => void;
  onApprove: () => void;
  disabled?: boolean;
  loadingAction?: 'approve' | 'reject' | null;
}

export function ProntuarioDecisionBar({
  notes,
  onNotesChange,
  onReject,
  onApprove,
  disabled = false,
  loadingAction = null,
}: ProntuarioDecisionBarProps) {
  const isBusy = disabled || loadingAction !== null;

  return (
    <footer className="flex h-10 w-full shrink-0 items-center justify-between gap-2.5 bg-white">
      <button
        type="button"
        onClick={onReject}
        disabled={isBusy}
        className="flex h-full min-w-[130px] flex-col items-center justify-center rounded-xl bg-[#ef4444] px-3 font-black uppercase text-white shadow-sm transition-colors hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="flex items-center gap-1 text-[10px]">
          {loadingAction === 'reject' ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <>✕ REPROVAR</>
          )}
        </span>
        <span className="text-[7px] font-normal lowercase leading-none opacity-80">não autorizar</span>
      </button>

      <div className="relative h-full min-w-0 flex-1">
        <label
          htmlFor="prontuario-optional-conduct"
          className="absolute left-3 top-1 text-[7.5px] font-bold uppercase tracking-wider text-slate-400"
        >
          Conduta Médica Opcional
        </label>
        <textarea
          id="prontuario-optional-conduct"
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          disabled={isBusy}
          maxLength={1000}
          rows={1}
          placeholder="Digite aqui orientações adicionais, observações ou justificativas (opcional)..."
          className="h-full w-full resize-none rounded-xl border border-slate-200 bg-slate-50 pb-0.5 pl-3 pr-12 pt-2.5 text-[11px] text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span
          className="pointer-events-none absolute bottom-1 right-3 text-[8px] font-bold text-slate-400"
          aria-live="polite"
        >
          {notes.length}/1000
        </span>
      </div>

      <button
        type="button"
        onClick={onApprove}
        disabled={isBusy}
        className="flex h-full min-w-[130px] flex-col items-center justify-center rounded-xl bg-[#22c55e] px-3 font-black uppercase text-white shadow-sm transition-colors hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-45"
      >
        <span className="flex items-center gap-1 text-[10px]">
          {loadingAction === 'approve' ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <>✓ APROVAR</>
          )}
        </span>
        <span className="text-[7px] font-normal lowercase leading-none opacity-80">autorizar atendimento</span>
      </button>
    </footer>
  );
}
