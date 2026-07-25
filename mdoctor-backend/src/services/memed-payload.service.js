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

/**
 * Doses por dia — usa heurística; não altera o texto de frequência persistido.
 * Reconhece tanto os códigos normalizados ('12/12h', '8/8h') quanto o texto
 * bruto das opções do chatbot ("Duas vezes ao dia", "Três vezes ao dia"),
 * para a quantidade escalar corretamente mesmo com dados legados que não
 * passaram pela normalização.
 */
function dailyDosesFromFrequency(frequency = '') {
  const f = compactWhitespace(frequency).toLowerCase();
  if (f.includes('3x') || f.includes('8/8') || f.includes('8 em 8') || f.includes('8h') || f.includes('tres vezes') || f.includes('três vezes')) return 3;
  if (f.includes('2x') || f.includes('12/12') || f.includes('12 em 12') || f.includes('12h') || f.includes('duas vezes')) return 2;
  if (f.includes('1x') || f.includes('24/24') || f.includes('24h') || f.includes('1 vez') || f.includes('uma vez')) return 1;
  return 1;
}

const BLOCKED_MEMED_UNITS = new Set(['embalagem', 'embalagens', 'caixa', 'caixas', 'frasco', 'frascos']);

function quantityForFrequency(frequency = '') {
  return dailyDosesFromFrequency(frequency) * TREATMENT_DAYS;
}

function buildMedicationLabel(med = {}) {
  const name = compactWhitespace(med.name);
  const dose = compactWhitespace(med.dose);
  const unit = compactWhitespace(med.unit || 'mg') || 'mg';
  if (!dose) return name;
  // O nome pode já trazer a concentração embutida, com ou sem unidade/espaço
  // (ex.: "Hidroclorotiazida 25 mg", "Hidroclorotiazida 25mg" ou só "Captopril 25").
  // Extrai o primeiro número do nome e compara com a dose estruturada para não
  // duplicar a concentração no medicamento enviado à Memed.
  const nameConcMatch = name.match(/(\d+(?:[.,]\d+)?)/);
  const doseNormalized = dose.replace(',', '.');
  if (nameConcMatch && nameConcMatch[1].replace(',', '.') === doseNormalized) {
    return name;
  }
  return `${name} ${dose} ${unit}`.trim();
}

// Posologia compatível com a Memed a partir da frequência coletada no chatbot
// (1/2/3 vezes ao dia). Usa o texto já normalizado pela triagem quando
// disponível; caso contrário (medicamento sem posology persistida) gera no
// mesmo formato — sem repetir dose/concentração, já presente no nome do item.
function buildPosologia(med = {}) {
  if (med.posology && !isInvalidClinicalValue(med.posology)) {
    return compactWhitespace(med.posology);
  }

  const frequency = compactWhitespace(med.frequency);
  const route = compactWhitespace(med.route || 'oral');
  const via =
    route.toLowerCase() === 'oral' || route.toLowerCase().includes('oral')
      ? 'via oral'
      : `via ${route}`;
  const doses = dailyDosesFromFrequency(frequency);
  const frequencyLabel = doses === 3 ? 'a cada 8 horas' : doses === 2 ? 'a cada 12 horas' : 'uma vez ao dia';

  return `Tomar 1 unidade por ${via}, ${frequencyLabel}.`;
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
  const rawUnit = compactWhitespace(med.unidade || med.unit_dispense || '').toLowerCase();
  if (rawUnit && BLOCKED_MEMED_UNITS.has(rawUnit)) {
    const err = new Error(`Unidade de dispensação inválida para Memed: ${rawUnit}. Use comprimidos.`);
    err.code = 'MEMED_PAYLOAD_UNIT_INVALID';
    throw err;
  }
  if (!quantidade || quantidade < 1) {
    const err = new Error('Quantidade Memed inválida ou vazia');
    err.code = 'MEMED_PAYLOAD_QUANTITY_INVALID';
    throw err;
  }

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
