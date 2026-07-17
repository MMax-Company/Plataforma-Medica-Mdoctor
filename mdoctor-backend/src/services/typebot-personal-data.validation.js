const { compactWhitespace, digitsOnly } = require('./typebot-validation.utils');
const { validateStructuredAddress, validateClinicalInput } = require('./typebot-clinical-data.validation');

const PERSONAL_INPUTS = Object.freeze({
  ds9z9lnz3yayokyy8d81fudj: {
    field: 'name',
    question: 'Qual é o seu nome completo?'
  },
  ar8jtu7sa8gfndqeebrvyj15: {
    field: 'birthDate',
    question: 'Qual é a sua data de nascimento? Informe no formato DD/MM/AAAA.'
  },
  dein7u2qnr8q32p2lv1krd5p: {
    field: 'cpf',
    question: 'Qual é o seu CPF?'
  },
  tbla9w2i2kbeyzun88hai3s9: {
    field: 'phone',
    question: 'Qual é o seu telefone com DDD?'
  },
  dwoaqosurlamebpra9yf7pm4: {
    field: 'email',
    question: 'Qual é o seu e-mail?'
  },
  q78qjnk6ticwkeifl7xe2rju: {
    field: 'address',
    question: 'Qual é o seu endereço completo? Informe rua, número, bairro, cidade e estado (UF).'
  },
  blk_0oydu2f7: {
    field: 'cep',
    question: 'Qual é o seu CEP?'
  }
});

const BRAZILIAN_DDDS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99'
]);

function validateName(value) {
  const normalized = compactWhitespace(value);
  const words = normalized.split(' ').filter(Boolean);
  return words.length >= 2
    ? { valid: true, value: normalized }
    : { valid: false, error: 'Informe seu nome completo com pelo menos nome e sobrenome.' };
}

function parseBirthDate(value) {
  const match = compactWhitespace(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { day, month, year, value: `${match[1]}/${match[2]}/${match[3]}` };
}

function ageOnDate(birthDate, now) {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const currentDay = now.getUTCDate();
  let age = currentYear - birthDate.year;
  if (currentMonth < birthDate.month || (currentMonth === birthDate.month && currentDay < birthDate.day)) age -= 1;
  return age;
}

function validateBirthDate(value, now = new Date()) {
  const parsed = parseBirthDate(value);
  if (!parsed) return { valid: false, error: 'Informe uma data válida no formato DD/MM/AAAA.' };
  const age = ageOnDate(parsed, now);
  return age >= 18 && age <= 80
    ? { valid: true, value: parsed.value }
    : { valid: false, error: 'A idade deve estar entre 18 e 80 anos.' };
}

function validateCpf(value) {
  const cpf = digitsOnly(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) {
    return { valid: false, error: 'Informe um CPF válido com 11 dígitos.' };
  }
  const calculateDigit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  if (calculateDigit(9) !== Number(cpf[9]) || calculateDigit(10) !== Number(cpf[10])) {
    return { valid: false, error: 'Informe um CPF válido com 11 dígitos.' };
  }
  return { valid: true, value: cpf };
}

function validatePhone(value) {
  let phone = digitsOnly(value);
  if ((phone.length === 12 || phone.length === 13) && phone.startsWith('55')) phone = phone.slice(2);
  const ddd = phone.slice(0, 2);
  const subscriber = phone.slice(2);
  const validMobile = phone.length === 11 && subscriber.startsWith('9');
  const validLandline = phone.length === 10 && /^[2-5]/.test(subscriber);
  if (!BRAZILIAN_DDDS.has(ddd) || (!validMobile && !validLandline)) {
    return { valid: false, error: 'Informe um telefone brasileiro válido com DDD.' };
  }
  return { valid: true, value: `+55${phone}` };
}

function validateEmail(value) {
  const email = compactWhitespace(value).toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
  return valid
    ? { valid: true, value: email }
    : { valid: false, error: 'Informe um e-mail válido, por exemplo nome@dominio.com.' };
}

function validateAddress(value) {
  const result = validateStructuredAddress(value);
  if (!result.valid) return result;
  return { valid: true, value: result.value, structured: result.structured };
}

function validateCep(value) {
  const cep = digitsOnly(value);
  return /^\d{8}$/.test(cep)
    ? { valid: true, value: cep }
    : { valid: false, error: 'Informe um CEP válido com 8 dígitos.' };
}

const VALIDATORS = {
  name: validateName,
  birthDate: validateBirthDate,
  cpf: validateCpf,
  phone: validatePhone,
  email: validateEmail,
  address: validateAddress,
  cep: validateCep
};

function validatePersonalInput(inputId, value, options = {}) {
  const definition = PERSONAL_INPUTS[inputId];
  if (!definition) return { isPersonal: false, valid: true, value };
  const result = VALIDATORS[definition.field](value, options.now);
  return {
    isPersonal: true,
    field: definition.field,
    question: definition.question,
    ...result
  };
}

function validateTypebotInput(inputId, value, options = {}) {
  const personal = validatePersonalInput(inputId, value, options);
  if (personal.isPersonal) return personal;
  const clinical = validateClinicalInput(inputId, value, options);
  if (clinical.isClinical) return clinical;
  return { isPersonal: false, isClinical: false, valid: true, value };
}

module.exports = {
  PERSONAL_INPUTS,
  validatePersonalInput,
  validateTypebotInput
};
