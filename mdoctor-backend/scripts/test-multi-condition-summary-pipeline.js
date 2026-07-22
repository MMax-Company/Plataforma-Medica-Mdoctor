const assert = require('assert');
const { mapTypebotPayload } = require('../src/services/typebot-payload.mapper');
const { buildClinicalNarrative, describeConditions } = require('../src/services/clinical-intelligence.service');

// Reproduz o mesmo caminho de triagem-webhook.service.js / whatsapp.routes.js:
// payload do Typebot -> mapTypebotPayload -> patientData.condition (código único)
// / patientData.doenca_cronica (rótulo bruto com todas as condições) ->
// describeConditions -> buildClinicalNarrative.
function buildBasePayload(doencaCronica) {
  return {
    patient_name: 'Paciente Teste',
    whatsapp: '5511999998888',
    doenca_cronica: doencaCronica,
    medication_count: 1,
    med1_nome: 'Losartana',
    med1_dose: '50mg',
    tempo_uso: 'Mais de 6 meses',
    has_previous_prescription: true,
    payment_status: 'paid'
  };
}

function runCase(doencaCronica, expectedLabels) {
  const mapped = mapTypebotPayload(buildBasePayload(doencaCronica));
  const { patientData } = mapped;

  // O campo usado para elegibilidade (patientData.condition) continua sendo
  // um único código -- isso não muda, é usado para regras de negócio.
  assert.ok(patientData.condition, 'condition (código único) deveria existir');

  // O rótulo bruto com TODAS as condições precisa estar preservado.
  assert.equal(patientData.doenca_cronica, doencaCronica);

  const narrative = buildClinicalNarrative({
    patientName: patientData.name,
    condition: describeConditions(patientData.doenca_cronica || patientData.condition),
    medication: patientData.medicacao_em_uso,
    decision: { eligible: true }
  });

  for (const label of expectedLabels) {
    assert.ok(
      narrative.summary.includes(label),
      `resumo deveria conter "${label}" para entrada "${doencaCronica}" — obtido: ${narrative.summary}`
    );
    assert.ok(
      narrative.chiefComplaint.includes(label),
      `queixa principal deveria conter "${label}" para entrada "${doencaCronica}"`
    );
  }
}

function main() {
  // 1 patologia
  runCase('has', ['Hipertensão Arterial']);

  // 2 patologias
  runCase('has, dm', ['Hipertensão Arterial', 'Diabetes Mellitus']);

  // 4 patologias (todas selecionadas)
  runCase('has, dm, dlp, hipotireoidismo', [
    'Hipertensão Arterial',
    'Diabetes Mellitus',
    'Dislipidemia',
    'Hipotireoidismo'
  ]);

  console.log(JSON.stringify({
    ok: true,
    multiConditionSummaryPreservesAllSelections: true,
    validated: ['1 patologia', '2 patologias', '4 patologias']
  }, null, 2));
}

main();
