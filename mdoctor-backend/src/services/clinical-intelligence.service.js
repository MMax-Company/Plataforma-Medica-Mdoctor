const PROTOCOL_VERSION = 'staging-clinical-v1';

const CONDITIONS = {
  HAS: 'hipertensao',
  DM2: 'diabetes_tipo_2',
  DLP: 'dislipidemia',
  HIPO: 'hipotireoidismo'
};

const CONDITION_ALIASES = [
  { value: CONDITIONS.HAS, terms: ['has', 'hipertensao', 'hipertensão', 'pressao alta', 'pressão alta'] },
  { value: CONDITIONS.DM2, terms: ['dm', 'dm2', 'diabetes', 'diabetes tipo 2', 'glicose alta'] },
  { value: CONDITIONS.DLP, terms: ['dlp', 'dislipidemia', 'colesterol', 'triglicerides', 'triglicerídeos'] },
  { value: CONDITIONS.HIPO, terms: ['hipotireoidismo', 'tireoide', 'tiroide', 'levotiroxina'] }
];

const FLAG_LABELS = {
  sintomas_novos: 'Sinais ou sintomas novos não avaliados presencialmente',
  diagnostico_recente: 'Diagnóstico recente sem estabilização clínica',
  sem_comprovacao: 'Ausência de comprovação de receita prévia/uso contínuo',
  crise_clinica: 'Relato de crise clínica aguda',
  internacao_recente: 'Internação recente',
  receita_muito_antiga: 'Receita anterior fora da janela segura',
  sinais_urgencia: 'Sinais de urgência/emergência',
  contraindicacao_basica: 'Possível contraindicação básica para renovação remota'
};

const REFUSAL_LIBRARY = {
  sinais_alarme: 'Renovação não autorizada. Há sinais de alerta clínico e o caso exige avaliação presencial imediata.',
  consulta_presencial:
    'Renovação não autorizada neste momento. Recomendamos consulta presencial para reavaliação clínica e segurança do paciente.',
  documentacao_insuficiente:
    'Renovação não autorizada por documentação insuficiente (receita anterior/uso contínuo). Envie os dados faltantes para nova análise.',
  medicacao_incompativel:
    'Renovação não autorizada devido a possível incompatibilidade medicamentosa ou condição associada sem validação médica recente.',
  renovacao_insegura:
    'Renovação não autorizada. No cenário atual, a renovação remota é considerada clinicamente insegura.'
};

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeCondition(value = '') {
  const normalized = normalizeText(value);
  const matched = CONDITION_ALIASES.find((item) => item.terms.some((term) => normalized.includes(normalizeText(term))));
  return matched ? matched.value : 'renovacao_receita';
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function extractUsageDays(data = {}) {
  const direct = toNumber(
    data.continuous_use_days || data.tempo_uso_dias || data.tempoUsoDias || data.usage_days
  );
  if (direct !== null) return direct;

  const text = normalizeText(data.tempo_uso || data.tempoUso || data.notes || '');
  if (!text) return null;
  if (text.includes('mais de 6')) return 180;
  if (text.includes('1 a 6') || text.includes('1-6')) return 60;
  if (text.includes('menos de 1')) return 15;
  return null;
}

function normalizeBirthDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 8) {
    const day = digits.slice(0, 2);
    const month = digits.slice(2, 4);
    const year = digits.slice(4, 8);
    const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
    if (!Number.isNaN(date.getTime()) && Number(day) <= 31 && Number(month) <= 12) {
      return `${year}-${month}-${day}`;
    }
  }

  const slashMatch = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (slashMatch) {
    const day = String(slashMatch[1]).padStart(2, '0');
    const month = String(slashMatch[2]).padStart(2, '0');
    const year = slashMatch[3];
    const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
    if (!Number.isNaN(date.getTime())) return `${year}-${month}-${day}`;
  }

  return null;
}

const CONTROLLED_MEDICATION_TERMS = [
  'rivotril',
  'clonazepam',
  'diazepam',
  'alprazolam',
  'lorazepam',
  'zolpidem',
  'tramadol',
  'codeina',
  'morfina',
  'oxycodona',
  'fentanil',
  'ritalina',
  'metilfenidato',
  'lisdexanfetamina',
  'anfetamina',
  'pregabalina',
  'gabapentina controlada',
  'testosterona',
  'anabolizante'
];

function hasControlledMedication(medications = [], primaryMedication = '') {
  const labels = [
    ...medications.map((item) => `${item.name || ''} ${item.dose || ''} ${item.label || ''}`),
    primaryMedication
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean);

  return labels.some((label) => CONTROLLED_MEDICATION_TERMS.some((term) => label.includes(normalizeText(term))));
}

