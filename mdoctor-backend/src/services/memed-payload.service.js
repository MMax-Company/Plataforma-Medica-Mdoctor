const { compactWhitespace, digitsOnly } = require('./typebot-validation.utils');
const {
  isInvalidClinicalValue,
  sanitizeMedications,
  normalizeStructuredAddress,
  validateStructuredAddress
} = require('./typebot-clinical-data.validation');

const TREATMENT_DAYS = 60;
const MEMED_UNIT = 'comprimidos';

function normalizeTelefone(value = '') {
  let digits = digitsOnly(value);
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  if (digits.length >= 10 && digits.length <= 11) return digits;
  return undefined;
}

function normalizeBirthDate(value = '') {
  const raw = compactWhitespace(value);
  if (!raw) return undefined;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return raw;
}

/** Doses por dia — usa heurística; não altera o texto de frequência persistido. */
function dailyDosesFromFrequency(frequency = '') {
  const f = compactWhitespace(frequency).toLowerCase();
  if (f.includes('3x') || f.includes('8/8') || f.includes('8 em 8') || f.includes('8h')) return 3;
  if (f.includes('2x') || f.includes('12/12') || f.includes('12 em 12') || f.includes('12h')) return 2;
  return 1;
}

function quantityForFrequency(frequency = '') {
  return dailyDosesFromFrequency(frequency) * TREATMENT_DAYS;
}

function buildMedicationLabel(med = {}) {
  const name = compactWhitespace(med.name);
  const dose = compactWhitespace(med.dose);
  const unit = compactWhitespace(med.unit || 'mg') || 'mg';
  if (!dose) return name;
  const doseToken = `${dose} ${unit}`.toLowerCase();
  if (name.toLowerCase().includes(doseToken)) return name;
  return `${name} ${dose} ${unit}`.trim();
}

function buildPosologia(med = {}) {
  const frequency = compactWhitespace(med.frequency);
  const route = compactWhitespace(med.route || 'oral');
  const dose = compactWhitespace(med.dose);
  const unit = compactWhitespace(med.unit || 'mg') || 'mg';
  const via =
    route.toLowerCase() === 'oral' || route.toLowerCase().includes('oral')
      ? 'via oral'
      : `via ${route}`;

  if (med.posology && !isInvalidClinicalValue(med.posology)) {
    return compactWhitespace(med.posology);
  }

  const doseHint = dose ? ` (${dose}${unit})` : '';
  return `Tomar 1 comprimido por ${via}, ${frequency}${doseHint}. Tratamento por ${TREATMENT_DAYS} dias.`;
}

function extractMedicationRows(clinical = {}) {
  const rawList = Array.isArray(clinical.medications) ? clinical.medications : [];
  const mapped = rawList.map((row) => ({
    name: row.name || row.nome,
    dose: row.dose,
    unit: row.unit,
    frequency: row.frequency,
    route: row.route,
    posology: row.posology
  }));
  const declared = Number(clinical.medication_count);
  const { medications, medication_count, countMismatch } = sanitizeMedications(
    mapped,
    Number.isFinite(declared) && declared > 0 ? declared : null
  );
  return { medications, medication_count, countMismatch };
}

function resolveStructuredAddress(clinical = {}, atendimento = {}) {
  const structuredFromDb = clinical.address_structured || {};
  const merged = normalizeStructuredAddress({
    ...clinical,
    ...structuredFromDb,
    endereco_rua: structuredFromDb.rua || clinical.endereco_rua,
    endereco_numero: structuredFromDb.numero || clinical.endereco_numero,
    endereco_bairro: structuredFromDb.bairro || clinical.endereco_bairro,
    endereco_cidade: structuredFromDb.cidade || clinical.endereco_cidade,
    endereco_estado: structuredFromDb.estado || clinical.endereco_estado,
    cep: atendimento.paciente_cep || clinical.cep
  });

  const validation = validateStructuredAddress(
    merged?.formatted || clinical.address || '',
    atendimento.paciente_cep || clinical.cep
  );

  if (!validation.valid) {
    const err = new Error(validation.error || 'Endereço incompleto para payload Memed');
    err.code = 'MEMED_PAYLOAD_ADDRESS_INCOMPLETE';
    throw err;
  }

  return validation.structured;
}

