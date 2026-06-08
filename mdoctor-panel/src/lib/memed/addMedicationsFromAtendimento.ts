import { buildMemedItemsFromAtendimento } from './buildClinicalPrescriptionFromAtendimento';
import type { MemedPrescriptionItem } from './clinicalPrescription.types';
import { sendAddItemWithDiagnostic, sendNewPrescriptionWithDiagnostic } from './memedCommandDiagnostic';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';

export type AddMedicationsResult = {
  added: number;
  memed_items_sent: MemedPrescriptionItem[];
  pending_medical_review: boolean;
  pending_reasons: string[];
};

/** Pré-carrega itens via newPrescription + addItem (somente nome/posologia/quantidade). */
export async function addMedicationsFromAtendimento(
  atendimento: AtendimentoForMemed,
): Promise<AddMedicationsResult> {
  if (!window.MdHub?.command?.send) {
    return { added: 0, memed_items_sent: [], pending_medical_review: false, pending_reasons: [] };
  }

  const { memed_items, pending_medical_review, pending_reasons } = buildMemedItemsFromAtendimento(atendimento);

  if (memed_items.length === 0) {
    return {
      added: 0,
      memed_items_sent: [],
      pending_medical_review,
      pending_reasons,
    };
  }

  try {
    await sendNewPrescriptionWithDiagnostic();
  } catch {
    // módulo pode já estar em prescrição nova — não bloqueia
  }

  let added = 0;
  const memed_items_sent: MemedPrescriptionItem[] = [];

  for (const item of memed_items) {
    const payload: MemedPrescriptionItem = {
      nome: item.nome,
      posologia: item.posologia,
    };
    if (typeof item.quantidade === 'number' && item.quantidade > 0) {
      payload.quantidade = item.quantidade;
    }

    try {
      await sendAddItemWithDiagnostic(payload as Record<string, unknown>);
      added += 1;
      memed_items_sent.push(payload);
    } catch {
      // item pode exigir seleção manual no catálogo — não bloqueia abertura do widget
    }
  }

  return {
    added,
    memed_items_sent,
    pending_medical_review,
    pending_reasons,
  };
}