function parseMedicationsFromPayload(payload = {}) {
  if (Array.isArray(payload.medications)) {
    return payload.medications.map((item, index) => ({
      index: index + 1,
      name: item.name || item.medication_name || item.nome || '',
      dose: item.dose || item.medication_dose || '',
      frequency: item.frequency || item.medication_frequency || '',
      route: item.route || item.medication_route || 'oral',
      continuous: item.continuous !== false
    }));
  }

  const slots = [
    {
      name: payload.medication_1_name || payload.med1_nome,
      dose: payload.medication_1_dose || payload.med1_dose,
      frequency: payload.medication_1_frequency || payload.med1_frequencia,
      route: payload.medication_1_route || payload.med1_via || 'oral',
      label: payload.primeiro_medicamento
    },
    {
      name: payload.medication_2_name || payload.med2_nome,
      dose: payload.medication_2_dose || payload.med2_dose,
      frequency: payload.medication_2_frequency || payload.med2_frequencia,
      route: payload.medication_2_route || payload.med2_via || 'oral',
      label: payload.segundo_medicamento
    },
    {
      name: payload.medication_3_name || payload.med3_nome,
      dose: payload.medication_3_dose || payload.med3_dose,
      frequency: payload.medication_3_frequency || payload.med3_frequencia,
      route: payload.medication_3_route || payload.med3_via || 'oral',
      label: payload.terceiro_medicamento
    }
  ];

  const count = Number(payload.medication_count || payload.qtd_medicamentos || 0) || slots.filter((s) => s.label || s.name).length;

  return slots
    .slice(0, count || slots.length)
    .map((slot, index) => {
      const label = String(slot.label || '').trim();
      const parsedFromLabel = label.split(',').map((part) => part.trim());
      return {
        index: index + 1,
        name: slot.name || parsedFromLabel[0] || label,
        dose: slot.dose || parsedFromLabel[1] || '',
        frequency: slot.frequency || parsedFromLabel[2] || '',
        route: slot.route || 'oral',
        continuous: true,
        label
      };
    })
    .filter((item) => item.name);
}

function mapTypebotWarningFlags(sinaisAlerta = '', extra = '') {
  const normalized = normalizeText(`${sinaisAlerta || ''} ${extra || ''}`).trim();
  const flags = [];
  if (!normalized || normalized.includes('nenhuma') || normalized === 'nao' || normalized === 'não') return flags;
  if (normalized.includes('dor no peito')) flags.push('sinais_urgencia');
  if (normalized.includes('falta de ar')) flags.push('sinais_urgencia');
  if (normalized.includes('desmaio')) flags.push('sinais_urgencia');
  if (normalized.includes('confusao') || normalized.includes('confusão')) flags.push('sinais_urgencia');
  if (normalized.includes('febre')) flags.push('crise_clinica');
  if (normalized.includes('sangramento')) flags.push('sinais_urgencia');
  if (normalized.includes('dor intensa')) flags.push('sintomas_novos');
  if (normalized.includes('hipertens') || normalized.includes('pressao')) flags.push('crise_clinica');
  if (normalized.includes('hipoglic') || normalized.includes('glicemia')) flags.push('crise_clinica');
  if (normalized.includes('piora')) flags.push('sintomas_novos');
  if (normalized.includes('gravidez')) flags.push('contraindicacao_basica');
  if (flags.length === 0 && !['nao', 'não', 'nao.', 'n'].includes(normalized)) flags.push('sinais_urgencia');
  return [...new Set(flags)];
}

function hasContinuousMedication(data = {}) {
  if (data.continuous_use_proof === true) return true;
  if (data.uso_continuo === true) return true;
  if (data.medicacao_continua === true) return true;
  const text = normalizeText(data.notes || data.text || '');
  return text.includes('uso continuo') || text.includes('uso continuo') || text.includes('uso diário') || text.includes('uso diario');
}

function hasPreviousPrescription(data = {}) {
  if (data.previous_prescription === true) return true;
  if (data.receita_anterior === true) return true;
  if (data.last_prescription === true) return true;
  if (data.has_previous_prescription === true) return true;
  const normalized = normalizeText(String(data.receita_anterior || data.has_previous_prescription || ''));
  if (normalized === 'sim') return true;
  if (normalized === 'nao' || normalized === 'não') return false;
  const text = normalizeText(data.notes || data.text || '');
  return text.includes('receita anterior') || text.includes('ultima receita') || text.includes('última receita') || text.includes('renovar receita');
}

function hasPrescriptionPhoto(data = {}) {
  const file = data.previous_prescription_file || data.foto_receita_url || data.prescription_photo_url;
  return Boolean(file && String(file).trim().length > 3);
}

function parseClinicalFlags(text = '') {
  const normalized = normalizeText(text);
  const flags = [];
  if (normalized.includes('sintoma novo') || normalized.includes('dor nova') || normalized.includes('piora recente')) flags.push('sintomas_novos');
  if (normalized.includes('interna') || normalized.includes('hospital')) flags.push('internacao_recente');
  if (normalized.includes('crise')) flags.push('crise_clinica');
  if (normalized.includes('urg') || normalized.includes('desmaio') || normalized.includes('dor no peito') || normalized.includes('falta de ar')) {
    flags.push('sinais_urgencia');
  }
  if (normalized.includes('diagnostico recente') || normalized.includes('diagnóstico recente')) flags.push('diagnostico_recente');
  if (normalized.includes('alergia grave') || normalized.includes('gestante') || normalized.includes('gravidez') || normalized.includes('contraindicacao')) {
    flags.push('contraindicacao_basica');
  }
  return [...new Set(flags)];
}

