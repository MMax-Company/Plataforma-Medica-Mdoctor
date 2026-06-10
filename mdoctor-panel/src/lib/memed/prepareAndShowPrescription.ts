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
import { markPrescriptionShownOnce, resetModuleReadyAndGetWaitPromise } from './memedRuntime';
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
 * Sequência única para TODOS os pacientes (primeiro e subsequentes):
 *
 *   show() → waitCoreModuleInit → newPrescription → setPaciente → addItem → orientações
 *
 * Causa raiz: os iframes do módulo plataforma.prescricao só existem após module.show() ser
 * chamado. Sem iframes, MdHub.command.send enfileira mensagens que nunca são processadas —
 * causando timeout em newPrescription (15s) e setPaciente (12-42s).
 *
 * show() cria os iframes (Patient 1, primeira abertura) ou os recria (Patient 2+, após
 * hide() ter removido do DOM). Em ambos os casos, o SDK dispara core:moduleInit quando
 * os iframes completam o carregamento. Aguardar core:moduleInit antes de qualquer comando
 * garante que os iframes existem e o módulo está pronto para receber comandos.
 *
 * Regra: nenhum comando (newPrescription, setPaciente, addItem) é chamado antes da
 * confirmação de core:moduleInit pós-show().
 */
export async function prepareAndShowPrescription(
  atendimento: AtendimentoForMemed,
  patient?: MemedPatient | null,
): Promise<PreparePrescriptionResult> {
  clearMemedDiagnosticLog();

  const resolvedPatient = patient || buildPatientFromAtendimento(atendimento);

  pushDiagnosticEvent('prepareStart', {
    patientId: resolvedPatient.idExterno,
    iframes: captureIframeState(),
  });

  // 1. Garantir iframes presentes — resetar flag ANTES de show() para não perder o evento.
  pushDiagnosticEvent('preShow', { iframes: captureIframeState() });
  const waitReady = resetModuleReadyAndGetWaitPromise(35_000);
  showPrescription();
  await waitReady;
  pushDiagnosticEvent('postShow:ready', { iframes: captureIframeState() });

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
