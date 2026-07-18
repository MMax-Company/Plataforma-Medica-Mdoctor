/**
 * Bloco 05 — Como deseja ser chamado:
 * - mantém pergunta de nome social (texto completo)
 * - salva em nome_social (variableId existente)
 * - remove pergunta "Qual a sua idade?" deste ponto
 * - após nome_social segue direto para o grupo 06 (idade vem de data_nascimento depois)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const GROUP_05 = 'mulxehkwbcrynjfjnji1g2jx';
const BLOCK_NOME_TXT = 'lhncf1mbxn3pgnxefufoz9bs';
const BLOCK_NOME_INPUT = 'oq3zsok0c2tdl3qamma8tush';
const VAR_NOME_SOCIAL = 'vou30coxarhyas9y5q07k78k9';
const EDGE_NOME_TO_06 = 'edge_idade_to_route';
const GROUP_06 = 'vo62j813iek8fjy0uoq0ttrc';
const QUESTION = 'Como você gostaria de ser chamado durante o atendimento?';

(async () => {
  const token = process.env.TYPEBOT_TOKEN || process.env.TYPEBOT_API_TOKEN;
  if (!token) throw new Error('TYPEBOT_TOKEN ou TYPEBOT_API_TOKEN ausente');
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const stamp = '20260718-1945';

  const g0 = await fetch('https://app.typebot.com/api/v1/typebots/higij2z0xihxxkr378rmljgu', { headers: H });
  console.log('GET antes HTTP', g0.status);
  if (g0.status !== 200) throw new Error(await g0.text());
  const before = await g0.json();
  fs.writeFileSync(path.join(ROOT, `backups/typebot-doctor-prescreve-antes-${stamp}.json`), JSON.stringify(before, null, 2));

  const t = JSON.parse(JSON.stringify(before.typebot));
  const g05 = t.groups.find((g) => g.id === GROUP_05);
  if (!g05) throw new Error('grupo 05 nao encontrado');

  const nomeTxt = g05.blocks.find((b) => b.id === BLOCK_NOME_TXT);
  const nomeInput = g05.blocks.find((b) => b.id === BLOCK_NOME_INPUT);
  if (!nomeTxt || !nomeInput) throw new Error('blocos de nome social nao encontrados');
  if (nomeInput.options.variableId !== VAR_NOME_SOCIAL) {
    throw new Error('variableId inesperado para nome_social: ' + nomeInput.options.variableId);
  }

  nomeTxt.content.richText[0].children[0].text = QUESTION;
  nomeInput.outgoingEdgeId = EDGE_NOME_TO_06;
  g05.blocks = g05.blocks.filter((b) => b.id !== 'blk_idade_txt' && b.id !== 'blk_idade_input');

  const edge = t.edges.find((e) => e.id === EDGE_NOME_TO_06);
  if (!edge) throw new Error('edge_idade_to_route ausente');
  edge.from = { blockId: BLOCK_NOME_INPUT };
  edge.to = { groupId: GROUP_06 };

  const beforeMap = {};
  const afterMap = {};
  before.typebot.groups.forEach((g) => g.blocks.forEach((b) => { beforeMap[b.id] = JSON.stringify(b); }));
  t.groups.forEach((g) => g.blocks.forEach((b) => { afterMap[b.id] = JSON.stringify(b); }));

  const changedBlocks = Object.keys(afterMap).filter((id) => beforeMap[id] !== afterMap[id]);
  const removedBlocks = Object.keys(beforeMap).filter((id) => !(id in afterMap));
  const expectedChanged = [BLOCK_NOME_TXT, BLOCK_NOME_INPUT].sort();
  const expectedRemoved = ['blk_idade_txt', 'blk_idade_input'].sort();
  if (changedBlocks.sort().join(',') !== expectedChanged.join(',')) {
    throw new Error('blocos alterados inesperados: ' + changedBlocks.join(','));
  }
  if (removedBlocks.sort().join(',') !== expectedRemoved.join(',')) {
    throw new Error('blocos removidos inesperados: ' + removedBlocks.join(','));
  }

  const edgeBefore = before.typebot.edges.find((e) => e.id === EDGE_NOME_TO_06);
  if (JSON.stringify(edge) === JSON.stringify(edgeBefore)) throw new Error('edge nao foi atualizada');

  const otherEdges = t.edges.filter((e) => e.id !== EDGE_NOME_TO_06);
  const otherEdgesBefore = before.typebot.edges.filter((e) => e.id !== EDGE_NOME_TO_06);
  if (JSON.stringify(otherEdges) !== JSON.stringify(otherEdgesBefore)) throw new Error('outras edges alteradas');
  if (JSON.stringify(t.variables) !== JSON.stringify(before.typebot.variables)) throw new Error('variaveis alteradas');

  const patch = await fetch('https://app.typebot.com/api/v1/typebots/higij2z0xihxxkr378rmljgu', {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ typebot: { version: t.version, groups: t.groups, edges: t.edges }, overwrite: true })
  });
  console.log('PATCH HTTP', patch.status);
  if (patch.status !== 200) { console.log((await patch.text()).slice(0, 800)); process.exit(1); }

  const pub = await fetch('https://app.typebot.com/api/v1/typebots/higij2z0xihxxkr378rmljgu/publish', { method: 'POST', headers: H });
  console.log('PUBLISH HTTP', pub.status);
  if (pub.status !== 200) { console.log((await pub.text()).slice(0, 800)); process.exit(1); }

  const g1 = await fetch('https://app.typebot.com/api/v1/typebots/higij2z0xihxxkr378rmljgu', { headers: H });
  console.log('GET depois HTTP', g1.status);
  const after = await g1.json();
  fs.writeFileSync(path.join(ROOT, `backups/typebot-doctor-prescreve-depois-${stamp}.json`), JSON.stringify(after, null, 2));

  const g05After = after.typebot.groups.find((g) => g.id === GROUP_05);
  const texts = JSON.stringify(g05After);
  console.log('pergunta atualizada:', texts.includes(QUESTION));
  console.log('idade removida do bloco 05:', !texts.includes('Qual a sua idade?'));
  console.log('nome_social preservado:', texts.includes(VAR_NOME_SOCIAL));
  console.log('edge vai ao grupo 06:', JSON.stringify(after.typebot.edges.find((e) => e.id === EDGE_NOME_TO_06).to) === JSON.stringify({ groupId: GROUP_06 }));
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
