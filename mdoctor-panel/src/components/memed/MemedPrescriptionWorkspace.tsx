'use client';

import { StatusPill } from '@/components/ui/DesignSystem';

type AtendimentoSummary = {
  id: string;
  paciente_nome?: string;
  condicao?: string;
  risco?: string | null;
  dados_clinicos?: {
    medicacao_em_uso?: string;
    doenca_cronica?: string;
    conduta?: string;
  };
};

type MemedPrescriptionWorkspaceProps = {
  readonly atendimento: AtendimentoSummary | null;
  readonly containerId: string;
  readonly statusMessage: string;
  readonly loadingModule: boolean;
  readonly readyToOpen?: boolean;
  readonly isOpening?: boolean;
  /** Prescrição já foi aberta automaticamente — oculta botão "Emitir Receita" para evitar reset acidental */
  readonly prescriptionOpenedOnce?: boolean;
  readonly receiptSaved: boolean;
  readonly saveError: string | null;
  readonly error: string | null;
  readonly onOpenPrescription: () => void | Promise<void>;
  readonly minWidth?: number;
  readonly minHeight?: number;
};

export function MemedPrescriptionWorkspace({
  atendimento,
  containerId,
  statusMessage,
  loadingModule,
  readyToOpen = false,
  isOpening = false,
  prescriptionOpenedOnce = false,
  receiptSaved,
  saveError,
  error,
  onOpenPrescription,
  minWidth = 720,
  minHeight = 380,
}: MemedPrescriptionWorkspaceProps) {
  // Rótulos calculados fora do JSX para evitar ternários aninhados
  let buttonLabel = 'Emitir Receita';
  if (receiptSaved) buttonLabel = 'Receita emitida';
  else if (isOpening) buttonLabel = 'Abrindo…';

  let pillLabel = 'Aguardando';
  if (loadingModule) pillLabel = 'Preparando…';
  else if (readyToOpen) pillLabel = 'Pronto para emitir';

  // Após a prescrição abrir automaticamente, o botão some para não resetar o fluxo.
  // Só reexibe em caso de erro (fallback manual).
  const showEmitButton = !prescriptionOpenedOnce || !!error;

  return (
    <div className="memed-native-panel flex h-full flex-col rounded-[14px] border border-[#E5EAF2] bg-white shadow-[0_8px_28px_rgba(7,27,58,0.06)]">
      <div className="flex flex-col gap-2 border-b border-[#E5EAF2] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#1557FF]">Prescrição digital</p>
          <h2 className="text-panel-sm font-bold text-[#080D33]">Emissão integrada</h2>
          <p className="mt-0.5 text-[11px] text-[#5B6475]">{statusMessage}</p>
        </div>
        {showEmitButton && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={readyToOpen ? 'success' : 'secondary'}>
              {pillLabel}
            </StatusPill>
            <button
              type="button"
              onClick={() => void onOpenPrescription()}
              disabled={!readyToOpen || receiptSaved || loadingModule || isOpening}
              className="inline-flex h-10 items-center justify-center rounded-[10px] bg-[#1557FF] px-4 text-xs font-bold text-white shadow-sm transition hover:bg-[#1246d4] disabled:cursor-not-allowed disabled:bg-[#9AA5B5]"
            >
              {buttonLabel}
            </button>
          </div>
        )}
      </div>

      {error ? (
        <div className="mx-4 mt-3 shrink-0 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {saveError ? (
        <div className="mx-4 mt-3 shrink-0 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{saveError}</div>
      ) : null}
      {receiptSaved ? (
        <div className="mx-4 mt-3 shrink-0 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Receita registrada. Retornando ao painel…
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
        <div className="mb-1.5 flex shrink-0 flex-wrap gap-2 text-[11px] text-[#5B6475]">
          <span>
            <strong className="text-[#080D33]">Paciente:</strong> {atendimento?.paciente_nome || '—'}
          </span>
          <span>
            <strong className="text-[#080D33]">Medicação:</strong>{' '}
            {String(atendimento?.dados_clinicos?.medicacao_em_uso || '—')}
          </span>
        </div>

        <div
          id={containerId}
          className="memed-embedded-host relative min-h-0 flex-1 overflow-hidden rounded-[12px] border border-[#E5EAF2] bg-[#FAFBFD]"
          style={{
            minWidth: `min(100%, ${minWidth}px)`,
            minHeight: `${minHeight}px`,
          }}
          data-dp-memed-engine="sinapse"
        />

        {!receiptSaved && (
          <p className="mt-1.5 shrink-0 text-[10px] text-[#8A95A5]">
            Após assinar, clique em{' '}
            <strong className="text-[#5B6475]">&ldquo;Imprimir&rdquo;</strong>
            {' '}para concluir. O envio ao paciente é feito pelo Doctor Prescreve.
          </p>
        )}

      </div>
    </div>
  );
}