function buildSetPacientePayload(atendimento = {}) {
  const clinical = atendimento.dados_clinicos || {};
  const address = resolveStructuredAddress(clinical, atendimento);
  const cpf = digitsOnly(atendimento.paciente_cpf || clinical.cpf || '');
  const telefone = normalizeTelefone(atendimento.paciente_telefone || clinical.phone || '');

  const payload = {
    idExterno: atendimento.id,
    nome: compactWhitespace(
      atendimento.paciente_nome || clinical.name || clinical.patient_name || 'Paciente'
    ),
    rua: address.rua,
    numero: address.numero,
    bairro: address.bairro,
    cidade: address.cidade,
    estado: address.estado,
    cep: address.cep || digitsOnly(clinical.cep || '')
  };

  if (telefone) payload.telefone = telefone;
  if (cpf.length === 11) payload.cpf = cpf;
  const email = compactWhitespace(atendimento.paciente_email || clinical.email || '');
  if (email) payload.email = email;

  const birth = normalizeBirthDate(clinical.data_nascimento || clinical.birth_date || '');
  if (birth) payload.data_nascimento = birth;

  return payload;
}

function buildAddItemPayload(med = {}) {
  const name = compactWhitespace(med.name);
  const dose = compactWhitespace(med.dose);
  const unit = compactWhitespace(med.unit || 'mg') || 'mg';
  const frequency = compactWhitespace(med.frequency);
  const route = compactWhitespace(med.route || 'oral');

  if (
    isInvalidClinicalValue(name) ||
    isInvalidClinicalValue(dose) ||
    isInvalidClinicalValue(frequency) ||
    isInvalidClinicalValue(route)
  ) {
    const err = new Error('Medicamento incompleto ou com placeholder para payload Memed');
    err.code = 'MEMED_PAYLOAD_MEDICATION_INVALID';
    throw err;
  }

  const quantidade = quantityForFrequency(frequency);

  return {
    medicamento: name,
    dose,
    unit,
    frequencia: frequency,
    via: route,
    nome: buildMedicationLabel(med),
    posologia: buildPosologia(med),
    quantidade,
    unidade: MEMED_UNIT,
    duracao_dias: TREATMENT_DAYS
  };
}

/**
 * Monta payload Memed (setPaciente + addItems) a partir do atendimento persistido.
 * Não emite nem assina receita — apenas preparação/validação.
 */
function buildMemedPayloadFromAtendimento(atendimento = {}) {
  const clinical = atendimento.dados_clinicos || {};
  const { medications, medication_count, countMismatch } = extractMedicationRows(clinical);

  if (!medications.length) {
    const err = new Error('Nenhum medicamento válido para payload Memed');
    err.code = 'MEMED_PAYLOAD_NO_MEDICATIONS';
    throw err;
  }

  if (countMismatch) {
    const err = new Error('medication_count não corresponde aos medicamentos preenchidos');
    err.code = 'MEMED_PAYLOAD_COUNT_MISMATCH';
    throw err;
  }

  const setPaciente = buildSetPacientePayload(atendimento);
  const addItems = medications.map(buildAddItemPayload);

  return {
    atendimento_id: atendimento.id,
    treatment_days: TREATMENT_DAYS,
    medication_count,
    setPaciente,
    addItems,
    preview_only: true
  };
}

module.exports = {
  TREATMENT_DAYS,
  MEMED_UNIT,
  dailyDosesFromFrequency,
  quantityForFrequency,
  buildMemedPayloadFromAtendimento,
  buildSetPacientePayload,
  buildAddItemPayload
};
