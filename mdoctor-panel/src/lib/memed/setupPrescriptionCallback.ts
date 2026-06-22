import type { MemedModuleOptions } from './types';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import {
  forceHideMemedContainer,
  recordMemedPrescriptionEmission,
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
    // scheduleHardReset removido: o CSS hide deve permanecer até que openPrescription (P2+)
    // chame hardResetMemedContainer() explicitamente — evita "Documento emitido e enviado"
    // aparecer se o médico abrir P2 mais de 1,5s após a emissão de P1.
    if (options.onPrescriptionPrinted) options.onPrescriptionPrinted(payload);
    console.log('[Memed] prescricaoGerada: overlay fechado, React sinalizado.');
  };

  try { window.MdSinapsePrescricao?.event?.add?.('prescricaoGerada', geradaHandler); } catch {}
  try { window.MdHub?.event?.add?.('prescricaoGerada', geradaHandler); } catch {}

  // prescricaoImpressa: hide → sinaliza React para próximo paciente.
  // newPrescription NÃO é chamado aqui — o módulo está oculto e o botão "Nova Prescrição"
  // não existe no DOM nesse estado (docs Memed: newPrescription = clique no botão da UI).
  // newPrescription é chamado em prepareAndShowPrescription APÓS show(), quando o módulo
  // está ativo e o botão existe — disparando core:moduleInit antes de setPaciente.
  window.MdHub.event.add('prescricaoImpressa', (payload) => {
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
    if (options.onPrescriptionPrinted) options.onPrescriptionPrinted(payload);
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
