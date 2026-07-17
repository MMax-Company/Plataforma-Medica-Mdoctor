#!/usr/bin/env node
/**
 * Valida payload Memed staging — sem emissão/assinatura.
 * Uso: node scripts/test-memed-payload-staging.js
 */
const assert = require('assert');
const {
  buildMemedPayloadFromAtendimento,
  quantityForFrequency,
  TREATMENT_DAYS,
  MEMED_UNIT
} = require('../src/services/memed-payload.service');

const A8704590 = {
  id: 'a8704590-c474-4b7b-b9f3-02b7de28c257',
  paciente_nome: 'Max Vinicius Ferreira Matos',
  paciente_cpf: '01739134150',
  paciente_telefone: '+5511985485777',
  paciente_email: 'maxvini.ferr@gmail.com',
  dados_clinicos: {
    cep: '01209003',
    address: 'Rua Aurora, 965, República, São Paulo, SP',
    address_structured: {
      rua: 'Rua Aurora',
      numero: '965',
      bairro: 'República',
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
        frequency: '2x ao dia',
        route: 'oral',
        posology: 'Tomar 1 comprimido por via oral a cada 12 horas (25mg).'
      }
    ],
    data_nascimento: '1988-02-09'
  }
};

function ok(label, condition) {
  assert.ok(condition, label);
  console.log(`OK  ${label}`);
}

assert.equal(TREATMENT_DAYS, 60);
assert.equal(MEMED_UNIT, 'comprimidos');
ok('quantity 2x/dia', quantityForFrequency('2x ao dia') === 120);
ok('quantity 1x/dia', quantityForFrequency('1x ao dia') === 60);
ok('quantity 3x/dia', quantityForFrequency('3x ao dia') === 180);

const payload = buildMemedPayloadFromAtendimento(A8704590);
const item = payload.addItems[0];

ok('single medication', payload.addItems.length === 1);
ok('medication_count', payload.medication_count === 1);
ok('medicamento', item.medicamento === 'Captopril');
ok('dose', item.dose === '25');
ok('unit mg', item.unit === 'mg');
ok('frequencia unchanged', item.frequencia === '2x ao dia');
ok('via', item.via === 'oral');
ok('quantidade 120', item.quantidade === 120);
ok('unidade comprimidos', item.unidade === 'comprimidos');
ok('duracao 60', item.duracao_dias === 60);
ok('nome label', item.nome === 'Captopril 25 mg');
ok('setPaciente rua', payload.setPaciente.rua === 'Rua Aurora');
ok('setPaciente numero', payload.setPaciente.numero === '965');
ok('setPaciente bairro', payload.setPaciente.bairro === 'República');
ok('setPaciente cidade', payload.setPaciente.cidade === 'São Paulo');
ok('setPaciente estado', payload.setPaciente.estado === 'SP');
ok('setPaciente cep', payload.setPaciente.cep === '01209003');

try {
  buildMemedPayloadFromAtendimento({
    id: 'x',
    paciente_nome: 'Test',
    dados_clinicos: {
      medications: [{ name: 'Captopril', dose: '__probe__', frequency: '2x ao dia', route: 'oral' }],
      address_structured: { rua: 'Rua A', numero: '1', bairro: 'B', cidade: 'C', estado: 'SP' },
      cep: '01209003'
    }
  });
  assert.fail('probe should be rejected');
} catch (error) {
  ok(
    'blocks __probe__',
    error.code === 'MEMED_PAYLOAD_MEDICATION_INVALID' || error.code === 'MEMED_PAYLOAD_NO_MEDICATIONS'
  );
}

console.log(JSON.stringify({ memedPayloadStaging: 'ok', captopril: item, setPaciente: payload.setPaciente }));
