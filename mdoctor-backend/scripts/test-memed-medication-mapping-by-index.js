const assert = require('assert');
const { mapTypebotPayload } = require('../src/services/typebot-payload.mapper');

function basePayload(count, overrides) {
  return {
    patient_name: 'Paciente Teste',
    whatsapp: '5511999998888',
    medication_count: count,
    ...overrides
  };
}

function medFields(index, name, dose, prefix) {
  if (prefix === 'med') {
    return {
      [`med${index}_nome`]: name,
      [`med${index}_dose`]: dose,
      [`med${index}_frequencia`]: '24h',
      [`med${index}_via`]: 'Via oral'
    };
  }
  return {
    [`medication_${index}_name`]: name,
    [`medication_${index}_dose`]: dose,
    [`medication_${index}_frequency`]: '24h',
    [`medication_${index}_route`]: 'Via oral'
  };
}

function assertIndexByIndex(expected, medications) {
  assert.equal(medications.length, expected.length, `esperava ${expected.length} medicamento(s), recebeu ${medications.length}`);
  expected.forEach((exp, i) => {
    const got = medications[i];
    assert.equal(got.index, i + 1, `medicamento ${i + 1} deveria ter index ${i + 1}`);
    assert.equal(got.name, exp.name, `medicamento ${i + 1}: nome esperado "${exp.name}", recebido "${got.name}"`);
    assert.equal(got.dose, exp.dose, `medicamento ${i + 1}: dose esperada "${exp.dose}", recebida "${got.dose}"`);
  });
  // Nenhum medicamento pode repetir o nome do primeiro (exceto o próprio primeiro).
  for (let i = 1; i < medications.length; i++) {
    assert.notEqual(
      medications[i].name,
      medications[0].name,
      `medicamento ${i + 1} não pode reutilizar o nome do medicamento 1 ("${medications[0].name}")`
    );
  }
}

function runScenario(label, prefix, meds) {
  const overrides = {};
  meds.forEach((m, i) => Object.assign(overrides, medFields(i + 1, m.name, m.dose, prefix)));
  const payload = basePayload(meds.length, overrides);
  const { patientData } = mapTypebotPayload(payload);
  assertIndexByIndex(meds, patientData.medications);
  return patientData.medications;
}

function main() {
  // Formato "med<N>_nome" (variáveis oficiais do Typebot)
  runScenario('1 medicamento — med_nome', 'med', [{ name: 'Losartana', dose: '50mg' }]);
  runScenario('2 medicamentos — med_nome', 'med', [
    { name: 'Losartana', dose: '50mg' },
    { name: 'Metformina', dose: '850mg' }
  ]);
  runScenario('3 medicamentos — med_nome', 'med', [
    { name: 'Losartana', dose: '50mg' },
    { name: 'Metformina', dose: '850mg' },
    { name: 'Sinvastatina', dose: '20mg' }
  ]);

  // Formato "medication_<N>_name" (como o node n8n typebot-webhook-staging encaminha)
  runScenario('1 medicamento — medication_name', 'medication', [{ name: 'Losartana', dose: '50mg' }]);
  runScenario('2 medicamentos — medication_name', 'medication', [
    { name: 'Losartana', dose: '50mg' },
    { name: 'Metformina', dose: '850mg' }
  ]);
  const three = runScenario('3 medicamentos — medication_name', 'medication', [
    { name: 'Losartana', dose: '50mg' },
    { name: 'Metformina', dose: '850mg' },
    { name: 'Sinvastatina', dose: '20mg' }
  ]);

  console.log(JSON.stringify({
    ok: true,
    medicationMappingPreservesIndexAndName: true,
    exampleThreeMeds: three.map((m) => ({ index: m.index, name: m.name }))
  }, null, 2));
}

main();
