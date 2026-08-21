'use strict';

/**
 * Testes de regressão para normalizeConditions e normalizeCondition.
 * Roda sem framework: node scripts/test-normalize-conditions.js
 */

const assert = require('assert');
const { normalizeCondition, normalizeConditions } = require('../src/services/clinical-intelligence.service');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function eq(actual, expected, msg) {
  assert.deepStrictEqual(actual, expected, msg || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ─── normalizeCondition (singular — backward compat) ─────────────────────────
console.log('\nnormalizeCondition (singular):');

test('HAS — código curto', () => eq(normalizeCondition('has'), 'hipertensao'));
test('HAS — texto com acento', () => eq(normalizeCondition('Hipertensão Arterial'), 'hipertensao'));
test('HAS — pressao alta', () => eq(normalizeCondition('pressão alta'), 'hipertensao'));
test('DM2 — código curto', () => eq(normalizeCondition('dm'), 'diabetes_tipo_2'));
test('DM2 — dm2 uppercase', () => eq(normalizeCondition('DM2'), 'diabetes_tipo_2'));
test('DM2 — texto longo', () => eq(normalizeCondition('Diabetes Mellitus tipo 2'), 'diabetes_tipo_2'));
test('DLP — código curto', () => eq(normalizeCondition('dlp'), 'dislipidemia'));
test('DLP — colesterol', () => eq(normalizeCondition('Colesterol alto'), 'dislipidemia'));
test('DLP — triglicerídeos', () => eq(normalizeCondition('triglicerídeos'), 'dislipidemia'));
test('Hipotireoidismo — código completo', () => eq(normalizeCondition('hipotireoidismo'), 'hipotireoidismo'));
test('Hipotireoidismo — tireoide', () => eq(normalizeCondition('Tireoide'), 'hipotireoidismo'));
test('Hipotireoidismo — levotiroxina', () => eq(normalizeCondition('levotiroxina'), 'hipotireoidismo'));
test('Numérico 1 → HAS', () => eq(normalizeCondition('1'), 'hipertensao'));
test('Numérico 2 → DM2', () => eq(normalizeCondition('2'), 'diabetes_tipo_2'));
test('Numérico 3 → DLP', () => eq(normalizeCondition('3'), 'dislipidemia'));
test('Numérico 4 → Hipotireoidismo', () => eq(normalizeCondition('4'), 'hipotireoidismo'));
test('Desconhecido → renovacao_receita', () => eq(normalizeCondition('asma'), 'renovacao_receita'));
test('Vazio → renovacao_receita', () => eq(normalizeCondition(''), 'renovacao_receita'));

// ─── normalizeConditions (plural) ────────────────────────────────────────────
console.log('\nnormalizeConditions (plural):');

// Condição única
test('HAS única', () => eq(normalizeConditions('has'), ['hipertensao']));
test('DM2 única', () => eq(normalizeConditions('dm'), ['diabetes_tipo_2']));
test('DLP única', () => eq(normalizeConditions('dlp'), ['dislipidemia']));
test('Hipotireoidismo único', () => eq(normalizeConditions('hipotireoidismo'), ['hipotireoidismo']));

// Uppercase / acento
test('HAS uppercase', () => eq(normalizeConditions('HAS'), ['hipertensao']));
test('DM2 uppercase', () => eq(normalizeConditions('DM2'), ['diabetes_tipo_2']));
test('DLP uppercase', () => eq(normalizeConditions('DLP'), ['dislipidemia']));
test('Hipotireoidismo uppercase', () => eq(normalizeConditions('HIPOTIREOIDISMO'), ['hipotireoidismo']));
test('HAS com acento', () => eq(normalizeConditions('Hipertensão Arterial'), ['hipertensao']));
test('DM2 com acento', () => eq(normalizeConditions('Diabetes Mellitus'), ['diabetes_tipo_2']));
test('DLP triglicerídeos', () => eq(normalizeConditions('Triglicerídeos'), ['dislipidemia']));
test('Hipotireoidismo levotiroxina', () => eq(normalizeConditions('Levotiroxina'), ['hipotireoidismo']));

// Numérico múltiplo
test('Numérico 1,2', () => eq(normalizeConditions('1,2'), ['hipertensao', 'diabetes_tipo_2']));
test('Numérico 3,4', () => eq(normalizeConditions('3,4'), ['dislipidemia', 'hipotireoidismo']));
test('Numérico 1,2,3,4', () => eq(normalizeConditions('1,2,3,4'), ['hipertensao', 'diabetes_tipo_2', 'dislipidemia', 'hipotireoidismo']));

// HAS + DLP
test('HAS + DLP vírgula', () => eq(normalizeConditions('has, dlp'), ['hipertensao', 'dislipidemia']));
test('HAS + DLP sem espaço', () => eq(normalizeConditions('has,dlp'), ['hipertensao', 'dislipidemia']));
test('HAS + DLP uppercase', () => eq(normalizeConditions('HAS, DLP'), ['hipertensao', 'dislipidemia']));
test('HAS + DLP separador "e"', () => eq(normalizeConditions('HAS e DLP'), ['hipertensao', 'dislipidemia']));

// DM2 + Hipotireoidismo
test('DM2 + Hipotireoidismo vírgula', () => eq(normalizeConditions('dm, hipotireoidismo'), ['diabetes_tipo_2', 'hipotireoidismo']));
test('DM2 + Hipotireoidismo uppercase', () => eq(normalizeConditions('DM, Hipotireoidismo'), ['diabetes_tipo_2', 'hipotireoidismo']));
test('DM2 + Hipotireoidismo separador "e"', () => eq(normalizeConditions('dm e hipotireoidismo'), ['diabetes_tipo_2', 'hipotireoidismo']));

// Todas as quatro
test('HAS + DM2 + DLP + Hipotireoidismo', () => eq(
  normalizeConditions('has, dm, dlp, hipotireoidismo'),
  ['hipertensao', 'diabetes_tipo_2', 'dislipidemia', 'hipotireoidismo']
));
test('Todas — uppercase sem espaço', () => eq(
  normalizeConditions('HAS,DM,DLP,HIPOTIREOIDISMO'),
  ['hipertensao', 'diabetes_tipo_2', 'dislipidemia', 'hipotireoidismo']
));
test('Todas — numérico "1,2,3,4"', () => eq(
  normalizeConditions('1,2,3,4'),
  ['hipertensao', 'diabetes_tipo_2', 'dislipidemia', 'hipotireoidismo']
));

// Textos do script de teste real: "HAS e DLP"
test('"HAS e DLP" (formato de teste real)', () => {
  const result = normalizeConditions('HAS e DLP');
  assert(result.includes('hipertensao'), `deve incluir hipertensao: ${result}`);
  assert(result.includes('dislipidemia'), `deve incluir dislipidemia: ${result}`);
  eq(result.length, 2);
});

// Canônico armazenado (retrocompatibilidade de registros existentes)
test('Canônico armazenado "hipertensao,dislipidemia"', () => {
  const result = normalizeConditions('hipertensao,dislipidemia');
  assert(result.includes('hipertensao'), `deve incluir hipertensao: ${result}`);
  assert(result.includes('dislipidemia'), `deve incluir dislipidemia: ${result}`);
  eq(result.length, 2);
});
test('Canônico único "hipertensao"', () => eq(normalizeConditions('hipertensao'), ['hipertensao']));
test('Canônico único "diabetes_tipo_2"', () => eq(normalizeConditions('diabetes_tipo_2'), ['diabetes_tipo_2']));

// Sem duplicatas
test('Sem duplicatas em entrada repetida', () => {
  const result = normalizeConditions('has, has, dlp');
  eq(result.length, 2);
  assert(result.includes('hipertensao'));
  assert(result.includes('dislipidemia'));
});

// Condição desconhecida
test('Desconhecido → ["renovacao_receita"]', () => eq(normalizeConditions('asma'), ['renovacao_receita']));
test('Vazio → []', () => eq(normalizeConditions(''), []));
test('Apenas espaços → []', () => eq(normalizeConditions('   '), []));

// ─── Retrocompatibilidade de chronic_condition ───────────────────────────────
// Verifica que normalizeChronicCondition mantém o contrato legado:
//   .normalized = primeira condição canônica (string, backward compat)
//   .conditions = array com TODAS as condições
//   .raw        = valor bruto do Typebot (preservado)
console.log('\nnormalizeChronicCondition — retrocompatibilidade:');

const { normalizeTypebotPayload } = require('../src/services/clinical-payload-normalizer.service');

function extractChronic(doencaInput) {
  const { normalized } = normalizeTypebotPayload({ doenca_cronica: doencaInput, chronic_condition: doencaInput });
  return {
    chronic_condition: normalized.chronic_condition,
    chronic_conditions: normalized.chronic_conditions,
    chronic_condition_label: normalized.chronic_condition_label
  };
}

test('HAS único — chronic_condition é string "hipertensao"', () => {
  const r = extractChronic('has');
  eq(typeof r.chronic_condition, 'string');
  eq(r.chronic_condition, 'hipertensao');
  eq(r.chronic_conditions, ['hipertensao']);
});

test('DM2 único — chronic_condition é string "diabetes_tipo_2"', () => {
  const r = extractChronic('dm');
  eq(r.chronic_condition, 'diabetes_tipo_2');
  eq(r.chronic_conditions, ['diabetes_tipo_2']);
});

test('HAS + DLP — chronic_condition = "hipertensao" (backward compat); chronic_conditions = ambas', () => {
  const r = extractChronic('has, dlp');
  eq(r.chronic_condition, 'hipertensao');                                  // legado preservado
  assert(Array.isArray(r.chronic_conditions), 'chronic_conditions deve ser array');
  assert(r.chronic_conditions.includes('hipertensao'), 'deve incluir hipertensao');
  assert(r.chronic_conditions.includes('dislipidemia'), 'deve incluir dislipidemia');
  eq(r.chronic_conditions.length, 2);
});

test('DM2 + Hipotireoidismo — chronic_condition = "diabetes_tipo_2"; chronic_conditions = ambas', () => {
  const r = extractChronic('dm, hipotireoidismo');
  eq(r.chronic_condition, 'diabetes_tipo_2');
  eq(r.chronic_conditions.length, 2);
  assert(r.chronic_conditions.includes('diabetes_tipo_2'));
  assert(r.chronic_conditions.includes('hipotireoidismo'));
});

test('Todas 4 — chronic_condition = "hipertensao"; chronic_conditions tem 4 itens', () => {
  const r = extractChronic('has, dm, dlp, hipotireoidismo');
  eq(r.chronic_condition, 'hipertensao');
  eq(r.chronic_conditions.length, 4);
});

test('chronic_condition_label preserva o raw "has, dlp"', () => {
  const r = extractChronic('has, dlp');
  eq(r.chronic_condition_label, 'has, dlp');
});

test('Legado armazenado "hipertensao" — chronic_condition mantém "hipertensao"', () => {
  const r = extractChronic('hipertensao');
  eq(r.chronic_condition, 'hipertensao');
  eq(r.chronic_conditions, ['hipertensao']);
});

// ─── Resultado ───────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultado: ${passed} passou, ${failed} falhou\n`);
if (failed > 0) process.exit(1);
