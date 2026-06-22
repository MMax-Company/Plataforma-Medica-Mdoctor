import { PRESCRIPTION_MODULE } from './onLoadPrescription';

// 4s por chamada: SDK pode estar em reinit após hide() e demorar para aceitar setFeatureToggle.
// É best-effort — timeout não bloqueia setPaciente nem show().
const TOGGLE_TIMEOUT_MS = 4000;

async function sendToggle(payload: Record<string, unknown>): Promise<void> {
  if (!window.MdHub?.command?.send) return;
  await Promise.race([
    window.MdHub.command.send(PRESCRIPTION_MODULE, 'setFeatureToggle', payload) as Promise<unknown>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('setFeatureToggle timeout')), TOGGLE_TIMEOUT_MS)
    ),
  ]);
}

/**
 * UX clínica — executar ANTES de MdHub.module.show (doc Memed).
 * Assinatura continua no widget; apenas restringe providers e remove onboarding.
 */
export async function applyClinicalMemedUx(): Promise<void> {
  if (!window.MdHub?.command?.send) {
    throw new Error('MdHub indisponível para configurar UX clínica');
  }

  await sendToggle({
    guidesOnboarding: false,
    historyPrescription: false,
    removePrescription: false,
    deletePatient: false,
    removePatient: false,
    editPatient: false,
    changePatient: false,
    addPatient: false,
    dropdownSync: false,
    showHelpMenu: false,
    allowShareModal: false,
    showProtocol: false,
    enableAlerts: true,
    setPatientAllergy: true,
    disablePrintAll: true,
    autoPrint: false,
    hidePrintDialog: true,
    hideBeacons: true,
    showSuccessModal: false,
  });

  const providerVariants: Array<string[]> = [
    ['soluti'],
    ['birdid'],
    ['bird'],
    ['soluti', 'birdid'],
  ];

  for (const providers of providerVariants) {
    try {
      await sendToggle({ setAllowedSignatureProviders: providers });
      break;
    } catch {
      /* Memed pode rejeitar formato — tenta próximo */
    }
  }

  try {
    await sendToggle({ forceSign: true });
  } catch {
    /* opcional por ambiente */
  }
}

/** @deprecated */
export async function applyDoctorPrescreveFeatureToggles(): Promise<void> {
  return applyClinicalMemedUx();
}
