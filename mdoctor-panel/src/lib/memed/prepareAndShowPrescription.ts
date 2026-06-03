import { addMedicationsFromAtendimento } from './addMedicationsFromAtendimento';
import { applyClinicalMemedUx } from './applyClinicalUx';
import { setClinicalOrientations } from './setClinicalOrientations';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';
import { buildPatientFromAtendimento } from './buildPatientFromAtendimento';
import { setMemedPatient } from './setMemedPatient';
import { showPrescription } from './showPrescription';
import type { MemedPatient } from './types';

/** Ordem oficial: setPaciente → addItem → toggles → (delay) → show */
export async function prepareAndShowPrescription(
  atendimento: AtendimentoForMemed,
  patient?: MemedPatient | null,
): Promise<{ medCount: number }> {
  const resolvedPatient = patient || buildPatientFromAtendimento(atendimento);

  await setMemedPatient(resolvedPatient);
  const medCount = await addMedicationsFromAtendimento(atendimento);
  await setClinicalOrientations(atendimento);
  await applyClinicalMemedUx();

  await new Promise((r) => setTimeout(r, 80));

  showPrescription();
  return { medCount };
}
