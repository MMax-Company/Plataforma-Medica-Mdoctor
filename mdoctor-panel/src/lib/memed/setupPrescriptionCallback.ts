import type { MemedModuleOptions } from './types';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import {
  forceHideMemedContainer,
  forceMarkModuleReady,
  recordMemedPrescriptionEmission,
  resetPrescriptionShownOnce,
  scheduleHardReset,
  waitForModuleReinit,
} from './memedRuntime';
import { hidePrescription } from './showPrescription';

// Guards de idempotência: listeners acumulam no MdHub entre emissões sucessivas.
// Estes flags garantem que prescricaoImpressa e prescricaoExcluida sejam processados
// uma única vez por ciclo de paciente, mesmo com múltiplos handlers registrados.
// Reset via resetEmissionGuard() no início de cada prepareAndShowPrescription.
let emissionHandledThisCycle = false;
let deletionHandledThisCycle = false;

/** Reseta os guards para o próximo paciente — chamado no início de prepareAndShowPrescription. */
export function resetEmissionGuard(): void {
  emissionHandledThisCycle = false;
  deletionHandledThisCycle = false;
}

/** Eventos prescricaoImpressa / prescricaoExcluida — emissão real no widget. */
export function setupPrescriptionCallback(options: MemedModuleOptions): void {
  if (!window.MdHub?.event?.add) {
    throw new Error('MdHub.event indisponível');
  }
  // prescricaoGerada: dispara antes de window.print() — cobertura antecipada caso o SDK não emita prescricaoImpressa.
  const geradaHandler = (payload: unknown) => {
    console.log('[Memed] prescricaoGerada disparado. Payload:', payload);
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
    if (options.onPrescriptionPrinted) options.onPrescriptionPrinted(payload);
    console.log('[Memed] prescricaoGerada: overlay fechado, React sinalizado.');
  };

  try { window.MdSinapsePrescricao?.event?.add?.('prescricaoGerada', geradaHandler); } catch {}
  try { window.MdHub?.event?.add?.('prescricaoGerada', geradaHandler); } catch {}

  // prescricaoImpressa: hide → aguarda SDK reinicializar (1.8s) → sinaliza React para próximo paciente.
  window.MdHub.event.add('prescricaoImpressa', async (payload) => {
    console.log('[Memed] prescricaoImpressa disparado');
    if (emissionHandledThisCycle) {
      pushDiagnosticEvent('prescricaoImpressa:duplicado-ignorado', { iframes: captureIframeState() });
      return;
    }
    emissionHandledThisCycle = true;
    pushDiagnosticEvent('prescricaoImpressa', {
      iframes: captureIframeState(),
      payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload as object) : [],
    });
    hidePrescription();
    forceHideMemedContainer();
    recordMemedPrescriptionEmission();
    scheduleHardReset(1500);
    console.log('[Memed] Aguardando SDK reinicializar antes do próximo paciente...');
    console.log('[MEMED_PHASE1] waiting_module_ready_after_print');
    await waitForModuleReinit(5000).catch(() => {
      console.warn('[MEMED_PHASE1] module_ready_timeout — continuando mesmo sem confirmação de reinit');
    });
    console.log('[MEMED_PHASE1] module_ready_after_print');
    // core:moduleInit confirmado — SDK pronto, iframes intactos.
    // Chama newPrescription aqui para navegar o iframe para tela em branco ANTES de
    // liberar o próximo paciente. Assim o Doctor nunca vê "Documento emitido e enviado"
    // do paciente anterior; o iframe já está em branco quando setPaciente de P2 chega.
    if (window.MdHub?.command?.send) {
      try {
        await Promise.race([
          window.MdHub.command.send('plataforma.prescricao', 'newPrescription'),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        console.log('[MEMED_CYCLE] new_prescription_pre_cleared');
        // core:moduleInit de plataforma.prescricao não redispara após hide (ocorre apenas
        // na carga inicial do SDK). newPrescription com sucesso é a única confirmação
        // de que o módulo está pronto — restaura moduleReady para desbloquear P2.
        forceMarkModuleReady();
        console.log('[MEMED_CYCLE] module_ready_force_restored');
      } catch {
        console.warn('[MEMED_CYCLE] new_prescription_pre_clear_timeout — continuando');
      }
    }
    console.log('[Memed] SDK pronto — sinalizando React para carregar próximo paciente.');
    resetPrescriptionShownOnce();
    console.log('[MEMED_PHASE1] prescription_cycle_reset');
    if (options.onPrescriptionPrinted) options.onPrescriptionPrinted(payload);
    console.log('[MEMED_PHASE1] next_patient_released');
  });
  if (options.onPrescriptionDeleted) {
    const deletedHandler = (payload: unknown) => {
      if (deletionHandledThisCycle) return;
      deletionHandledThisCycle = true;
      options.onPrescriptionDeleted!(payload);
    };
    window.MdHub.event.add('prescricaoExcluida', deletedHandler);
  }
}

/** Reseta os guards de idempotência — chamar antes de setupPrescriptionCallback() para cada novo paciente. */
export function resetPrescriptionCallbacksFlag(): void {
  emissionHandledThisCycle = false;
  deletionHandledThisCycle = false;
}
