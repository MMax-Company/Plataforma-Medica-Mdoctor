import type { MemedModuleInitPayload } from './types';

const PRESCRIPTION_MODULE = 'plataforma.prescricao';

/** Registra core:moduleInit — padrão memed-react onLoadPrescription. */
export function onLoadPrescription(onReady: () => void): void {
  if (!window.MdSinapsePrescricao?.event?.add) {
    throw new Error('MdSinapsePrescricao não inicializado após load do script Memed');
  }

  window.MdSinapsePrescricao.event.add('core:moduleInit', (modulo: MemedModuleInitPayload) => {
    if (modulo.name === PRESCRIPTION_MODULE) {
      onReady();
    }
  });
}

export { PRESCRIPTION_MODULE };
