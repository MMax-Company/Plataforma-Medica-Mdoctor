/**
 * Bloco 06 — Condições de saúde (PR #9):
 * - pergunta padronizada
 * - múltipla seleção com "Confirmar condições"
 * - remove bloco redundante Enviar
 */
const fs = require('fs');
const path = require('path');

const IDS = {
  group: 'vo62j813iek8fjy0uoq0ttrc',
  text: 'hda2dcvh33856qga899drcfi',
  choice: 'b156nm008xh7gb52n7w3egzn',
  enviar: 'pkodixot7oiiya9iknntuvz2',
  routeGroup: 'grp_route_condicoes',
  routeBlock: 'blk_route_condicoes_cond',
  confirmEdge: 'edge_condicoes_confirm'
};

const ITEM_EDGE_IDS = [
  'pgeux31kjg8b7ss8ykbe3ch2',
  'nyirwftbyq8aj8qajdnpkwmi',
  'p0kmk7gs6uzib9r19os3cgau',
  'demyok91pa8xb0b2v2ocf37i'
];
const ENVIAR_EDGE_ID = 'tgxhrqdcze7k4enyrn4sqzqz';

const LABELS = {
  has: 'Hipertensão arterial',
  dm: 'Diabetes mellitus tipo 2',
  dlp: 'Colesterol ou triglicérides elevados',
  hipotireoidismo: 'Hipotireoidismo',
  nenhuma: 'Nenhuma dessas condições'
};

const p = (id, text) => ({ id, type: 'p', children: [{ text }] });

function patchCondicoesSaude(bot) {
  const group = bot.groups.find((g) => g.id === IDS.group);
  if (!group) throw new Error('grupo Condições de saúde não encontrado');

  const textBlock = group.blocks.find((b) => b.id === IDS.text);
  const choice = group.blocks.find((b) => b.id === IDS.choice);
  if (!textBlock || !choice) throw new Error('blocos condições não encontrados');

  textBlock.content.richText = [
    p(
      'p_cond_saude_q',
      'Para qual condição de saúde você utiliza medicamento contínuo? Você pode selecionar mais de uma opção.'
    )
  ];

  for (const item of choice.items) {
    const label = LABELS[item.value];
    if (!label) throw new Error(`value inesperado: ${item.value}`);
    item.content = label;
    delete item.outgoingEdgeId;
  }
  choice.outgoingEdgeId = IDS.confirmEdge;
  choice.options.isMultipleChoice = true;
  choice.options.buttonLabel = 'Confirmar condições';

  group.blocks = group.blocks.filter((b) => b.id !== IDS.enviar);

  bot.edges = (bot.edges || []).filter(
    (e) => !ITEM_EDGE_IDS.includes(e.id) && e.id !== ENVIAR_EDGE_ID
  );
  if (!bot.edges.some((e) => e.id === IDS.confirmEdge)) {
    bot.edges.push({
      id: IDS.confirmEdge,
      from: { blockId: IDS.choice },
      to: { groupId: IDS.routeGroup, blockId: IDS.routeBlock }
    });
  }

  if (bot.resultsTablePreferences?.columnsOrder) {
    bot.resultsTablePreferences.columnsOrder = bot.resultsTablePreferences.columnsOrder.filter(
      (id) => id !== IDS.enviar
    );
  }
}

function patchFile(filePath) {
  const bot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  patchCondicoesSaude(bot);
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

module.exports = { patchCondicoesSaude, IDS, LABELS };
