import type { AtendimentoForMemed } from './buildPatientFromAtendimento';
import type { ClinicalPrescriptionItem } from './clinicalPrescription.types';
import { clinicalPrescriptionToMemedItems } from './clinicalPrescriptionToMemedItems';

type MedicationRow = {
  name?: string;
  nome?: string;
  dose?: string;
  unit?: string;
  frequency?: string;
  route?: string;
  continuous?: boolean;
  posology?: string;
  raw_text?: string;
  label?: string;
};

function capitalizeMedication(value?: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function parseConcentracao(dose?: string, unit?: string, raw?: string): string | undefined {
  const fromParts = [dose, unit].filter(Boolean).join('');
  if (fromParts) return fromParts.replace(/\s+/g, '');
  const match = String(raw || '').match(/(\d+(?:[.,]\d+)?)\s*(mg|g|ml|mcg|ui|%)?/i);
  if (!match) return undefined;
  return `${match[1].replace(',', '.')}${(match[2] || 'mg').toLowerCase()}`;
}

function mapRoute(route?: string): string {
  const r = String(route || '').toLowerCase();
  if (r.includes('subling')) return 'sublingual';
  if (r.includes('inal')) return 'inalatória';
  if (r.includes('injet')) return 'injetável';
  if (r.includes('top')) return 'tópica';
  return 'oral';
}

function mapFrequency(frequency?: string): string {
  const f = String(frequency || '').toLowerCase();
  if (f.includes('12/12') || f.includes('12h')) return '12/12h';
  if (f.includes('8/8') || f.includes('8h')) return '8/8h';
  if (f.includes('24') || f.includes('1x') || f.includes('ao dia')) return '24/24h';
  if (f.includes('noite')) return '24/24h';
  if (f.includes('jejum')) return '24/24h';
  return f || '24/24h';
}

function rowToClinicalItem(row: MedicationRow): ClinicalPrescriptionItem {
  const raw = String(row.label || row.raw_text || row.name || row.nome || '').trim();
  const medicamento = capitalizeMedication(row.name || row.nome || raw.split(/\d/)[0]);
  const concentracao = parseConcentracao(row.dose, row.unit, raw);

  return {
    medicamento,
    concentracao,
    forma: 'comprimido',
    via: mapRoute(row.route),
    dose: '1 comprimido',
    frequencia: mapFrequency(row.frequency),
    duracao: row.continuous ? 'uso contínuo' : undefined,
    uso_continuo: row.continuous ?? true,
    quantidade_sugerida: row.continuous === false ? 30 : 30,
    observacao_clinica: row.posology ? undefined : undefined,
  };
}

function freeTextToClinicalItem(text: string, clinical: Record<string, unknown>): ClinicalPrescriptionItem {
  const med1Dose = String(clinical.med1_dose || '').trim();
  return rowToClinicalItem({
    name: String(clinical.med1_nome || text.split(/\d/)[0] || text).trim(),
    dose: med1Dose.replace(/[^\d.,]/g, '') || undefined,
    unit: med1Dose.replace(/[\d.,\s]/g, '') || undefined,
    frequency: String(clinical.med1_frequencia || clinical.posology || '24h'),
    continuous: clinical.uso_continuo !== false,
    raw_text: text,
    label: text,
  });
}

/** Extrai camada clínica interna a partir do atendimento (triagem/prontuário). */
export function buildClinicalPrescriptionFromAtendimento(
  atendimento: AtendimentoForMemed,
): ClinicalPrescriptionItem[] {
  const clinical = (atendimento.dados_clinicos || {}) as Record<string, unknown>;
  const list = (clinical.medications as MedicationRow[] | undefined) || [];

  if (list.length > 0) {
    return list.map(rowToClinicalItem);
  }

  // Campos numerados: med1_nome/dose/frequencia/via, med2_*, med3_*
  // Suporta receitas com até 3 medicamentos sem depender de texto livre.
  const numberedItems: ClinicalPrescriptionItem[] = [];
  for (let i = 1; i <= 3; i++) {
    const nome = String(clinical[`med${i}_nome`] || '').trim();
    if (!nome) break;
    const rawDose = String(clinical[`med${i}_dose`] || '').trim();
    numberedItems.push(rowToClinicalItem({
      name: nome,
      dose: rawDose.replace(/[^\d.,]/g, '') || undefined,
      unit: rawDose.replace(/[\d.,\s]/g, '') || undefined,
      frequency: String(clinical[`med${i}_frequencia`] || '24h'),
      route: String(clinical[`med${i}_via`] || 'oral'),
      continuous: (clinical.uso_continuo as boolean | undefined) !== false,
    }));
  }
  if (numberedItems.length > 0) return numberedItems;

  // Fallback de texto livre (compatibilidade com dados antigos sem campos numerados).
  const fallback = String(
    clinical.medicacao_em_uso || clinical.medication || atendimento.medicacao_em_uso || '',
  ).trim();
  if (!fallback) return [];

  return [freeTextToClinicalItem(fallback, clinical)];
}

/** Atalho: atendimento → resultado Memed pronto para addItem. */
export function buildMemedItemsFromAtendimento(atendimento: AtendimentoForMemed) {
  const clinicalItems = buildClinicalPrescriptionFromAtendimento(atendimento);
  return clinicalPrescriptionToMemedItems(clinicalItems);
}
