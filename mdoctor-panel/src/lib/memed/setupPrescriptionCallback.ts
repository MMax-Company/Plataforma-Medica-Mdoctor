import type { MemedModuleOptions } from './types';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import { recordMemedPrescriptionEmission } from './memedRuntime';

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
    recordMemedPrescriptionEmission();
    options.onPrescriptionPrinted(payload);
  });
  if (options.onPrescriptionDeleted) {
    window.MdHub.event.add('prescricaoExcluida', options.onPrescriptionDeleted);
  }
  callbacksBound = true;
}

export function resetPrescriptionCallbacksFlag(): void {
  callbacksBound = false;
}
