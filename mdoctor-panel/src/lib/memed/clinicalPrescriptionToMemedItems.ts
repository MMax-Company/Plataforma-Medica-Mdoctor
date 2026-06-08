import type {
  ClinicalPrescriptionItem,
  ClinicalPrescriptionToMemedResult,
  MemedPrescriptionItem,
} from './clinicalPrescription.types';

/** Protocolo Fase 1 — defaults clínicos quando triagem não traz campo completo. */
const FASE1_PROTOCOL_DEFAULTS: Record<
  string,
  Pick<
    ClinicalPrescriptionItem,
    'forma' | 'via' | 'dose' | 'frequencia' | 'duracao' | 'uso_continuo' | 'quantidade_sugerida' | 'observacao_clinica'
  >
> = {
  losartana: {
    forma: 'comprimido',
    via: 'oral',
    dose: '1 comprimido',
    frequencia: '24/24h',
    duracao: 'uso contínuo',
    uso_continuo: true,
    quantidade_sugerida: 30,
  },
  metformina: {
    forma: 'comprimido',
    via: 'oral',
    dose: '1 comprimido',
    frequencia: '12/12h',
    duracao: 'uso contínuo',
    uso_continuo: true,
    quantidade_sugerida: 60,
  },
  levotiroxina: {
    forma: 'comprimido',
    via: 'oral',
    dose: '1 comprimido',
    frequencia: '24/24h',
    duracao: 'uso contínuo',
    uso_continuo: true,
    quantidade_sugerida: 30,
    observacao_clinica: 'Tomar em jejum.',
  },
  sinvastatina: {
    forma: 'comprimido',
    via: 'oral',
    dose: '1 comprimido',
    frequencia: '24/24h',
    duracao: 'uso contínuo',
    uso_continuo: true,
    quantidade_sugerida: 30,
    observacao_clinica: 'Preferencialmente à noite.',
  },
  rosuvastatina: {
    forma: 'comprimido',
    via: 'oral',
    dose: '1 comprimido',
    frequencia: '24/24h',
    duracao: 'uso contínuo',
    uso_continuo: true,
    quantidade_sugerida: 30,
    observacao_clinica: 'Preferencialmente à noite.',
  },
};

const ESSENTIAL_FIELDS: Array<keyof ClinicalPrescriptionItem> = [
  'medicamento',
  'concentracao',
  'forma',
  'via',
  'dose',
  'frequencia',
];

function normalizeKey(value?: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function capitalizeName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function parseConcentracaoFromText(text: string): string | undefined {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(mg|g|ml|mcg|ui|%)?/i);
  if (!match) return undefined;
  const amount = match[1].replace(',', '.');
  const unit = (match[2] || 'mg').toLowerCase();
  return `${amount}${unit}`;
}

function mapFrequencyLabel(frequency?: string): string {
  const f = normalizeKey(frequency);
  if (!f) return 'conforme orientação médica';
  if (f.includes('12/12') || f.includes('12h')) return 'a cada 12 horas';
  if (f.includes('8/8') || f.includes('8h')) return 'a cada 8 horas';
  if (f.includes('24/24') || f === '24h' || f.includes('1x') || f.includes('ao dia')) return 'a cada 24 horas';
  if (f.includes('noite')) return '1 vez ao dia (à noite)';
  if (f.includes('jejum')) return '1 vez ao dia (em jejum)';
  return frequency || 'conforme orientação médica';
}

function mapViaLabel(via?: string): string {
  const v = normalizeKey(via);
  if (v === 'oral') return 'por via oral';
  if (v.includes('subling')) return 'por via sublingual';
  if (v.includes('inal')) return 'por via inalatória';
  if (v.includes('top')) return 'por via tópica';
  if (v.includes('injet')) return 'por via injetável';
  if (!v) return 'conforme orientação médica';
  return `por via ${via}`;
}

function buildMemedNome(item: ClinicalPrescriptionItem): string {
  const med = capitalizeName(item.medicamento);
  const conc = String(item.concentracao || '').trim();
  if (!conc) return med;
  const medLower = med.toLowerCase();
  if (medLower.includes(conc.toLowerCase())) return med;
  return `${med} ${conc}`.trim();
}

