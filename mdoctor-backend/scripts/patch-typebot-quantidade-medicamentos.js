/**
 * Bloco Quantidade de medicamentos (PR #21):
 * - nova pergunta e aviso de limite (até 3)
 * - opções renomeadas (1/2/3 medicamento(s))
 */
const fs = require('fs');
const path = require('path');

const IDS = {
  group: 'huh6fmizvv701t9u7hc2mult',
  text: 'ng82dao2u8yp3cyr8oopz1tt',
  choice: 'w97ho902ina4lg7b6dn0sycw',
  varMedCount: 'var_971mu6mb'
};

const QUESTION = 'Quantos medicamentos você deseja submeter à avaliação médica?';
const LIMIT_INFO = 'São permitidos até três medicamentos.';
const OPTIONS = [
  { id: 'l6ckgiezhwfz71q9ghzbr60o', edge: 'edge_medcount_to_med1', content: '1 medicamento', value: '1' },
  { id: 'a3tft76xm1j35grku3wi2wcr', edge: 'edge_medcount_to_med1_b', content: '2 medicamentos', value: '2' },
  { id: 'tcxyvudqg1en4j05s0bby66i', edge: 'edge_medcount_to_med1_c', content: '3 medicamentos', value: '3' }
];

const p = (id, text) => ({ id, type: 'p', children: [{ text }] });

function patchQuantidadeMedicamentos(bot) {
  const group = bot.groups.find((g) => g.id === IDS.group);
  if (!group) throw new Error('grupo Quantidade de medicamentos não encontrado');

  const textBlock = group.blocks.find((b) => b.id === IDS.text);
  const choice = group.blocks.find((b) => b.id === IDS.choice);
  if (!textBlock || !choice) throw new Error('blocos quantidade não encontrados');
  if (choice.options?.variableId !== IDS.varMedCount) {
    throw new Error('variableId medication_count inesperado');
  }

  textBlock.content.richText = [p('p_fgrh1thy', QUESTION), p('p_medcount_limit', LIMIT_INFO)];
  for (const opt of OPTIONS) {
    const item = choice.items.find((i) => i.id === opt.id);
    if (!item) throw new Error(`item não encontrado: ${opt.id}`);
    item.content = opt.content;
    if (item.value !== opt.value) throw new Error(`value inesperado em ${opt.id}`);
    if (item.outgoingEdgeId !== opt.edge) item.outgoingEdgeId = opt.edge;
  }
}

function patchFile(filePath) {
  const bot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  patchQuantidadeMedicamentos(bot);
  fs.writeFileSync(filePath, `${JSON.stringify(bot, null, 2)}\n`);
}

if (require.main === module) {
  const targets = process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json'),
        path.join(__dirname, '../../docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json')
      ];
  for (const file of targets) patchFile(path.resolve(file));
  console.log('patched:', targets.join(', '));
}

module.exports = { patchQuantidadeMedicamentos, IDS, QUESTION, LIMIT_INFO, OPTIONS };
