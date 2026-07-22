const assert = require('assert');
const { describeConditions } = require('../src/services/clinical-intelligence.service');

function main() {
  // 1 patologia
  assert.equal(describeConditions('has'), 'Hipertensão Arterial');

  // 2 patologias
  assert.equal(describeConditions('has, dm'), 'Hipertensão Arterial, Diabetes Mellitus');

  // 4 patologias (todas selecionadas)
  assert.equal(
    describeConditions('has, dm, dlp, hipotireoidismo'),
    'Hipertensão Arterial, Diabetes Mellitus, Dislipidemia, Hipotireoidismo'
  );

  // ordem diferente / espaços extras
  assert.equal(
    describeConditions('dlp,  has ,dm'),
    'Dislipidemia, Hipertensão Arterial, Diabetes Mellitus'
  );

  // vazio cai no fallback genérico
  assert.equal(describeConditions(''), 'condição crônica');

  // token não reconhecido é preservado como veio (não descartado)
  assert.equal(describeConditions('has, outra_condicao'), 'Hipertensão Arterial, outra_condicao');

  console.log(JSON.stringify({ ok: true, describeConditionsPreservesAll: true }, null, 2));
}

main();
