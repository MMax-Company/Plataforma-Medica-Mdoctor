const { compactWhitespace, digitsOnly } = require('./typebot-validation.utils');

const CLINICAL_INPUTS = Object.freeze({
  blk_xp763m78: { field: 'medicationName', question: 'Informe o nome do medicamento.' },
  blk_fjhq98ob: { field: 'medicationName', question: 'Informe o nome do medicamento.' },
  blk_k8s4myef: { field: 'medicationName', question: 'Informe o nome do medicamento.' },
  blk_n5x21i7c: { field: 'medicationDose', question: 'Informe a dose (ex.: 25 mg).' },
  blk_e3e58xjk: { field: 'medicationDose', question: 'Informe a dose (ex.: 25 mg).' },
  blk_g0v3kz80: { field: 'medicationDose', question: 'Informe a dose (ex.: 25 mg).' }
  // b156nm008xh7gb52n7w3egzn (Doença Crônica) NÃO entra aqui: esse input já
  // é resolvido pelo mecanismo de lista interativa multi-seleção do
  // WhatsApp (OFFICIAL_MULTI_CHOICE_INPUT_IDS em typebot-whatsapp.bridge.js),
  // que envia texto final como códigos ("has, dm"). Registrá-lo também aqui
  // como chronicConditions (dígitos "1, 3") fazia validateTypebotInput
  // rejeitar a confirmação da lista, travando o fluxo em loop.
});

// Mapa fixo número -> código de condição, na mesma ordem/numeração exibida
// no texto da pergunta (grupo "Doença Cronica"). Os códigos são os mesmos
// já usados em toda a base (map em blk_resumo_set_condicoes e nas
// eligibility rules) — só a forma de coleta muda (texto livre com números
// em vez de choice input, já que o WhatsApp não tem seleção múltipla
// nativa em botões/lista).
const CHRONIC_CONDITION_BY_NUMBER = {
  1: 'has',
  2: 'dm',
  3: 'dlp',
  4: 'hipotireoidismo'
};

function validateChronicConditions(value) {
  const raw = compactWhitespace(value);
  if (!raw) {
    return { valid: false, error: 'Informe pelo menos um número válido entre 1 e 4, separados por vírgula (ex.: 1, 3).' };
  }
  const numbers = raw.split(',').map((part) => part.trim()).filter(Boolean);
  const codes = [];
  for (const token of numbers) {
    if (!/^[1-4]$/.test(token)) {
      return { valid: false, error: `"${token}" não é uma opção válida. Use apenas números de 1 a 4, separados por vírgula (ex.: 1, 3).` };
    }
    const code = CHRONIC_CONDITION_BY_NUMBER[Number(token)];
    if (!codes.includes(code)) codes.push(code);
  }
  if (!codes.length) {
    return { valid: false, error: 'Informe pelo menos um número válido entre 1 e 4, separados por vírgula (ex.: 1, 3).' };
  }
  return { valid: true, value: codes.join(',') };
}

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

// Normaliza rótulos de campo ("bairro", "cidade", "uf"/"estado") e
// separadores alternativos (hífen entre cidade e UF) em vírgulas, e remove
// os marcadores de número ("número"/"nº"/"n.") mantendo só o dígito — assim
// o mesmo parser por vírgula abaixo entende tanto texto livre quanto texto
// com rótulos explícitos, sem precisar de dois parsers separados.
function normalizeAddressSeparators(raw) {
  let text = raw.replace(/\s+-\s+/g, ', ');
  text = text.replace(/\bn[uú]mero\b\.?\s*/gi, '');
  text = text.replace(/\bn[º°]\.?\s*/gi, '');
  text = text.replace(/\bn\.\s*/gi, '');
  text = text.replace(/\bbairro\b\s*:?\s*/gi, ', ');
  text = text.replace(/\bcidade\b\s*:?\s*/gi, ', ');
  text = text.replace(/\b(?:uf|estado)\b\s*:?\s*/gi, ', ');
  text = text.replace(/,\s*,+/g, ',').replace(/^\s*,\s*/, '');
  return compactWhitespace(text);
}