function buildCriteriaSummary(criteriaUsed = [], flags = []) {
  const criteria = [...criteriaUsed];
  if (flags.length) {
    criteria.push(...flags.map((flag) => FLAG_LABELS[flag] || flag));
  }
  return [...new Set(criteria)];
}

function getRefusalMessage(code = 'renovacao_insegura') {
  return REFUSAL_LIBRARY[code] || REFUSAL_LIBRARY.renovacao_insegura;
}

function variantIndex(seed = '') {
  const text = String(seed || 'default');
  return text.split('').reduce((acc, current) => acc + current.charCodeAt(0), 0) % 3;
}

function pickVariant(seed, variants) {
  return variants[variantIndex(seed)];
}

function buildClinicalNarrative(context = {}) {
  const condition = context.condition || 'condição crônica';
  const medication = context.medication || 'medicação em uso contínuo';
  const decision = context.decision || {};
  const rationale = decision.reason || 'Avaliação clínica em andamento.';
  const seed = `${context.patientName || ''}-${condition}-${medication}-${decision.reasonCode || ''}`;

  const chiefComplaint = pickVariant(seed, [
    `Paciente solicita renovação de ${medication} para controle de ${condition}, sem relato de piora aguda recente.`,
    `Solicitação de continuidade terapêutica para ${condition}, com foco em renovação de ${medication}.`,
    `Paciente em seguimento para ${condition}, buscando renovação de ${medication} dentro do protocolo de telemedicina.`
  ]);

  const clinicalHistory = pickVariant(seed, [
    `Histórico compatível com doença crônica estável. Dados de triagem sugerem manutenção terapêutica, condicionada à confirmação documental mínima.`,
    `Há relato de uso prévio do tratamento crônico. A elegibilidade remota depende da presença de receita anterior válida e ausência de red flags.`,
    `Triagem aponta cenário de renovação, porém a decisão clínica considera obrigatoriamente documentação de continuidade e sinais de segurança.`
  ]);

  const teleExam = pickVariant(seed, [
    'Atendimento em telemedicina assíncrona. Sem exame físico presencial nesta etapa; decisão baseada em dados declarados e critérios de segurança clínica.',
    'Exame físico remoto indireto, sem sinais objetivos disponíveis. Conduta limitada ao protocolo de renovação e triagem de risco.',
    'Sem avaliação física presencial. Foi aplicada triagem estruturada para detectar urgência, contraindicação básica e consistência terapêutica.'
  ]);

  const conduct = decision.eligible
    ? pickVariant(seed, [
        `Conduta: elegível para renovação conservadora de ${medication}, mantendo vigilância clínica e orientação para retorno presencial em caso de alarme.`,
        `Conduta: autorizar renovação em regime controlado, com reforço de adesão e alerta para procura presencial se houver piora.`,
        `Conduta: renovar terapêutica de forma protocolar, registrando critérios de segurança e orientação de monitoramento contínuo.`
      ])
    : pickVariant(seed, [
        `Conduta: renovação não autorizada nesta etapa. Motivo clínico principal: ${rationale}`,
        `Conduta: bloqueio de renovação remota por critério de segurança. Justificativa: ${rationale}`,
        `Conduta: recomendada reavaliação presencial antes de nova tentativa de renovação. Fundamentação: ${rationale}`
      ]);

  const guidance = decision.eligible
    ? 'Orientações: manter uso conforme prescrição vigente, observar sinais de alerta e procurar atendimento presencial se houver piora clínica.'
    : `${getRefusalMessage(decision.refusalCode)} Orientações: procurar avaliação presencial para conduta definitiva.`;

  return {
    summary: decision.eligible
      ? `Renovação remota considerada coerente para ${condition}, com critérios mínimos atendidos.`
      : `Renovação remota não segura para ${condition} no cenário atual.`,
    chiefComplaint,
    clinicalHistory,
    teleExam,
    conduct,
    guidance
  };
}

module.exports = {
  PROTOCOL_VERSION,
  CONDITIONS,
  FLAG_LABELS,
  REFUSAL_LIBRARY,
  normalizeCondition,
  normalizeBirthDate,
  extractUsageDays,
  hasContinuousMedication,
  hasPreviousPrescription,
  hasPrescriptionPhoto,
  parseClinicalFlags,
  parseMedicationsFromPayload,
  hasControlledMedication,
  mapTypebotWarningFlags,
  buildCriteriaSummary,
  getRefusalMessage,
  buildClinicalNarrative
};
