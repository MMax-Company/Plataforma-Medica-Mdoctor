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
  isMemedRuntimeReady,
  markPrescriptionShownOnce,
  resetModuleReadyAndGetWaitPromise,
  waitForMemedModuleReady,
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
 *   show() → waitModuleReady (resolve imediato se já pronto) → newPrescription → setPaciente → addItem
 *
 * Sequência para prescrições SUBSEQUENTES (após hide() remover os iframes):
 *   resetModuleReady → show() → waitCoreModuleInit → newPrescription → setPaciente → addItem
 *
 * Causa raiz: para pacientes subsequentes, hide() remove os iframes do módulo plataforma.prescricao
 * do DOM. Sem iframes, MdHub.command.send enfileira mensagens que nunca são processadas —
 * causando timeout em newPrescription (15s) e setPaciente (12-42s).
 *
 * Para o PRIMEIRO paciente o módulo pode já estar pronto (core:moduleInit disparou durante
 * o carregamento da SDK). Não resetamos o flag nesse caso — waitForMemedModuleReady() resolve
 * imediatamente se moduleReady já é true, ou aguarda o evento se SDK ainda está carregando.
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
    moduleReadyBefore: isMemedRuntimeReady(),
    iframes: captureIframeState(),
  });

  // 1. Garantir iframes presentes e módulo pronto.
  pushDiagnosticEvent('preShow', { isSubsequent, iframes: captureIframeState() });

  if (isSubsequent) {
    // Iframes foram removidos por hide() — reset do flag necessário para não perder o evento.
    const waitReady = resetModuleReadyAndGetWaitPromise(35_000);
    showPrescription();
    await waitReady;
  } else {
    // Primeira prescrição — SDK pode estar pronto ou ainda carregando.
    // waitForMemedModuleReady() resolve imediatamente se já pronto, aguarda caso contrário.
    showPrescription();
    await Promise.race([
      waitForMemedModuleReady(),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error('Timeout 35000ms aguardando init do módulo Memed (primeira prescrição)')),
          35_000,
        ),
      ),
    ]);
  }

  pushDiagnosticEvent('postShow:ready', { isSubsequent, iframes: captureIframeState() });

  // 2. Criar contexto limpo (garante que não há contexto obsoleto de sessão anterior).
  //    Falha imediatamente se iframes ainda não respondem — não há fallback.
  try {
    await sendNewPrescriptionWithDiagnostic();
  } catch (err) {
    pushDiagnosticEvent('afterNewPrescription', { newPrescriptionOk: false, iframes: captureIframeState() });
    throw err;
  }
  pushDiagnosticEvent('afterNewPrescription', { newPrescriptionOk: true, iframes: captureIframeState() });

  // 3. Setar paciente e medicamentos no contexto recém-criado.
  await setMemedPatient(resolvedPatient);

  const { added, memed_items_sent, pending_medical_review, pending_reasons } =
    await addMedicationsFromAtendimento(atendimento);
  await setClinicalOrientations(atendimento);

  markPrescriptionShownOnce();

  return {
    medCount: added,
    memed_items_sent,
    pending_medical_review,
    pending_reasons,
  };
}