function buildMemedPosologia(item: ClinicalPrescriptionItem): string {
  const dose = String(item.dose || '1 comprimido').trim();
  const via = mapViaLabel(item.via);
  const freq = mapFrequencyLabel(item.frequencia);
  const parts = [`Tomar ${dose} ${via} ${freq}.`.replace(/\s+/g, ' ')];

  const duracao = String(item.duracao || '').trim();
  if (item.uso_continuo || normalizeKey(duracao).includes('continuo')) {
    parts.push('Uso contínuo.');
  } else if (duracao) {
    parts.push(`${duracao.charAt(0).toUpperCase()}${duracao.slice(1)}.`);
  }

  const obs = String(item.observacao_clinica || '').trim();
  if (obs) parts.push(obs.endsWith('.') ? obs : `${obs}.`);

  return parts.join(' ');
}

function resolveFase1Defaults(medicamento: string): Partial<ClinicalPrescriptionItem> {
  const key = normalizeKey(medicamento);
  for (const [protocolKey, defaults] of Object.entries(FASE1_PROTOCOL_DEFAULTS)) {
    if (key.includes(protocolKey)) return defaults;
  }
  return {};
}

function validateClinicalItem(item: ClinicalPrescriptionItem): string[] {
  const reasons: string[] = [];
  for (const field of ESSENTIAL_FIELDS) {
    const value = item[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      reasons.push(`Campo essencial ausente: ${field}`);
    }
  }
  return reasons;
}

function enrichClinicalItem(raw: ClinicalPrescriptionItem): ClinicalPrescriptionItem {
  const medicamento = capitalizeName(raw.medicamento || '');
  const defaults = resolveFase1Defaults(medicamento);
  const concentracao =
    raw.concentracao ||
    parseConcentracaoFromText(`${medicamento} ${raw.concentracao || ''}`) ||
    parseConcentracaoFromText(String(raw.dose || ''));

  const merged: ClinicalPrescriptionItem = {
    ...defaults,
    ...raw,
    medicamento,
    concentracao: concentracao || raw.concentracao,
    forma: raw.forma || defaults.forma || 'comprimido',
    via: raw.via || defaults.via || 'oral',
    dose: raw.dose || defaults.dose || '1 comprimido',
    frequencia: raw.frequencia || defaults.frequencia || '24/24h',
    duracao: raw.duracao || defaults.duracao,
    uso_continuo: raw.uso_continuo ?? defaults.uso_continuo ?? false,
    quantidade_sugerida: raw.quantidade_sugerida ?? defaults.quantidade_sugerida ?? null,
  };

  const pendingReasons = validateClinicalItem(merged);
  return {
    ...merged,
    pendente_revisao_medica: pendingReasons.length > 0,
    pendente_motivos: pendingReasons,
  };
}

/**
 * Converte prescrição clínica estruturada → itens compatíveis com MdHub `addItem`.
 * Envia somente `nome`, `posologia` e `quantidade` (quando aplicável).
 */
export function clinicalPrescriptionToMemedItems(
  clinicalItems: ClinicalPrescriptionItem[],
): ClinicalPrescriptionToMemedResult {
  const clinical_items = clinicalItems.map(enrichClinicalItem);
  const pending_reasons = clinical_items.flatMap((item) => item.pendente_motivos || []);
  const pending_medical_review = clinical_items.some((item) => item.pendente_revisao_medica);

  const memed_items: MemedPrescriptionItem[] = clinical_items
    .filter((item) => !item.pendente_revisao_medica)
    .map((item) => {
      const payload: MemedPrescriptionItem = {
        nome: buildMemedNome(item),
        posologia: buildMemedPosologia(item),
      };
      const qty = item.quantidade_sugerida;
      if (typeof qty === 'number' && qty > 0) payload.quantidade = qty;
      return payload;
    });

  return {
    clinical_items,
    memed_items,
    pending_medical_review,
    pending_reasons,
  };
}

export { FASE1_PROTOCOL_DEFAULTS, buildMemedNome, buildMemedPosologia };
