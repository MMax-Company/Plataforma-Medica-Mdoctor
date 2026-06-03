import { PRESCRIPTION_MODULE } from './onLoadPrescription';
import type { AtendimentoForMemed } from './buildPatientFromAtendimento';

type MedicationRow = {
  name?: string;
  nome?: string;
  dose?: string;
  posology?: string;
  raw_text?: string;
  label?: string;
  frequency?: string;
};

/** Pré-carrega itens via addItem antes de abrir o módulo (doc Memed MdHub). */
export async function addMedicationsFromAtendimento(atendimento: AtendimentoForMemed): Promise<number> {
  if (!window.MdHub?.command?.send) return 0;

  const clinical = (atendimento.dados_clinicos || {}) as Record<string, unknown>;
  const list = (clinical.medications as MedicationRow[] | undefined) || [];
  const fallbackName =
    String(clinical.medicacao_em_uso || clinical.medication || atendimento.medicacao_em_uso || '').trim();

  const items: MedicationRow[] =
    list.length > 0
      ? list
      : fallbackName
        ? [{ name: fallbackName, raw_text: fallbackName, posology: String(clinical.posology || '') }]
        : [];

  let added = 0;
  for (const med of items) {
    const nome = String(med.name || med.nome || med.raw_text || med.label || '').trim();
    if (!nome) continue;

    const posologia = String(med.posology || med.label || med.raw_text || '').trim();
    const dose = String(med.dose || '').trim();

    try {
      await window.MdHub.command.send(PRESCRIPTION_MODULE, 'addItem', {
        nome,
        ...(dose ? { dose } : {}),
        ...(posologia ? { posologia } : {}),
      });
      added += 1;
    } catch {
      // item pode já existir ou exigir busca — não bloqueia o fluxo
    }
  }

  return added;
}
