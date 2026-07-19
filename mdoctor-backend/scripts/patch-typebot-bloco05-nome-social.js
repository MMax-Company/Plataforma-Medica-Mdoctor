/**
 * Bloco 05 — Nome social (PR #13):
 * - pergunta apenas nome social (sem idade)
 * - salva em nome_social (variableId existente)
 * - remove blocos de idade quando presentes no export
 * - após nome_social segue direto para o grupo 06
 */
const fs = require('fs');
const path = require('path');

const IDS = {
  group05: 'mulxehkwbcrynjfjnji1g2jx',
  nomeTxt: 'lhncf1mbxn3pgnxefufoz9bs',
  nomeInput: 'oq3zsok0c2tdl3qamma8tush',
  varNomeSocial: 'vou30coxarhyas9y5q07k78k9',
  group06: 'vo62j813iek8fjy0uoq0ttrc',
  idadeTxt: 'blk_idade_txt',
  idadeInput: 'blk_idade_input',
  edgeTo06: 'edge_idade_to_route',
  edgeTo06Fallback: 'whhjc7rr0vzetkkpuxlgr57d'
};

const QUESTION = 'Como você gostaria de ser chamado durante o atendimento?';
const PLACEHOLDER = 'Exemplo: José Souza.';

function upsertEdge(bot, edge) {
  bot.edges = bot.edges || [];
  const idx = bot.edges.findIndex((e) => e.id === edge.id);
  if (idx >= 0) bot.edges[idx] = edge;
  else bot.edges.push(edge);
}

function patchBloco05NomeSocial(bot) {
  const group05 = bot.groups.find((g) => g.id === IDS.group05);
  if (!group05) throw new Error('grupo 05 (Nome social) não encontrado');

  const nomeTxt = group05.blocks.find((b) => b.id === IDS.nomeTxt);
  const nomeInput = group05.blocks.find((b) => b.id === IDS.nomeInput);
  if (!nomeTxt || !nomeInput) throw new Error('blocos de nome social não encontrados');
  if (nomeInput.options.variableId !== IDS.varNomeSocial) {
    throw new Error(`variableId inesperado para nome_social: ${nomeInput.options.variableId}`);
  }

  nomeTxt.content.richText[0].children[0].text = QUESTION;
  nomeInput.options.labels = nomeInput.options.labels || {};
  nomeInput.options.labels.placeholder = PLACEHOLDER;

  const hadIdadeBlocks = group05.blocks.some((b) => b.id === IDS.idadeTxt || b.id === IDS.idadeInput);
  group05.blocks = group05.blocks.filter((b) => b.id !== IDS.idadeTxt && b.id !== IDS.idadeInput);

  const edgeId = bot.edges.some((e) => e.id === IDS.edgeTo06)
    ? IDS.edgeTo06
    : IDS.edgeTo06Fallback;

  nomeInput.outgoingEdgeId = edgeId;
  upsertEdge(bot, {
    id: edgeId,
    from: { blockId: IDS.nomeInput },
    to: { groupId: IDS.group06 }
  });

  if (hadIdadeBlocks) {
    bot.edges = bot.edges.filter(
      (e) => !(e.from?.blockId === IDS.idadeInput || e.to?.blockId === IDS.idadeInput)
    );
  }

  const serialized = JSON.stringify(group05);
  if (/idade|anos/i.test(serialized)) {
    throw new Error('bloco 05 ainda referencia idade após patch');
  }
}

function patchFile(filePath) {
  const bot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  patchBloco05NomeSocial(bot);
  fs.writeFileSync(filePath, `${JSON.stringify(bot, null, 2)}\n`);
  return filePath;
}

if (require.main === module) {
  const files = process.argv.slice(2);
  const targets = files.length
    ? files
    : [
        path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json'),
        path.join(__dirname, '../../docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json')
      ];
  for (const file of targets) patchFile(path.resolve(file));
  console.log('patched:', targets.join(', '));
}

module.exports = { patchBloco05NomeSocial, IDS, QUESTION, PLACEHOLDER };
