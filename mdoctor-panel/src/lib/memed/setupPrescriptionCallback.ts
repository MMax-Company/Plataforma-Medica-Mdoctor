import type { MemedModuleOptions } from './types';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import { hardResetMemedContainer, recordMemedPrescriptionEmission } from './memedRuntime';
import { hidePrescription } from './showPrescription';

let callbacksBound = false;

/** Eventos prescricaoImpressa / prescricaoExcluida — emissão real no widget. */
export function setupPrescriptionCallback(options: MemedModuleOptions): void {
  if (!window.MdHub?.event?.add) {
    throw new Error('MdHub.event indisponível');
  }
  if (callbacksBound) return;

  window.MdHub.event.add('prescricaoImpressa', (payload) => {
    pushDiagnosticEvent('prescricaoImpressa', {
      iframes: captureIframeState(),
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload as object) : [],
    });
    hidePrescription();
    recordMemedPrescriptionEmission();
    options.onPrescriptionPrinted(payload);
    // Hard reset após 1.5s: janela segura (1200-1800ms) para a Memed concluir
    // requisições de rede da assinatura antes de destruir o container DOM.
    window.setTimeout(() => hardResetMemedContainer(), 1500);
  });
  if (options.onPrescriptionDeleted) {
    window.MdHub.event.add('prescricaoExcluida', options.onPrescriptionDeleted);
  }
  callbacksBound = true;
}

export function resetPrescriptionCallbacksFlag(): void {
  callbacksBound = false;
}
