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
    // Restrição adicional de funcionalidades do módulo (identidade visual/comportamento
    // institucional Doctor Prescreve) — mantém tudo acima e só adiciona o que faltava.
    optionsPrescription: true,
    editIdentification: false,
    conclusionModalEdit: false,
    buttonClose: true,
    newFormula: false,
    addPrescriptionDrug: true,
    removePrescriptionDrug: true,
    editPrescriptionDrugTitle: false,
    editPosology: true,
    editQuantity: true,
    autocompleteManipulated: false,
    autocompleteCompositions: true,
    // Grafia oficial do SDK Memed é "Pheripherals" (com "h"), não "Peripherals" —
    // a doc.memed.com.br usa as duas formas em pontos diferentes da mesma página,
    // mas a chave que o widget realmente aceita é a com "h".
    autocompletePheripherals: false,
    copyMedicalRecords: false,
    forceSign: true,
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
  // forceSign:true já vai no objeto principal acima — não reenviar aqui.
}

/** @deprecated */
export async function applyDoctorPrescreveFeatureToggles(): Promise<void> {
  return applyClinicalMemedUx();
}
