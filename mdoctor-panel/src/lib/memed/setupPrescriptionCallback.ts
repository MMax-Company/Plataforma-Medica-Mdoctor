import type { MemedModuleOptions } from './types';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import { forceHideMemedContainer, recordMemedPrescriptionEmission, scheduleHardReset } from './memedRuntime';
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
    forceHideMemedContainer();
    recordMemedPrescriptionEmission();
    options.onPrescriptionPrinted(payload);
    // Hard reset após 1.5s — janela segura para a Memed concluir requisições de rede.
    // scheduleHardReset cancela timer anterior e é cancelável por cancelPendingHardReset()
    // caso P2+ inicie antes de 1.5s expirarem.
    scheduleHardReset(1500);
  });
  if (options.onPrescriptionDeleted) {
    window.MdHub.event.add('prescricaoExcluida', options.onPrescriptionDeleted);
  }
  callbacksBound = true;
}

export function resetPrescriptionCallbacksFlag(): void {
  callbacksBound = false;
}
