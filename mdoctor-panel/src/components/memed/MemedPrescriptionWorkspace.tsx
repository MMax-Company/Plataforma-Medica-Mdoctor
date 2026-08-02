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
  /** true após openPrescription() concluir — oculta botão e revela o container Memed */
  readonly prescriptionOpenedOnce?: boolean;
  readonly receiptSaved: boolean;
  readonly saveError: string | null;
  readonly error: string | null;
  readonly onOpenPrescription: () => void | Promise<void>;
  /** Escape valve: destrói iframes residuais e reabre para o paciente atual. */
  readonly onResetMemed?: () => void;
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
  onResetMemed,
  minWidth = 720,
  minHeight = 380,
}: MemedPrescriptionWorkspaceProps) {
  // Rótulos calculados fora do JSX para evitar ternários aninhados
  // BOTÃO 2 — "Carregar prescrição": prepara sessão Memed limpa para o paciente atual.
  // Não emite, não assina, não salva. Some da UI após prescriptionOpenedOnce = true.
  let buttonLabel = 'Carregar prescrição';
  if (receiptSaved) buttonLabel = 'Receita emitida';
  else if (isOpening) buttonLabel = 'Abrindo…';

  let pillLabel = 'Aguardando';
  if (loadingModule) pillLabel = 'Preparando…';
  else if (readyToOpen) pillLabel = 'Pronto para emitir';

  // PROTEÇÃO DE EDIÇÃO: o botão "Carregar prescrição" só aparece enquanto o médico
  // ainda não iniciou a sessão (prescriptionOpenedOnce = false). Após o primeiro load
  // bem-sucedido o botão some — recarregar apagaria o que o médico já editou.
  // Reexibe apenas em erro (fallback manual, paciente não perdeu trabalho funcional).
  const showEmitButton = !prescriptionOpenedOnce || !!error;

  return (
    <div className="memed-native-panel flex h-full flex-col rounded-[14px] border border-[#E5EAF2] bg-white shadow-[0_8px_28px_rgba(7,27,58,0.06)]">
      {showEmitButton && (
        <div className="flex shrink-0 flex-col gap-1.5 border-b border-[#E5EAF2] px-2.5 py-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-[#080D33]">Emissão integrada</h2>
              <span className="truncate text-[10px] text-[#5B6475]">{statusMessage}</span>
            </div>
          </div>
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
        </div>
      )}

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

      <div className="flex min-h-0 flex-1 flex-col p-1.5 sm:p-2">
        <div className="mb-1 flex shrink-0 flex-wrap gap-2 text-[10px] text-[#5B6475]">
          <span>
            <strong className="text-[#080D33]">Paciente:</strong> {atendimento?.paciente_nome || '—'}
          </span>
          <span>
            <strong className="text-[#080D33]">Medicação:</strong>{' '}
            {String(atendimento?.dados_clinicos?.medicacao_em_uso || '—')}
          </span>
        </div>

        {/* Placeholder visível antes do clique — container Memed fica em DOM mas oculto */}
        {!prescriptionOpenedOnce && (
          <div
            className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border border-[#E5EAF2] bg-[#FAFBFD]"
            style={minHeight > 0 ? { minHeight: `${minHeight}px` } : undefined}
          >
            <p className="text-sm text-[#8A95A5]">
              Clique em <strong className="text-[#5B6475]">&ldquo;Carregar prescrição&rdquo;</strong> para iniciar.
            </p>
          </div>
        )}

        {/*
          Container do SDK Memed — mantido no DOM para que o SDK possa injetar iframes.
          Oculto via wrapper enquanto !prescriptionOpenedOnce para evitar resíduo visual
          ("Documento emitido e enviado") do paciente anterior.
          O SDK manipula o container interno; React controla apenas o wrapper externo.

          Botões nativos da Memed (BOTÃO 3 e 4) vivem dentro deste container e são
          gerenciados exclusivamente pelo SDK — não devem ser substituídos nem invocados
          pelo código React:
            BOTÃO 3 — "Gerar prescrição": transforma itens carregados em documento pronto.
            BOTÃO 4 — "Emitir / Assinar / Enviar": assina digitalmente e dispara
              prescricaoImpressa (capturado por setupPrescriptionCallback).
        */}
        <div style={{ display: prescriptionOpenedOnce ? undefined : 'none' }} className="flex min-h-0 flex-1">
          <div
            id={containerId}
            className="memed-embedded-host relative min-h-0 flex-1 overflow-hidden rounded-[12px] border border-[#E5EAF2] bg-[#FAFBFD]"
            style={{
              minWidth: `min(100%, ${minWidth}px)`,
              ...(minHeight > 0 ? { minHeight: `${minHeight}px` } : {}),
            }}
            data-dp-memed-engine="sinapse"
          />
        </div>

        {prescriptionOpenedOnce && !receiptSaved && (
          <p className="mt-1.5 shrink-0 text-[10px] text-[#8A95A5]">
            Após assinar, clique em{' '}
            <strong className="text-[#5B6475]">&ldquo;Imprimir&rdquo;</strong>
            {' '}para concluir. O envio ao paciente é feito pelo Doctor Prescreve.
          </p>
        )}
        {prescriptionOpenedOnce && !receiptSaved && !isOpening && onResetMemed && (
          <button
            type="button"
            onClick={onResetMemed}
            className="mt-1 shrink-0 text-left text-[10px] text-[#8A95A5] hover:text-[#1557FF] hover:underline"
          >
            Tela travada? → Reiniciar módulo Memed
          </button>
        )}
      </div>
    </div>
  );
}
