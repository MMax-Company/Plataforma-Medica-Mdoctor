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

  window.MdHub.event.add('prescricaoImpressa', async (payload) => {
    console.log('[Memed] prescricaoImpressa disparado, payload:', payload);
    if (emissionHandledThisCycle) {
      pushDiagnosticEvent('prescricaoImpressa:duplicado-ignorado', { iframes: captureIframeState() });
      return;
    }
    emissionHandledThisCycle = true;
    pushDiagnosticEvent('prescricaoImpressa', {
      iframes: captureIframeState(),
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload as object) : [],
    });
    // Aguarda 500ms para tela de impressão aparecer e dispara ESC para fechá-la
    await new Promise<void>(resolve => setTimeout(resolve, 500));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    setTimeout(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    }, 200);

    hidePrescription();
    forceHideMemedContainer();
    recordMemedPrescriptionEmission();
    scheduleHardReset(1500);
    console.log('[Memed] módulo escondido');
    await new Promise<void>(resolve => setTimeout(resolve, 2000));
    console.log('[Memed] aguardou 2s');
    options.onPrescriptionPrinted(payload);
    console.log('[Memed] Fluxo concluído');
  });
  if (options.onPrescriptionDeleted) {
    window.MdHub.event.add('prescricaoExcluida', options.onPrescriptionDeleted);
  }
  callbacksBound = true;
}

export function resetPrescriptionCallbacksFlag(): void {
  callbacksBound = false;
}
