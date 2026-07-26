#!/usr/bin/env node
/**
 * Valida payload Memed staging — sem emissão/assinatura.
 * Uso: node scripts/test-memed-payload-staging.js
 */
const assert = require('assert');
const {
  buildMemedPayloadFromAtendimento,
  buildAddItemPayload,
  quantityForFrequency,
  TREATMENT_DAYS,
  MEMED_UNIT
} = require('../src/services/memed-payload.service');
const { parseBrazilianAddress } = require('../src/services/typebot-clinical-data.validation');

function baseAtendimento(frequency) {
  return {
    id: '78399c26-9e4c-46e3-bb17-9bef845c7002',
    paciente_nome: 'Max Vinicius Ferreira Matos',
    paciente_cpf: '01739134150',
    paciente_telefone: '+5511985485777',
    paciente_email: 'maxvini.ferr@gmail.com',
    dados_clinicos: {
      cep: '01209003',
      address: 'Rua Aurora, 965, Santa Ifigênia, São Paulo, SP',
      address_structured: {
        rua: 'Rua Aurora',
        numero: '965',
        bairro: 'Santa Ifigênia',
        cidade: 'São Paulo',
        estado: 'SP'
      },
      medication_count: 1,
      medications: [
        {
          index: 1,
          name: 'Captopril',
          dose: '25',
          unit: 'mg',
          frequency,
          route: 'Via oral',
          posology: `Tomar 1 unidade por via oral, ${frequency}.`
        }
      ],
      data_nascimento: '1988-02-09'
    }
  };
}

function ok(label, condition) {
  assert.ok(condition, label);
  console.log(`OK  ${label}`);
}

assert.equal(TREATMENT_DAYS, 60);
assert.equal(MEMED_UNIT, 'comprimidos');
ok('quantity 2x/dia', quantityForFrequency('2x ao dia') === 120);
ok('quantity 1x/dia', quantityForFrequency('1x ao dia') === 60);
ok('quantity 3x/dia', quantityForFrequency('3x ao dia') === 180);

const parsed = parseBrazilianAddress('Rua Aurora, 965, Santa Ifigenia Sao, Paulo, SP');
ok('address bairro', parsed.bairro === 'Santa Ifigenia');
ok('address cidade', parsed.cidade === 'São Paulo');

const payloads = {};
for (const [key, frequency] of [
  ['1x_dia', '1x ao dia'],
  ['2x_dia', '2x ao dia'],
  ['3x_dia', '3x ao dia']
]) {
  const payload = buildMemedPayloadFromAtendimento(baseAtendimento(frequency));
  const item = payload.addItems[0];
  ok(`${key} frequencia`, item.frequencia === frequency);
  ok(`${key} unidade`, item.unidade === 'comprimidos');
  ok(`${key} duracao`, item.duracao_dias === 60);
  payloads[key] = { addItem: item, setPaciente: payload.setPaciente };
}

// A Memed só aceita unit "embalagem(ns)" para item sem id de catálogo — sem
// busca de catálogo (fora de escopo), a quantidade real (60/120/180) vai
// embutida no nome (padrão oficial da Memed para texto livre) e quantidade
// enviada ao addItem é sempre 1 (ver comentário em buildAddItemPayload).
ok('2x quantidade real 120 no nome', payloads['2x_dia'].addItem.nome.includes('120 comprimidos'));
ok('1x quantidade real 60 no nome', payloads['1x_dia'].addItem.nome.includes('60 comprimidos'));
ok('3x quantidade real 180 no nome', payloads['3x_dia'].addItem.nome.includes('180 comprimidos'));
ok('2x quantidade enviada à Memed é 1', payloads['2x_dia'].addItem.quantidade === 1);
ok('1x quantidade enviada à Memed é 1', payloads['1x_dia'].addItem.quantidade === 1);
ok('3x quantidade enviada à Memed é 1', payloads['3x_dia'].addItem.quantidade === 1);

try {
  buildAddItemPayload({
    name: 'Captopril',
    dose: '25',
    unit: 'mg',
    frequency: '2x ao dia',
    route: 'oral',
    unidade: 'embalagens'
  });
  assert.fail('embalagens should be rejected');
} catch (error) {
  ok('blocks embalagens', error.code === 'MEMED_PAYLOAD_UNIT_INVALID');
}

console.log(
  JSON.stringify(
    {
      memedPayloadStaging: 'ok',
      payloads
    },
    null,
    2
  )
);
