import { addMedicationsFromAtendimento } from './addMedicationsFromAtendimento';
import { setClinicalOrientations } from './setClinicalOrientations';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';
import { buildPatientFromAtendimento } from './buildPatientFromAtendimento';
import type { MemedPrescriptionItem } from './clinicalPrescription.types';
import { clearMemedDiagnosticLog, sendNewPrescriptionWithDiagnostic } from './memedCommandDiagnostic';
import {
  msUntilPostEmissionSettle,
  wasMemedPrescriptionEmittedThisSession,
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

// Janela de estabilização pós-emissão: patient-management reinicializa internamente após
// prescricaoImpressa. Chamar newPrescription/setPaciente antes deste prazo causa timeout.
const POST_EMISSION_SETTLE_MS = 15_000;
// Para prescrições subsequentes o ciclo de reset interno do SDK leva mais tempo.
const SUBSEQUENT_NEW_PRESCRIPTION_TIMEOUT_MS = 50_000;

/**
 * Ordem: newPrescription → setPaciente → addItem → orientações → show.
 *
 * Motivo: o MdHub.command.send('setPaciente') resolve quando o SDK recebe o comando,
 * mas o paciente só é registrado no contexto da prescrição depois que o sherlock-api
 * conclui o lookup/criação (processo assíncrono). Se newPrescription for chamado
 * APÓS setPaciente, ele reseta o contexto enquanto o sherlock-api ainda processa —
 * o widget abre com "Digite o nome do paciente".
 *
 * Para pacientes subsequentes (após primeira emissão): aguarda janela de estabilização
 * antes de enviar comandos. patient-management entra em ciclo de reset após prescricaoImpressa;
 * comandos enviados prematuramente ficam na fila e causam timeout de 42s em setPaciente.
 */
export async function prepareAndShowPrescription(
  atendimento: AtendimentoForMemed,
  patient?: MemedPatient | null,
): Promise<PreparePrescriptionResult> {
  clearMemedDiagnosticLog();

  // Aguarda estabilização do patient-management após emissão anterior.
  const settleMs = msUntilPostEmissionSettle(POST_EMISSION_SETTLE_MS);
  if (settleMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
  }

  const resolvedPatient = patient || buildPatientFromAtendimento(atendimento);

  // 1. Criar contexto da prescrição ANTES de setar o paciente.
  //    Timeout maior para chamadas subsequentes: ciclo de reset interno do SDK.
  const newPrescriptionTimeout = wasMemedPrescriptionEmittedThisSession()
    ? SUBSEQUENT_NEW_PRESCRIPTION_TIMEOUT_MS
    : undefined;
  try {
    await sendNewPrescriptionWithDiagnostic(newPrescriptionTimeout);
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
