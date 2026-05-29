const { mapTypebotPayload } = require('../src/services/typebot-payload.mapper');
const { toPatientEvaluationShape } = require('../src/services/clinical-payload-normalizer.service');
const { normalizeBirthDate } = require('../src/services/clinical-intelligence.service');
const engine = require('../src/eligibility/engine');

function assert(label, condition) {
  console.log(condition ? `OK  ${label}` : `FAIL ${label}`);
  if (!condition) process.exitCode = 1;
}

const eligiblePayload = {
  patient_name: 'Ana Silva',
  whatsapp: '5511999990000',
  cpf: '12345678909',
  birth_date: '15/08/1988',
  email: 'ana@example.com',
  address: 'Rua Teste, 10',
  cep: '01310100',
  chronic_condition: 'has',
  tempo_uso: 'Mais de 6 meses',
  has_previous_prescription: 'sim',
  previous_prescription_file: 'https://cdn.example.com/receita.jpg',
  sinais_alerta: 'NAO',
  medication_name: 'losartana 50mg',
  med1_nome: 'losartana',
  med1_dose: '50mg',
  eligibility_status: 'eligible',
  pagamento_status: 'paid'
};

const { normalized: eligibleNorm } = mapTypebotPayload(eligiblePayload);
const eligibleDecision = engine.evaluate(toPatientEvaluationShape(eligibleNorm));

assert('birth dd/mm', normalizeBirthDate('15/08/1988') === '1988-08-15');
assert('birth 8 digits', normalizeBirthDate('15081988') === '1988-08-15');
assert('eligible flow', eligibleDecision.eligible === true);

const noPhoto = mapTypebotPayload({ ...eligiblePayload, previous_prescription_file: '', foto_receita_url: '' }).normalized;
assert('no photo blocked', noPhoto.eligibility_status === 'ineligible');

const noRx = mapTypebotPayload({ ...eligiblePayload, has_previous_prescription: 'nao' }).normalized;
assert('no previous rx blocked', noRx.eligibility_status === 'ineligible');

const alert = mapTypebotPayload({ ...eligiblePayload, sinais_alerta: 'Dor no peito', has_warning_signs: true }).normalized;
assert('alert signs blocked', alert.eligibility_status === 'ineligible');

const controlled = mapTypebotPayload({ ...eligiblePayload, primeiro_medicamento: 'clonazepam 2mg' }).normalized;
assert('controlled med blocked', controlled.eligibility_status === 'ineligible');

console.log('Done.');
