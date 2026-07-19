/**
 * Bloco 08 — Tempo de tratamento (PR #8):
 * - nova pergunta
 * - opções renomeadas
 * - variável tempo_uso, item IDs, edges intactos
 */
const fs = require('fs');
const path = require('path');

const IDS = {
  group: 'wb0gci4696hfx2s63brqetda',
  text: 'ywvtj7i2mbjcqlb8jvz0oenu',
  choice: 'r0imrcgaiv1idzkykt891q4u',
  varTempoUso: 'vjh7jdmbywryk1tn0a9hlw45o'
};

const QUESTION =
  'Há quanto tempo você utiliza continuamente os medicamentos que deseja submeter à avaliação?';
const OPTIONS = [
  { id: 'xmfrlrnrkudcos98bnhilpao', edge: 'et9bxma730pvlnivvulwm8lf', content: 'Menos de 30 dias' },
  { id: 'cx6ben72fekewftf7h8miqz8', edge: 'a7ucrreigl4f1ol86ip3cpnh', content: 'Entre 30 dias e 6 meses' },
  { id: 'hutcuflvz2hyyp87t78n3jdr', edge: 'l698gx51k6igl8bnbhegq9iw', content: 'Mais de 6 meses' }
];

const p = (id, text) => ({ id, type: 'p', children: [{ text }] });

function patchTempoUso(bot) {
  const group = bot.groups.find((g) => g.id === IDS.group);
  if (!group) throw new Error('grupo Tempo de uso não encontrado');

  const textBlock = group.blocks.find((b) => b.id === IDS.text);
  const choice = group.blocks.find((b) => b.id === IDS.choice);
  if (!textBlock || !choice) throw new Error('blocos tempo de uso não encontrados');
  if (choice.options?.variableId !== IDS.varTempoUso) {
    throw new Error('variableId tempo_uso inesperado');
  }

  textBlock.content.richText = [p('p_tempo_uso_q', QUESTION)];
  for (const opt of OPTIONS) {
    const item = choice.items.find((i) => i.id === opt.id);
    if (!item) throw new Error(`item não encontrado: ${opt.id}`);
    item.content = opt.content;
    if (item.outgoingEdgeId !== opt.edge) {
      throw new Error(`edge inesperada em ${opt.id}: ${item.outgoingEdgeId}`);
    }
  }
}

function patchFile(filePath) {
  const bot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  patchTempoUso(bot);
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

module.exports = { patchTempoUso, IDS, QUESTION, OPTIONS };
