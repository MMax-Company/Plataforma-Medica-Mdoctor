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
  atendimento: AtendimentoSummary | null;
  containerId: string;
  statusMessage: string;
  loadingModule: boolean;
  readyToOpen?: boolean;
  isOpening?: boolean;
  /** Prescrição já foi aberta automaticamente — oculta botão "Emitir Receita" para evitar reset acidental */
  prescriptionOpenedOnce?: boolean;
  receiptSaved: boolean;
  saveError: string | null;
  error: string | null;
  onOpenPrescription: () => void | Promise<void>;
  minWidth?: number;
  minHeight?: number;
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
    <div className="memed-native-panel rounded-[14px] border border-[#E5EAF2] bg-white shadow-[0_8px_28px_rgba(7,27,58,0.06)]">
      <div className="flex flex-col gap-3 border-b border-[#E5EAF2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#1557FF]">Prescrição digital</p>
          <h2 className="text-panel-base font-bold text-[#080D33]">Emissão integrada</h2>
          <p className="mt-1 text-panel-xs text-[#5B6475]">{statusMessage}</p>
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
        <div className="mx-4 mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {saveError ? (
        <div className="mx-4 mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{saveError}</div>
      ) : null}
      {receiptSaved ? (
        <div className="mx-4 mt-3 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Receita registrada. Retornando ao painel…
        </div>
      ) : null}

      <div className="p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap gap-3 text-panel-xs text-[#5B6475]">
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
          className="memed-embedded-host relative w-full overflow-hidden rounded-[12px] border border-[#E5EAF2] bg-[#FAFBFD]"
          style={{
            minWidth: `min(100%, ${minWidth}px)`,
            minHeight: `${minHeight}px`,
            height: 'clamp(420px, 62vh, 720px)',
          }}
          data-dp-memed-engine="sinapse"
        />

        {!receiptSaved && (
          <p className="mt-2 text-[11px] text-[#8A95A5]">
            Após assinar, clique em{' '}
            <strong className="text-[#5B6475]">&ldquo;Imprimir&rdquo;</strong>
            {' '}para concluir a emissão. O envio ao paciente será feito pelo Doctor Prescreve.
          </p>
        )}

      </div>
    </div>
  );
}