// Divide a primeira parte (antes de qualquer bairro/cidade) em rua + número
// quando os dois ainda estiverem juntos (ex.: "Rua Augusta 123" sem vírgula
// separando o número). Só atua quando já existe alguma estrutura por vírgula
// — texto totalmente livre é tratado depois pelo fallback posicional.
function splitRuaNumero(commaParts) {
  if (commaParts.length < 2 || /^\d/.test(commaParts[0])) return commaParts;
  const tokens = commaParts[0].split(/\s+/).filter(Boolean);
  const numeroIndex = tokens.findIndex((token) => /^\d+[A-Za-z]?$/.test(token));
  if (numeroIndex <= 0) return commaParts;
  const rua = tokens.slice(0, numeroIndex).join(' ');
  const numero = tokens[numeroIndex];
  const resto = tokens.slice(numeroIndex + 1).join(' ');
  return [rua, numero, ...(resto ? [resto] : []), ...commaParts.slice(1)];
}

function parseBrazilianAddress(value) {
  const raw = compactWhitespace(value).replace(/[.!]+$/, '').trim();
  if (!raw) return null;

  const text = normalizeAddressSeparators(raw);
  let commaParts = text.split(',').map((part) => part.trim()).filter(Boolean);
  commaParts = splitRuaNumero(commaParts);

  // "Rua X, 123, Bairro, Cidade UF" — cidade e estado no mesmo segmento, sem
  // vírgula entre eles (forma comum de digitar). Separa em 5 partes para
  // reaproveitar a lógica abaixo, sem duplicar o parsing.
  if (commaParts.length === 4) {
    const last = commaParts[3];
    const cityStateMatch = last.match(/^(.+?)\s+([A-Za-z]{2})$/);
    const bareUf = last.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (cityStateMatch && BRAZILIAN_STATES.has(cityStateMatch[2].toUpperCase())) {
      commaParts[3] = cityStateMatch[1].trim();
      commaParts.push(cityStateMatch[2].toUpperCase());
    } else if (bareUf.length === 2 && BRAZILIAN_STATES.has(bareUf)) {
      // "Rua X, 123, Cidade, UF" — bairro não informado. Devolve parcial
      // (em vez de null) para o validador apontar exatamente "bairro",
      // sem pedir o endereço inteiro de novo.
      return { rua: commaParts[0], numero: commaParts[1], bairro: '', cidade: commaParts[2], estado: bareUf };
    } else {
      // "Rua X, 123, Bairro, Cidade" — UF não informada. Mesma ideia: devolve
      // parcial para o validador apontar exatamente "estado (UF)".
      return { rua: commaParts[0], numero: commaParts[1], bairro: commaParts[2], cidade: commaParts[3], estado: '' };
    }
  }

  if (commaParts.length >= 5) {
    const estado = commaParts[commaParts.length - 1].replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
    let bairro = commaParts[commaParts.length - 3];
    let cidade = commaParts[commaParts.length - 2];
    // "..., Santa Ifigenia Sao, Paulo, SP" → bairro + São Paulo
    if (cidade === 'Paulo' && /\bSao$/i.test(bairro)) {
      bairro = bairro.replace(/\s+Sao$/i, '').trim();
      cidade = 'São Paulo';
    }
    return {
      rua: commaParts[0],
      numero: commaParts[1],
      bairro,
      cidade,
      estado
    };
  }

  const stateMatch = text.match(/\b([A-Za-z]{2})\s*$/);
  if (!stateMatch || !BRAZILIAN_STATES.has(stateMatch[1].toUpperCase())) return null;
  const estado = stateMatch[1].toUpperCase();
  const withoutState = text.slice(0, stateMatch.index).trim();

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
  medicationDose: validateMedicationDose,
  chronicConditions: validateChronicConditions
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
