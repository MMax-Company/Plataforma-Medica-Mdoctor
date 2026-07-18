/**
 * Ajuste do bloco 06 — Condições contempladas:
 * - pergunta e rótulos padronizados
 * - múltipla seleção com botão "Confirmar condições"
 * - remove bloco redundante "Enviar"
 * Nada mais é alterado (variáveis, rotas e integrações intactas).
 */
const fs = require('fs');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const GROUP_ID = 'vo62j813iek8fjy0uoq0ttrc';
const TEXT_BLOCK_ID = 'hda2dcvh33856qga899drcfi';
const CHOICE_BLOCK_ID = 'b156nm008xh7gb52n7w3egzn';
const ENVIAR_BLOCK_ID = 'pkodixot7oiiya9iknntuvz2';
const ROUTE_GROUP_ID = 'grp_route_condicoes';
const ROUTE_BLOCK_ID = 'blk_route_condicoes_cond';
const CONFIRM_EDGE_ID = 'edge_condicoes_confirm';
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

(async () => {
  const token = String(process.env.TYPEBOT_API_TOKEN || process.env.TYPEBOT_TOKEN || '').trim();
  if (!token) throw new Error('TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN ausente');

  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(0, 12);
  const g0 = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET antes HTTP', g0.status);
  if (!g0.ok) throw new Error('GET falhou: ' + (await g0.text()).slice(0, 400));
  const before = await g0.json();
  fs.writeFileSync(`backups/typebot-doctor-prescreve-antes-${stamp}.json`, JSON.stringify(before, null, 2));

  const t = JSON.parse(JSON.stringify(before.typebot));
  const g06 = t.groups.find((g) => g.id === GROUP_ID);
  if (!g06) throw new Error('grupo 06 não encontrado');

  const textBlock = g06.blocks.find((b) => b.id === TEXT_BLOCK_ID);
  if (!textBlock) throw new Error('bloco de texto não encontrado');
  textBlock.content.richText = [
    p('p_cond_saude_q', 'Para qual condição de saúde você utiliza medicamento contínuo? Você pode selecionar mais de uma opção.')
  ];

  const choice = g06.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (!choice || choice.type !== 'choice input') throw new Error('choice input não encontrado');
  for (const item of choice.items) {
    const label = LABELS[item.value];
    if (!label) throw new Error('value inesperado: ' + item.value);
    item.content = label;
    delete item.outgoingEdgeId;
  }
  choice.outgoingEdgeId = CONFIRM_EDGE_ID;
  choice.options.isMultipleChoice = true;
  choice.options.buttonLabel = 'Confirmar condições';

  const enviarIdx = g06.blocks.findIndex((b) => b.id === ENVIAR_BLOCK_ID);
  if (enviarIdx < 0) throw new Error('bloco Enviar redundante não encontrado');
  g06.blocks.splice(enviarIdx, 1);

  t.edges = t.edges.filter((e) => !ITEM_EDGE_IDS.includes(e.id) && e.id !== ENVIAR_EDGE_ID);
  if (t.edges.some((e) => e.id === CONFIRM_EDGE_ID)) throw new Error('edge de confirmação já existe');
  t.edges.push({
    id: CONFIRM_EDGE_ID,
    from: { blockId: CHOICE_BLOCK_ID },
    to: { groupId: ROUTE_GROUP_ID, blockId: ROUTE_BLOCK_ID }
  });

  if (t.resultsTablePreferences?.columnsOrder) {
    t.resultsTablePreferences.columnsOrder = t.resultsTablePreferences.columnsOrder.filter((id) => id !== ENVIAR_BLOCK_ID);
  }

  const beforeMap = {};
  const afterMap = {};
  before.typebot.groups.forEach((g) => g.blocks.forEach((b) => { beforeMap[b.id] = JSON.stringify(b); }));
  t.groups.forEach((g) => g.blocks.forEach((b) => { afterMap[b.id] = JSON.stringify(b); }));
  const changedBlocks = Object.keys(afterMap).filter((id) => beforeMap[id] !== afterMap[id]);
  const removedBlocks = Object.keys(beforeMap).filter((id) => !(id in afterMap));
  const expectedChanged = [TEXT_BLOCK_ID, CHOICE_BLOCK_ID].sort();
  if (changedBlocks.sort().join(',') !== expectedChanged.join(',')) {
    throw new Error('blocos alterados inesperados: ' + changedBlocks.join(',') + ' removidos: ' + removedBlocks.join(','));
  }
  if (removedBlocks.sort().join(',') !== ENVIAR_BLOCK_ID) {
    throw new Error('blocos removidos inesperados: ' + removedBlocks.join(','));
  }
  if (JSON.stringify(t.variables) !== JSON.stringify(before.typebot.variables)) throw new Error('variáveis alteradas');

  const routeGroup = t.groups.find((g) => g.id === ROUTE_GROUP_ID);
  if (!routeGroup || JSON.stringify(routeGroup) !== JSON.stringify(before.typebot.groups.find((g) => g.id === ROUTE_GROUP_ID))) {
    throw new Error('grupo de rota alterado');
  }

  const patch = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ typebot: { version: t.version, groups: t.groups, edges: t.edges, resultsTablePreferences: t.resultsTablePreferences }, overwrite: true })
  });
  console.log('PATCH HTTP', patch.status);
  if (!patch.ok) {
    console.log((await patch.text()).slice(0, 800));
    process.exit(1);
  }

  const pub = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}/publish`, { method: 'POST', headers: H });
  console.log('PUBLISH HTTP', pub.status);
  if (!pub.ok) {
    console.log((await pub.text()).slice(0, 800));
    process.exit(1);
  }

  const g1 = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers: H });
  console.log('GET depois HTTP', g1.status);
  const after = await g1.json();
  fs.writeFileSync(`backups/typebot-doctor-prescreve-depois-${stamp}.json`, JSON.stringify(after, null, 2));

  const check = JSON.stringify(after.typebot);
  const g06After = after.typebot.groups.find((g) => g.id === GROUP_ID);
  console.log('pergunta ok:', check.includes('Para qual condição de saúde você utiliza medicamento contínuo?'));
  console.log('botão ok:', check.includes('Confirmar condições'));
  console.log('enviar removido:', !g06After.blocks.some((b) => b.id === ENVIAR_BLOCK_ID));
  console.log('edge confirm ok:', after.typebot.edges.some((e) => e.id === CONFIRM_EDGE_ID));
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
