import type { MemedModuleOptions } from './types';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import { forceHideMemedContainer, recordMemedPrescriptionEmission, scheduleHardReset } from './memedRuntime';
import { hidePrescription } from './showPrescription';

let callbacksBound = false;
// Guard de idempotência: garante que prescricaoImpressa seja processado uma única vez
// por ciclo de paciente. Reset via resetEmissionGuard() no início de cada prepareAndShowPrescription.
let emissionHandledThisCycle = false;

/** Reseta o guard para o próximo paciente — chamado no início de prepareAndShowPrescription. */
export function resetEmissionGuard(): void {
  emissionHandledThisCycle = false;
}

/** Eventos prescricaoImpressa / prescricaoExcluida — emissão real no widget. */
export function setupPrescriptionCallback(options: MemedModuleOptions): void {
  if (!window.MdHub?.event?.add) {
    throw new Error('MdHub.event indisponível');
  }
  if (callbacksBound) return;

  // prescricaoGerada: dispara ANTES de window.print() — abordagem oficial para interceptar antes do diálogo.
  // Tenta nos dois namespaces do SDK (MdSinapsePrescricao e MdHub) para cobertura máxima.
  const geradaHandler = async (payload: unknown) => {
    console.log('[Memed] prescricaoGerada disparado (antes da impressão). Payload:', payload);
    if (emissionHandledThisCycle) {
      pushDiagnosticEvent('prescricaoGerada:duplicado-ignorado', { iframes: captureIframeState() });
      return;
    }
    emissionHandledThisCycle = true;
    pushDiagnosticEvent('prescricaoGerada', {
      iframes: captureIframeState(),
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload as object) : [],
    });
    hidePrescription();
    forceHideMemedContainer();
    recordMemedPrescriptionEmission();
    scheduleHardReset(1500);
    console.log('[Memed] módulo escondido imediatamente');
    await new Promise<void>(resolve => setTimeout(resolve, 500));
    if (options.onPrescriptionPrinted) options.onPrescriptionPrinted(payload);
    console.log('[Memed] Fluxo finalizado silenciosamente.');
  };

  try { window.MdSinapsePrescricao?.event?.add?.('prescricaoGerada', geradaHandler); } catch {}
  try { window.MdHub?.event?.add?.('prescricaoGerada', geradaHandler); } catch {}

  // prescricaoImpressa: colapso imediato do alvo — faz o browser abortar o print dialog nativo.
  window.MdHub.event.add('prescricaoImpressa', async (payload) => {
    console.log('[Memed] prescricaoImpressa detectado. Forçando colapso imediato do alvo...');
    if (emissionHandledThisCycle) {
      pushDiagnosticEvent('prescricaoImpressa:duplicado-ignorado', { iframes: captureIframeState() });
      return;
    }
    emissionHandledThisCycle = true;
    pushDiagnosticEvent('prescricaoImpressa', {
      iframes: captureIframeState(),
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload as object) : [],
    });

    // AÇÃO NUCLEAR IMEDIATA (0ms): destrói o conteúdo do container para o browser perder o alvo da impressão
    document.querySelectorAll<HTMLElement>('iframe[src*="memed"], div[id*="memed"], .memed-container').forEach(el => {
      el.style.display = 'none';
      el.innerHTML = '';
    });
    forceHideMemedContainer();
    window.blur();

    recordMemedPrescriptionEmission();
    scheduleHardReset(1500);

    await new Promise<void>(resolve => setTimeout(resolve, 300));
    if (options.onPrescriptionPrinted) options.onPrescriptionPrinted(payload);
    console.log('[Memed] Fluxo avançado com sucesso após colapso do modal.');
  });
  if (options.onPrescriptionDeleted) {
    window.MdHub.event.add('prescricaoExcluida', options.onPrescriptionDeleted);
  }
  callbacksBound = true;
}

export function resetPrescriptionCallbacksFlag(): void {
  callbacksBound = false;
}
