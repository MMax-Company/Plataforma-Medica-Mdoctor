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
  address: 'Rua A, 100, Centro, São Paulo, SP',
  cep: '01310-100',
  chronic_condition: 'has',
  tempo_uso: 'Mais de 6 meses',
  has_previous_prescription: 'sim',
  previous_prescription_file: 'https://cdn.example.com/rx.jpg',
  sinais_alerta: 'NAO',
  eligibility_status: 'eligible',
  pagamento_status: 'paid',
  primeiro_medicamento: 'metformina 850 tomo 2x ao dia',
  lgpd_accepted: true,
  privacy_policy_accepted: true,
  telemedicine_consent_accepted: true,
  non_urgency_notice_accepted: true,
  terms_of_use_accepted: true
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

const numericConditions = [
  ['1', 'hipertensao'],
  ['2', 'diabetes_tipo_2'],
  ['3', 'dislipidemia'],
  ['4', 'hipotireoidismo'],
  ['1, 3', 'hipertensao']
];
for (const [input, expected] of numericConditions) {
  const result = normalizeTypebotPayload({ ...base, chronic_condition: input });
  assert(`condição Typebot "${input}" normalizada como ${expected}`, result.normalized.chronic_condition === expected);
  assert(`condição Typebot "${input}" permanece elegível`, engine.evaluate(toPatientEvaluationShape(result.normalized)).eligible === true);
}

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

// Pedido 2026-07-21 — blk_receita_choice (Typebot) usa os values
// "available"/"none"/"send_later" para "Sim, possuo"/"Não possuo"/"Enviar
// depois". Causa raiz do atendimento reprovado no teste humano: "available"
// nunca virava true (só "sim"/"true"/... eram reconhecidos), então o
// paciente respondendo "Sim, possuo" ainda assim era marcado como
// has_previous_prescription=false e reprovado por dado obrigatório
// incompleto.
const available = normalizeTypebotPayload({ ...base, has_previous_prescription: 'available' });
assert('"available" (Sim, possuo) mapeia para true', available.normalized.has_previous_prescription === true);
assert('"available" não reprova por dado obrigatório incompleto', available.normalized.validation.required.ok === true);

const none = normalizeTypebotPayload({ ...base, has_previous_prescription: 'none', previous_prescription_file: '' });
assert('"none" (Não possuo) continua mapeando para false', none.normalized.has_previous_prescription === false);

const sendLater = normalizeTypebotPayload({ ...base, has_previous_prescription: 'send_later', previous_prescription_file: '' });
assert('"send_later" (Enviar depois) preservado como antes (false)', sendLater.normalized.has_previous_prescription === false);

console.log('Done.');
