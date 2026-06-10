import { addMedicationsFromAtendimento } from './addMedicationsFromAtendimento';
import { setClinicalOrientations } from './setClinicalOrientations';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';
import { buildPatientFromAtendimento } from './buildPatientFromAtendimento';
import type { MemedPrescriptionItem } from './clinicalPrescription.types';
import {
  captureIframeState,
  clearMemedDiagnosticLog,
  pushDiagnosticEvent,
  sendNewPrescriptionWithDiagnostic,
} from './memedCommandDiagnostic';
import {
  markPrescriptionShownOnce,
  resetModuleReadyAndGetWaitPromise,
  wasPrescriptionShownBefore,
} from './memedRuntime';
import { setMemedPatient } from './setMemedPatient';
import { showPrescription } from './showPrescription';
import type { MemedPatient } from './types';

export type PreparePrescriptionResult = {
  medCount: number;
  memed_items_sent: MemedPrescriptionItem[];
  pending_medical_review: boolean;
  pending_reasons: string[];
};

/**
 * Sequência para a PRIMEIRA prescrição da sessão:
 *   newPrescription → setPaciente → addItem → orientações → show.
 *
 * Sequência para prescrições SUBSEQUENTES (módulo foi ocultado após emissão anterior):
 *   show → waitModuleReady(core:moduleInit) → newPrescription → setPaciente → addItem → orientações.
 *
 * Causa raiz diagnosticada: após prescricaoImpressa + hide(), o SDK Memed remove os iframes
 * do módulo plataforma.prescricao do DOM. Sem iframes, MdHub.command.send enfileira mensagens
 * que nunca são processadas — causando timeout em newPrescription e setPaciente.
 * Chamar show() ANTES dos comandos reconstrói os iframes e dispara core:moduleInit novamente.
 */
export async function prepareAndShowPrescription(
  atendimento: AtendimentoForMemed,
  patient?: MemedPatient | null,
): Promise<PreparePrescriptionResult> {
  clearMemedDiagnosticLog();

  const resolvedPatient = patient || buildPatientFromAtendimento(atendimento);
  const isSubsequent = wasPrescriptionShownBefore();

  pushDiagnosticEvent('prepareStart', {
    patientId: resolvedPatient.idExterno,
    isSubsequent,
    iframes: captureIframeState(),
  });

  let alreadyShown = false;

  if (isSubsequent) {
    // Módulo foi ocultado — iframes removidos do DOM.
    // Resetar o flag de pronto ANTES de chamar show() para não perder o core:moduleInit.
    pushDiagnosticEvent('preShow:reactivating', { iframes: captureIframeState() });
    const waitReady = resetModuleReadyAndGetWaitPromise(35_000);
    showPrescription();
    await waitReady;
    alreadyShown = true;
    pushDiagnosticEvent('postShow:ready', { iframes: captureIframeState() });
  }

  // 1. Criar contexto da prescrição ANTES de setar o paciente.
  try {
    await sendNewPrescriptionWithDiagnostic();
  } catch (err) {
    pushDiagnosticEvent('afterNewPrescription', { newPrescriptionOk: false, iframes: captureIframeState() });
    // Propagar — não tentar setPaciente em contexto não criado.
    throw err;
  }

  pushDiagnosticEvent('afterNewPrescription', { newPrescriptionOk: true, iframes: captureIframeState() });

  // 2. Setar paciente no contexto estável (sem risco de ser sobrescrito por newPrescription).
  await setMemedPatient(resolvedPatient);

  // 3. Medicamentos + orientações.
  const { added, memed_items_sent, pending_medical_review, pending_reasons } =
    await addMedicationsFromAtendimento(atendimento);
  await setClinicalOrientations(atendimento);

  // 4. Exibir widget — só se não foi exibido no pré-show acima.
  if (!alreadyShown) {
    markPrescriptionShownOnce();
    await new Promise((r) => setTimeout(r, 500));
    showPrescription();
  }

  return {
    medCount: added,
    memed_items_sent,
    pending_medical_review,
    pending_reasons,
  };
}
