const assert = require('assert');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');

const longEligibilityText = [
  'CRITÉRIOS DE ELEGIBILIDADE',
  'Antes de continuar, confirme que todos os critérios abaixo se aplicam a você:',
  ...Array.from({ length: 40 }, (_, index) => `✅ Critério clínico detalhado ${index + 1}.`),
  'Você confirma que atende a todos os critérios acima?'
].join('\n');

assert(longEligibilityText.length > 1024);

const outputs = convertTypebotResponse({
  messages: [{ type: 'text', content: { plainText: longEligibilityText } }],
  input: {
    id: 'w9v6g0rlkucnfmxc3qh2a2qt',
    type: 'choice input',
    items: [{ content: 'Sim' }, { content: 'Não' }]
  }
});

assert.deepEqual(outputs, [
  { kind: 'text', text: longEligibilityText },
  {
    kind: 'buttons',
    body: 'Você confirma que atende a todos os critérios acima?',
    choices: [
      { id: 'Sim', title: 'Sim', value: 'Sim' },
      { id: 'Não', title: 'Não', value: 'Não' }
    ]
  }
]);

console.log('PASS: declaração longa é preservada integralmente antes dos botões');
