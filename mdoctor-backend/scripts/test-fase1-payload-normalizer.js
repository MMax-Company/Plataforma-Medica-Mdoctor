const {
  normalizeTypebotPayload,
  parseMedicationFreeText,
  normalizeBirthDate,
  isVisibleInMedicalPanel
} = require('../src/services/clinical-payload-normalizer.service');
const engine = require('../src/eligibility/engine');
const { toPatientEvaluationShape } = require('../src/services/clinical-payload-normalizer.service');

function assert(label, condition) {
  console.log(condition ? `OK  ${label}` : `FAIL ${label}`);
  if (!condition) process.exitCode = 1;
}

const base = {
  patient_name: 'Ana Silva',
  whatsapp: '5511999990000',
  cpf: '123.456.789-09',
  birth_date: '09/02/1988',
  email: 'ana@example.com',
  address: 'Rua A, 100',
  cep: '01310-100',
  chronic_condition: 'has',
  tempo_uso: 'Mais de 6 meses',
  has_previous_prescription: 'sim',
  previous_prescription_file: 'https://cdn.example.com/rx.jpg',
  sinais_alerta: 'NAO',
  eligibility_status: 'eligible',
  pagamento_status: 'paid',
  primeiro_medicamento: 'metformina 850 tomo 2x ao dia'
};

assert('birth 09/02/1988', normalizeBirthDate('09/02/1988') === '1988-02-09');

const med = parseMedicationFreeText('metformina 850 tomo 2x ao dia');
assert('med name', med.name === 'Metformina');
assert('med dose', med.dose === '850');
assert('med frequency', med.frequency === '12/12h');

const eligible = normalizeTypebotPayload(base);
assert('eligible status', eligible.normalized.eligibility_status === 'eligible');
assert('payment paid', eligible.normalized.payment_confirmed === true);
assert('can queue', eligible.normalized.validation.can_enter_medical_queue === true);

const decision = engine.evaluate(toPatientEvaluationShape(eligible.normalized));
assert('engine eligible', decision.eligible === true);

const unpaid = normalizeTypebotPayload({ ...base, pagamento_status: 'pending' });
assert('unpaid blocked', unpaid.normalized.validation.can_enter_medical_queue === false);

const noPhoto = normalizeTypebotPayload({ ...base, previous_prescription_file: '' });
assert('no photo awaits external upload', noPhoto.normalized.validation.awaiting_prescription_upload === true);
assert('no photo not in medical queue yet', noPhoto.normalized.validation.can_enter_medical_queue === false);

const panelOk = isVisibleInMedicalPanel({
  pagamento_status: 'CONFIRMADO',
  elegibilidade: { eligible: true },
  status: 'waiting',
  dados_clinicos: {
    queue_type: 'medical',
    foto_receita_url: 'https://example.com/receita.jpg',
    previous_prescription_storage_path: 'atendimentos/demo/receita-anterior-1.jpg'
  }
});
const panelBad = isVisibleInMedicalPanel({
  pagamento_status: 'PENDENTE',
  elegibilidade: { eligible: true },
  status: 'waiting',
  dados_clinicos: { queue_type: 'medical' }
});
assert('panel visible paid+eligible', panelOk === true);
assert('panel hidden unpaid', panelBad === false);

console.log('Done.');
