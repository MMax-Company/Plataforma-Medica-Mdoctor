'use client';

import { useRef } from 'react';

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
  const embeddedViewportRef = useRef<HTMLDivElement>(null);

  // Rótulos calculados fora do JSX para evitar ternários aninhados
  // BOTÃO 2 — "Carregar prescrição": prepara sessão Memed limpa para o paciente atual.
  // Não emite, não assina, não salva. Some da UI após prescriptionOpenedOnce = true.
  let buttonLabel = 'Carregar prescrição';
  if (receiptSaved) buttonLabel = 'Receita emitida';
  else if (isOpening) buttonLabel = 'Abrindo…';

  // PROTEÇÃO DE EDIÇÃO: o botão "Carregar prescrição" só aparece enquanto o médico
  // ainda não iniciou a sessão (prescriptionOpenedOnce = false). Após o primeiro load
  // bem-sucedido o botão some — recarregar apagaria o que o médico já editou.
  // Reexibe apenas em erro (fallback manual, paciente não perdeu trabalho funcional).
  const showEmitButton = !prescriptionOpenedOnce || !!error;

  return (
    <div className="memed-native-panel relative flex h-full flex-col bg-white">

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

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Placeholder visível antes do clique — container Memed fica em DOM mas oculto */}
        {!prescriptionOpenedOnce && (
          <div
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-white"
            style={minHeight > 0 ? { minHeight: `${minHeight}px` } : undefined}
          >
            <p className="max-w-md text-center text-sm text-[#5B6475]">
              {statusMessage}
            </p>
            {showEmitButton && (
              <button
                type="button"
                onClick={() => void (error && onResetMemed ? onResetMemed() : onOpenPrescription())}
                disabled={!readyToOpen || receiptSaved || loadingModule || isOpening}
                className="inline-flex h-11 items-center justify-center rounded-[10px] bg-[#1557FF] px-6 text-sm font-bold text-white shadow-sm transition hover:bg-[#1246d4] disabled:cursor-not-allowed disabled:bg-[#9AA5B5]"
              >
                {error ? 'Reiniciar prescrição' : buttonLabel}
              </button>
            )}
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
        <div
          ref={embeddedViewportRef}
          style={{
            display: prescriptionOpenedOnce ? undefined : 'none',
            ...(minHeight > 0 ? { minHeight: `${minHeight}px` } : {}),
          }}
          className="memed-embedded-viewport memed-programmatic-scroll relative min-h-0 flex-1"
        >
          <div
            id={containerId}
            className="memed-embedded-host absolute left-0 top-0 overflow-hidden rounded-[12px] border border-[#E5EAF2] bg-[#FAFBFD]"
            style={{
              minWidth: `min(100%, ${minWidth}px)`,
            }}
            data-dp-memed-engine="sinapse"
          />
        </div>

        {prescriptionOpenedOnce && !receiptSaved && (
          <button
            type="button"
            onClick={() => {
              const viewport = embeddedViewportRef.current;
              let scrollable: HTMLElement | null = viewport;
              while (scrollable) {
                if (scrollable.scrollHeight > scrollable.clientHeight) {
                  scrollable.scrollTo({ top: scrollable.scrollHeight, behavior: 'smooth' });
                }
                scrollable = scrollable.parentElement;
              }
            }}
            className="absolute bottom-3 right-3 z-30 inline-flex h-10 items-center justify-center rounded-full bg-[#1557FF] px-5 text-xs font-bold text-white shadow-lg transition hover:bg-[#1246d4] focus:outline-none focus:ring-2 focus:ring-[#1557FF] focus:ring-offset-2"
          >
            Ir para o final ↓
          </button>
        )}

      </div>
    </div>
  );
}
