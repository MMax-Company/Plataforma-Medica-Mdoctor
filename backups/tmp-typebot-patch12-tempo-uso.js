/**
 * Ajuste do bloco 08 — Tempo de tratamento:
 * - nova pergunta
 * - opções renomeadas (Menos de 30 dias / Entre 30 dias e 6 meses / Mais de 6 meses)
 * - variável tempo_uso, item IDs, edges e roteamento intactos
 */
const fs = require('fs');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const GROUP_ID = 'wb0gci4696hfx2s63brqetda';
const TEXT_BLOCK_ID = 'ywvtj7i2mbjcqlb8jvz0oenu';
const CHOICE_BLOCK_ID = 'r0imrcgaiv1idzkykt891q4u';
const TEMPO_USO_VAR_ID = 'vjh7jdmbywryk1tn0a9hlw45o';

const QUESTION = 'Há quanto tempo você utiliza continuamente os medicamentos que deseja submeter à avaliação?';
const OPTIONS = [
  { id: 'xmfrlrnrkudcos98bnhilpao', edge: 'et9bxma730pvlnivvulwm8lf', content: 'Menos de 30 dias' },
  { id: 'cx6ben72fekewftf7h8miqz8', edge: 'a7ucrreigl4f1ol86ip3cpnh', content: 'Entre 30 dias e 6 meses' },
  { id: 'hutcuflvz2hyyp87t78n3jdr', edge: 'l698gx51k6igl8bnbhegq9iw', content: 'Mais de 6 meses' }
];

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
  const g08 = t.groups.find((g) => g.id === GROUP_ID);
  if (!g08) throw new Error('grupo 08 não encontrado');

  const textBlock = g08.blocks.find((b) => b.id === TEXT_BLOCK_ID);
  if (!textBlock) throw new Error('bloco de texto não encontrado');
  textBlock.content.richText = [p('p_tempo_uso_q', QUESTION)];

  const choice = g08.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (!choice || choice.type !== 'choice input') throw new Error('choice input não encontrado');
  if (choice.options?.variableId !== TEMPO_USO_VAR_ID) throw new Error('variableId tempo_uso inesperado');

  for (const opt of OPTIONS) {
    const item = choice.items.find((i) => i.id === opt.id);
    if (!item) throw new Error('item não encontrado: ' + opt.id);
    item.content = opt.content;
    if (item.outgoingEdgeId !== opt.edge) throw new Error('edge inesperada em ' + opt.id + ': ' + item.outgoingEdgeId);
  }

  if (g08.blocks.length !== 2) throw new Error('grupo 08 com blocos inesperados: ' + g08.blocks.length);

  const beforeMap = {};
  const afterMap = {};
  before.typebot.groups.forEach((g) => g.blocks.forEach((b) => { beforeMap[b.id] = JSON.stringify(b); }));
  t.groups.forEach((g) => g.blocks.forEach((b) => { afterMap[b.id] = JSON.stringify(b); }));
  const changedBlocks = Object.keys(afterMap).filter((id) => beforeMap[id] !== afterMap[id]);
  const expectedChanged = [TEXT_BLOCK_ID, CHOICE_BLOCK_ID].sort();
  if (changedBlocks.sort().join(',') !== expectedChanged.join(',')) {
    throw new Error('blocos alterados inesperados: ' + changedBlocks.join(','));
  }
  if (JSON.stringify(t.variables) !== JSON.stringify(before.typebot.variables)) throw new Error('variáveis alteradas');
  if (JSON.stringify(t.edges) !== JSON.stringify(before.typebot.edges)) throw new Error('edges alteradas');

  const patch = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ typebot: { version: t.version, groups: t.groups, edges: t.edges }, overwrite: true })
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
  console.log('pergunta ok:', check.includes(QUESTION));
  console.log('opcoes ok:', OPTIONS.every((o) => check.includes(o.content)));
  console.log('tempo_uso var ok:', after.typebot.variables.some((v) => v.id === TEMPO_USO_VAR_ID && v.name === 'tempo_uso'));
  console.log('edges ok:', OPTIONS.every((o) => after.typebot.edges.some((e) => e.id === o.edge)));
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
