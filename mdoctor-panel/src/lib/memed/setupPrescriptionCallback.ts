import type { MemedModuleOptions } from './types';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import {
  forceHideMemedContainer,
  recordMemedPrescriptionEmission,
} from './memedRuntime';
import { hidePrescription } from './showPrescription';
import { parsePrescriptionPayload } from './parsePrescriptionPayload';

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
  // Se o payload estiver vazio (sem receitaId/pdfUrl/receitaUrl), NÃO consome o guard:
  // prescricaoImpressa chegará logo em seguida com o payload completo e processará a emissão.
  // Consumir o guard com payload vazio causava travamento: handlePrescriptionPrinted retornava
  // sem chamar onComplete(), e prescricaoImpressa era bloqueado pelo guard já consumido.
  const geradaHandler = (payload: unknown) => {
    console.log('[Memed] prescricaoGerada disparado. Payload:', payload);
    if (emissionHandledThisCycle) {
      pushDiagnosticEvent('prescricaoGerada:duplicado-ignorado', { iframes: captureIframeState() });
      return;
    }

    const parsed = parsePrescriptionPayload(payload);
    // Requer pelo menos uma URL — receitaId sozinho não é suficiente.
    // Certificado digital: prescricaoGerada dispara com id mas sem pdfUrl/receitaUrl;
    // prescricaoImpressa chega logo em seguida com o payload completo.
    const hasValidPayload = !!(parsed.pdfUrl || parsed.receitaUrl || parsed.digitalLink);

    if (!hasValidPayload) {
      // Oculta o widget visualmente, mas não consome o guard nem chama onPrescriptionPrinted.
      // prescricaoImpressa processará a emissão com o payload completo.
      pushDiagnosticEvent('prescricaoGerada:sem-url-aguarda-impressa', { iframes: captureIframeState() });
      hidePrescription();
      forceHideMemedContainer();
      recordMemedPrescriptionEmission();
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
    if (options.onPrescriptionPrinted) options.onPrescriptionPrinted(payload);
    console.log('[Memed] prescricaoGerada: overlay fechado, React sinalizado.');
  };

  try { window.MdSinapsePrescricao?.event?.add?.('prescricaoGerada', geradaHandler); } catch {}
  try { window.MdHub?.event?.add?.('prescricaoGerada', geradaHandler); } catch {}

  // prescricaoImpressa: CSS hide → sinaliza React para próximo paciente.
  // MdHub.module.hide() NÃO é chamado aqui — destroi referências DOM dos sub-módulos
  // (platform.sms-modal etc.), causando "Cannot read properties of null (reading 'style')"
  // quando prepareAndShowPrescription chama show() no P2+. O módulo permanece ativo
  // internamente; forceHideMemedContainer() garante ocultamento visual via CSS.
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
