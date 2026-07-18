const fs = require('fs');
const path = require('path');
const {
  applyMedicamentosPatch,
  FREQUENCY_OPTIONS,
  ROUTE_OPTIONS,
  validatePatch
} = require('./patch-typebot-medicamentos');

const filePath = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
const bot = JSON.parse(fs.readFileSync(filePath, 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const before = bot;
const after = applyMedicamentosPatch(before);
validatePatch(before, after);

for (const slot of [1, 2, 3]) {
  const group = after.groups.find((g) => g.title === `Medicamento ${slot}`);
  assert(group, `Medicamento ${slot} ausente`);

  const textBlocks = group.blocks.filter((b) => b.type === 'text');
  const questions = textBlocks.map((b) => JSON.stringify(b.content)).join('\n');
  assert(questions.includes('Qual o nome do medicamento?'), `med${slot} nome`);
  assert(questions.includes('Qual a dose ou concentração?'), `med${slot} dose`);
  assert(questions.includes('Qual a frequência de uso?'), `med${slot} freq`);
  assert(questions.includes('Qual a via de administração?'), `med${slot} via`);
  assert(questions.includes('Informe a frequência:'), `med${slot} freq outra`);
  assert(questions.includes('Informe a via de administração:'), `med${slot} via outra`);

  const freqVar = after.variables.find((v) => v.name === `med${slot}_frequencia`);
  const viaVar = after.variables.find((v) => v.name === `med${slot}_via`);
  const freqChoice = group.blocks.find(
    (b) => b.type === 'choice input' && b.options?.variableId === freqVar.id
  );
  const viaChoice = group.blocks.find(
    (b) => b.type === 'choice input' && b.options?.variableId === viaVar.id
  );
  assert(viaVar?.name === `med${slot}_via`, `med${slot} var via`);

  assert(FREQUENCY_OPTIONS.every((opt) => freqChoice.items.some((i) => i.content === opt)), `med${slot} freq options`);
  assert(ROUTE_OPTIONS.every((opt) => viaChoice.items.some((i) => i.content === opt)), `med${slot} route options`);

  const nomeInput = group.blocks.find((b) => b.type === 'text input' && b.options.variableId === after.variables.find((v) => v.name === `med${slot}_nome`).id);
  const doseInput = group.blocks.find((b) => b.type === 'text input' && b.options.variableId === after.variables.find((v) => v.name === `med${slot}_dose`).id);
  const nomeIndex = group.blocks.indexOf(nomeInput);
  const doseIndex = group.blocks.indexOf(doseInput);
  assert(group.blocks[nomeIndex - 1]?.type === 'text', `med${slot} pergunta antes do nome`);
  assert(group.blocks[doseIndex - 1]?.type === 'text', `med${slot} pergunta antes da dose`);
}

assert(JSON.stringify(before.variables) === JSON.stringify(after.variables), 'variáveis preservadas');

console.log('patch-typebot-medicamentos: ok');
