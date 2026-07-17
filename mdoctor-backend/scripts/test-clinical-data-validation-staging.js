#!/usr/bin/env node
const {
  normalizeTypebotPayload,
  normalizeMedicationBundle
} = require('../src/services/clinical-payload-normalizer.service');
const {
  isInvalidClinicalValue,
  sanitizeMedications,
  validateClinicalInput,
  validateStructuredAddress,
  parseBrazilianAddress
} = require('../src/services/typebot-clinical-data.validation');
const { validateTypebotInput } = require('../src/services/typebot-personal-data.validation');

function assert(label, condition) {
  console.log(condition ? `OK  ${label}` : `FAIL ${label}`);
  if (!condition) process.exitCode = 1;
}

assert('blocks __probe__', isInvalidClinicalValue('__probe__') === true);
assert('blocks empty', isInvalidClinicalValue('') === true);
assert('accepts captopril', isInvalidClinicalValue('Captopril') === false);

const sanitized = sanitizeMedications([
  { name: 'Captopril', dose: '25 mg', frequency: '2x ao dia', route: 'Via oral' },
  { name: '', dose: '', frequency: '', route: '' },
  { name: '', dose: '', frequency: '', route: '' }
], 1);
assert('keeps one medication', sanitized.medications.length === 1);
assert('medication_count matches real count', sanitized.medication_count === 1);
assert('detects count mismatch', sanitized.countMismatch === false);

const badSanitized = sanitizeMedications([
  { name: 'Captopril', dose: '__probe__', frequency: '2x ao dia', route: 'Via oral' }
], 1);
assert('drops probe dose medication', badSanitized.medications.length === 0);

const parsedAddress = parseBrazilianAddress('Rua Aurora 965 República São Paulo SP');
assert('parses rua', parsedAddress?.rua === 'Rua Aurora');
assert('parses numero', parsedAddress?.numero === '965');
assert('parses bairro', parsedAddress?.bairro === 'República');
assert('parses cidade', parsedAddress?.cidade === 'São Paulo');
assert('parses estado', parsedAddress?.estado === 'SP');

const captoprilPayload = {
  patient_name: 'Max Vinicius Ferreira Matos',
  whatsapp: '5511985485777',
  cpf: '52998224725',
  birth_date: '09/02/1988',
  email: 'max@example.com',
  address: 'Rua Aurora 965 República São Paulo SP',
  cep: '01209003',
  chronic_condition: 'has',
  tempo_uso: 'Mais de 6 meses',
  has_previous_prescription: 'sim',
  previous_prescription_file: 'https://example.com/receita.jpg',
  sinais_alerta: 'NAO',
  eligibility_status: 'eligible',
  pagamento_status: 'paid',
  medication_count: 1,
  med1_nome: 'Captopril',
  med1_dose: '25 mg',
  med1_frequencia: '2x ao dia',
  med1_via: 'Via oral',
  medications: [
    { name: 'Captopril', dose: '25 mg', frequency: '2x ao dia', route: 'Via oral' },
    { name: '', dose: '', frequency: '', route: '' },
    { name: '', dose: '', frequency: '', route: '' }
  ]
};

const normalized = normalizeTypebotPayload(captoprilPayload).normalized;
assert('captopril persisted', normalized.medications[0]?.name === 'Captopril');
assert('dose persisted', normalized.medications[0]?.dose === '25');
assert('frequency persisted', normalized.medications[0]?.frequency === '2x ao dia');
assert('route persisted', /oral/i.test(normalized.medications[0]?.route));
assert('single medication only', normalized.medication_count === 1);
assert('structured address rua', normalized.address_structured?.rua === 'Rua Aurora');
assert('structured address estado', normalized.address_structured?.estado === 'SP');
assert('required fields ok', normalized.validation.required.ok === true);

const probePayload = normalizeTypebotPayload({
  ...captoprilPayload,
  med1_dose: '__probe__',
  medications: [{ name: 'Captopril', dose: '__probe__', frequency: '2x ao dia', route: 'Via oral' }]
}).normalized;
assert('probe payload rejected', probePayload.validation.required.ok === false);

const invalidDose = validateClinicalInput('blk_n5x21i7c', '__probe__');
assert('whatsapp dose validation fails probe', invalidDose.valid === false);
const validDose = validateClinicalInput('blk_n5x21i7c', '25 mg');
assert('whatsapp dose validation accepts 25 mg', validDose.valid === true);

const invalidAddress = validateTypebotInput('q78qjnk6ticwkeifl7xe2rju', 'Rua A');
assert('address validation rejects incomplete', invalidAddress.valid === false);
const validAddress = validateTypebotInput(
  'q78qjnk6ticwkeifl7xe2rju',
  'Rua Aurora, 965, República, São Paulo, SP'
);
assert('address validation accepts complete', validAddress.valid === true);

const bundle = normalizeMedicationBundle(captoprilPayload);
assert('bundle count', bundle.medication_count === 1);

console.log('Done.');
