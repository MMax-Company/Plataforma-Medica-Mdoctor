'use client';

import { Check, Loader2, X } from 'lucide-react';

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
    <section className="prontuario-decision-bar">
      <button type="button" onClick={onReject} disabled={isBusy} className="prontuario-decision-bar__reject">
        <span className="prontuario-decision-bar__icon-ring">
          {loadingAction === 'reject' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <span className="prontuario-decision-bar__label">REPROVAR</span>
        <span className="prontuario-decision-bar__hint">Não autorizar atendimento</span>
      </button>

      <label className="prontuario-decision-bar__notes">
        <span className="prontuario-decision-bar__notes-title">CONDUTA MÉDICA OPCIONAL</span>
        <textarea
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          disabled={isBusy}
          className="prontuario-decision-bar__notes-input"
          placeholder="Digite aqui orientações adicionais, observações ou justificativas (opcional)..."
        />
      </label>

      <button type="button" onClick={onApprove} disabled={isBusy} className="prontuario-decision-bar__approve">
        <span className="prontuario-decision-bar__icon-ring">
          {loadingAction === 'approve' ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <span className="prontuario-decision-bar__label">APROVAR</span>
        <span className="prontuario-decision-bar__hint">Autorizar atendimento</span>
      </button>
    </section>
  );
}
