const { compactWhitespace, digitsOnly } = require('./typebot-validation.utils');

const CLINICAL_INPUTS = Object.freeze({
  blk_xp763m78: { field: 'medicationName', question: 'Informe o nome do medicamento.' },
  blk_fjhq98ob: { field: 'medicationName', question: 'Informe o nome do medicamento.' },
  blk_k8s4myef: { field: 'medicationName', question: 'Informe o nome do medicamento.' },
  blk_n5x21i7c: { field: 'medicationDose', question: 'Informe a dose (ex.: 25 mg).' },
  blk_e3e58xjk: { field: 'medicationDose', question: 'Informe a dose (ex.: 25 mg).' },
  blk_g0v3kz80: { field: 'medicationDose', question: 'Informe a dose (ex.: 25 mg).' }
});

const INVALID_VALUE_PATTERNS = [
  /^__probe__$/i,
  /^probe$/i,
  /^teste$/i,
  /^test$/i,
  /^n\/a$/i,
  /^na$/i,
  /^null$/i,
  /^undefined$/i,
  /^pendente$/i,
  /^informado na triagem$/i,
  /^medicamento informado na triagem$/i,
  /^endereço pendente/i,
  /^endereco pendente/i
];

const BRAZILIAN_STATES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
]);

function isInvalidClinicalValue(value) {
  const normalized = compactWhitespace(value);
  if (!normalized) return true;
  const lower = normalized.toLowerCase();
  if (INVALID_VALUE_PATTERNS.some((pattern) => pattern.test(lower))) return true;
  if (/^[_-]+$/.test(normalized)) return true;
  if (/^\{\{.*\}\}$/.test(normalized)) return true;
  return false;
}

function validateMedicationName(value) {
  const name = compactWhitespace(value);
  if (isInvalidClinicalValue(name)) {
    return { valid: false, error: 'Informe o nome real do medicamento, sem placeholders ou valores de teste.' };
  }
  if (name.length < 2 || !/[a-zA-ZÀ-ÿ]/.test(name)) {
    return { valid: false, error: 'Informe o nome do medicamento com pelo menos 2 letras.' };
  }
  return { valid: true, value: name };
}

function validateMedicationDose(value) {
  const dose = compactWhitespace(value);
  if (isInvalidClinicalValue(dose)) {
    return { valid: false, error: 'Informe a dose real (ex.: 25 mg), sem placeholders ou valores de teste.' };
  }
  if (!/\d/.test(dose)) {
    return { valid: false, error: 'Informe a dose com número e unidade (ex.: 25 mg).' };
  }
  return { valid: true, value: dose };
}

function parseBrazilianAddress(value) {
  const raw = compactWhitespace(value);
  if (!raw) return null;

  const commaParts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 5) {
    const estado = commaParts[commaParts.length - 1].replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
    return {
      rua: commaParts[0],
      numero: commaParts[1],
      bairro: commaParts[2],
      cidade: commaParts[3],
      estado
    };
  }

  const stateMatch = raw.match(/\b([A-Za-z]{2})\s*$/);
  if (!stateMatch) return null;
  const estado = stateMatch[1].toUpperCase();
  const withoutState = raw.slice(0, stateMatch.index).trim();

  const MULTI_WORD_CITIES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Porto Alegre'];
  for (const city of MULTI_WORD_CITIES) {
    if (!withoutState.endsWith(city)) continue;
    const prefix = withoutState.slice(0, withoutState.length - city.length).trim();
    const prefixTokens = prefix.split(/\s+/).filter(Boolean);
    const numeroIndex = prefixTokens.findIndex((token) => /^\d+[A-Za-z0-9-]*$/.test(token));
    if (numeroIndex <= 0) return null;
    return {
      rua: prefixTokens.slice(0, numeroIndex).join(' '),
      numero: prefixTokens[numeroIndex],
      bairro: prefixTokens.slice(numeroIndex + 1).join(' '),
      cidade: city,
      estado
    };
  }

  const tokens = withoutState.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return null;

  const numeroIndex = tokens.findIndex((token) => /^\d+[A-Za-z0-9-]*$/.test(token));
  if (numeroIndex <= 0) return null;

  return {
    rua: tokens.slice(0, numeroIndex).join(' '),
    numero: tokens[numeroIndex],
    bairro: tokens.slice(numeroIndex + 1, -1).join(' ') || tokens[numeroIndex + 1] || '',
    cidade: tokens[tokens.length - 1] || '',
    estado
  };
}

