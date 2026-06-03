import { markMemedModuleReady } from './memedSession';
import { hidePrescription } from './showPrescription';

/** Esconde o módulo sem logout — preserva sessão BirdID/Soluti no turno. */
export function softHideMemed(): void {
  try {
    hidePrescription();
  } catch {
    // módulo pode não estar visível
  }
}

/** Logout + remoção do script — apenas ao sair do painel ou reset explícito. */
export function hardCleanUpMemed(scriptId: string): void {
  softHideMemed();
  try {
    if (window.MdHub?.command?.send) {
      window.MdHub.command.send('plataforma.sdk', 'logout');
    }
    window.MdHub?.server?.unbindEvents?.();
  } catch {
    // widget pode já estar descarregado
  }

  const script = document.getElementById(scriptId);
  if (script?.parentNode) {
    script.parentNode.removeChild(script);
  }
  markMemedModuleReady(false);
}

/** @deprecated Prefer softHideMemed na navegação entre atendimentos */
export function cleanUpMemed(scriptId: string): void {
  softHideMemed();
  markMemedModuleReady(false);
  void scriptId;
}
