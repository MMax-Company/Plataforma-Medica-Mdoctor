import { PRESCRIPTION_MODULE } from './onLoadPrescription';

/** Abre widget — emissão e assinatura Bird ID ocorrem dentro da Memed. */
export function showPrescription(): void {
  if (!window.MdHub?.module?.show) {
    throw new Error('MdHub não inicializado');
  }
  // Garante que tela de impressão/salvar não apareça, independente do ciclo (P1, P2+).
  // Fire-and-forget: postMessage é processado em ordem pelo módulo antes da UI renderizar.
  if (window.MdHub?.command?.send) {
    void window.MdHub.command.send(PRESCRIPTION_MODULE, 'setFeatureToggle', {
      disablePrintAll: true,
      showSuccessModal: false,
    });
  }
  window.MdHub.module.show(PRESCRIPTION_MODULE);
}

export function hidePrescription(): void {
  window.MdHub?.module?.hide?.(PRESCRIPTION_MODULE);
}