function normalizeStructuredAddress(payload = {}) {
  const direct = {
    rua: compactWhitespace(payload.endereco_rua || payload.address_street || payload.rua || ''),
    numero: compactWhitespace(payload.endereco_numero || payload.address_number || payload.numero || ''),
    bairro: compactWhitespace(payload.endereco_bairro || payload.address_neighborhood || payload.bairro || ''),
    cidade: compactWhitespace(payload.endereco_cidade || payload.address_city || payload.cidade || ''),
    estado: compactWhitespace(payload.endereco_estado || payload.address_state || payload.estado || '').toUpperCase().slice(0, 2),
    cep: digitsOnly(payload.cep || payload.CEP || '')
  };

  const hasDirect = [direct.rua, direct.numero, direct.bairro, direct.cidade, direct.estado].every(Boolean);
  if (hasDirect) {
    return {
      ...direct,
      formatted: `${direct.rua}, ${direct.numero}, ${direct.bairro}, ${direct.cidade}, ${direct.estado}`
    };
  }

  const freeText = compactWhitespace(
    payload.address || payload.Endereco || payload.endereco || payload.endereco_completo || ''
  );
  const parsed = parseBrazilianAddress(freeText);
  if (!parsed) return null;

  return {
    rua: parsed.rua,
    numero: parsed.numero,
    bairro: parsed.bairro,
    cidade: parsed.cidade,
    estado: parsed.estado,
    cep: direct.cep,
    formatted: `${parsed.rua}, ${parsed.numero}, ${parsed.bairro}, ${parsed.cidade}, ${parsed.estado}`
  };
}

function validateStructuredAddress(value, cepValue) {
  const structured = normalizeStructuredAddress({ address: value, endereco: value, cep: cepValue });
  if (!structured) {
    return {
      valid: false,
      error: 'Informe o endereço completo: rua, número, bairro, cidade e estado (UF).'
    };
  }

  const missing = [];
  if (isInvalidClinicalValue(structured.rua)) missing.push('rua');
  if (isInvalidClinicalValue(structured.numero)) missing.push('número');
  if (isInvalidClinicalValue(structured.bairro)) missing.push('bairro');
  if (isInvalidClinicalValue(structured.cidade)) missing.push('cidade');
  if (!BRAZILIAN_STATES.has(structured.estado)) missing.push('estado (UF)');

  const cep = digitsOnly(cepValue || structured.cep);
  if (cepValue !== undefined && cepValue !== null && String(cepValue).trim() !== '' && !/^\d{8}$/.test(cep)) {
    missing.push('CEP');
  }

  if (missing.length) {
    return {
      valid: false,
      error: `Endereço incompleto. Informe: ${missing.join(', ')}.`
    };
  }

  return {
    valid: true,
    value: structured.formatted,
    structured: { ...structured, cep }
  };
}

const VALIDATORS = {
  medicationName: validateMedicationName,
  medicationDose: validateMedicationDose
};

function validateClinicalInput(inputId, value, options = {}) {
  const definition = CLINICAL_INPUTS[inputId];
  if (!definition) return { isClinical: false, valid: true, value };
  const result = VALIDATORS[definition.field](value, options);
  return {
    isClinical: true,
    field: definition.field,
    question: definition.question,
    ...result
  };
}

function isCompleteMedication(med = {}) {
  return (
    !isInvalidClinicalValue(med.name) &&
    !isInvalidClinicalValue(med.dose) &&
    !isInvalidClinicalValue(med.frequency) &&
    !isInvalidClinicalValue(med.route)
  );
}

function sanitizeMedications(medications = [], declaredCount = null) {
  const cleaned = medications
    .map((med, index) => ({
      index: index + 1,
      name: compactWhitespace(med.name),
      dose: compactWhitespace(med.dose),
      unit: compactWhitespace(med.unit || 'mg') || 'mg',
      frequency: compactWhitespace(med.frequency),
      route: compactWhitespace(med.route),
      posology: med.posology || null,
      usage: med.usage || 'contínuo',
      raw_text: med.raw_text || null,
      label: med.label || null
    }))
    .filter(isCompleteMedication)
    .map((med, index) => ({ ...med, index: index + 1 }));

  const count = Number(declaredCount);
  if (Number.isFinite(count) && count > 0 && count !== cleaned.length) {
    return { medications: cleaned, medication_count: cleaned.length, countMismatch: true };
  }

  return { medications: cleaned, medication_count: cleaned.length, countMismatch: false };
}

module.exports = {
  CLINICAL_INPUTS,
  BRAZILIAN_STATES,
  isInvalidClinicalValue,
  isCompleteMedication,
  sanitizeMedications,
  parseBrazilianAddress,
  normalizeStructuredAddress,
  validateStructuredAddress,
  validateClinicalInput
};
