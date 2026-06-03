import { PRESCRIPTION_MODULE } from './onLoadPrescription';

/** Abre widget — emissão e assinatura Bird ID ocorrem dentro da Memed. */
export function showPrescription(): void {
  if (!window.MdHub?.module?.show) {
    throw new Error('MdHub não inicializado');
  }
  window.MdHub.module.show(PRESCRIPTION_MODULE);
}

export function hidePrescription(): void {
  window.MdHub?.module?.hide?.(PRESCRIPTION_MODULE);
}
