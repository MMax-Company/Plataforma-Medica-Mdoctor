import { addMedicationsFromAtendimento } from './addMedicationsFromAtendimento';
import { setClinicalOrientations } from './setClinicalOrientations';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';
import { buildPatientFromAtendimento } from './buildPatientFromAtendimento';
import type { MemedPrescriptionItem } from './clinicalPrescription.types';
import { clearMemedDiagnosticLog, sendNewPrescriptionWithDiagnostic } from './memedCommandDiagnostic';
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
 * Ordem: newPrescription → setPaciente → addItem → orientações → show.
 *
 * Motivo: o MdHub.command.send('setPaciente') resolve quando o SDK recebe o comando,
 * mas o paciente só é registrado no contexto da prescrição depois que o sherlock-api
 * conclui o lookup/criação (processo assíncrono). Se newPrescription for chamado
 * APÓS setPaciente, ele reseta o contexto enquanto o sherlock-api ainda processa —
 * o widget abre com "Digite o nome do paciente".
 *
 * Ao chamar newPrescription PRIMEIRO (contexto criado), e setPaciente DEPOIS
 * (paciente inserido no contexto estável), a race condition é eliminada.
 */
export async function prepareAndShowPrescription(
  atendimento: AtendimentoForMemed,
  patient?: MemedPatient | null,
): Promise<PreparePrescriptionResult> {
  clearMemedDiagnosticLog();

  const resolvedPatient = patient || buildPatientFromAtendimento(atendimento);

  // 1. Criar contexto da prescrição ANTES de setar o paciente.
  try {
    await sendNewPrescriptionWithDiagnostic();
  } catch {
    // contexto pode já existir de tentativa anterior — continua
  }

  // 2. Setar paciente no contexto estável (sem risco de ser sobrescrito por newPrescription).
  await setMemedPatient(resolvedPatient);

  // 3. Medicamentos + orientações (newPrescription interno falha silenciosamente — contexto já existe).
  const { added, memed_items_sent, pending_medical_review, pending_reasons } =
    await addMedicationsFromAtendimento(atendimento);
  await setClinicalOrientations(atendimento);

  await new Promise((r) => setTimeout(r, 500));

  showPrescription();
  return {
    medCount: added,
    memed_items_sent,
    pending_medical_review,
    pending_reasons,
  };
}
