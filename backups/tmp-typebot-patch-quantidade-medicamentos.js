/**
 * Ajuste do bloco Quantidade de medicamentos:
 * - nova pergunta e aviso de limite (até 3)
 * - opções renomeadas (1/2/3 medicamento(s))
 * - variável medication_count, item IDs, values, edges e roteamento intactos
 */
const fs = require('fs');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const GROUP_ID = 'huh6fmizvv701t9u7hc2mult';
const TEXT_BLOCK_ID = 'ng82dao2u8yp3cyr8oopz1tt';
const CHOICE_BLOCK_ID = 'w97ho902ina4lg7b6dn0sycw';
const MEDICATION_COUNT_VAR_ID = 'var_971mu6mb';

const QUESTION = 'Quantos medicamentos você deseja submeter à avaliação médica?';
const LIMIT_INFO = 'São permitidos até três medicamentos.';
const OPTIONS = [
  { id: 'l6ckgiezhwfz71q9ghzbr60o', edge: 'edge_medcount_to_med1', content: '1 medicamento', value: '1' },
  { id: 'a3tft76xm1j35grku3wi2wcr', edge: 'edge_medcount_to_med1_b', content: '2 medicamentos', value: '2' },
  { id: 'tcxyvudqg1en4j05s0bby66i', edge: 'edge_medcount_to_med1_c', content: '3 medicamentos', value: '3' }
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
  const group = t.groups.find((g) => g.id === GROUP_ID);
  if (!group) throw new Error('grupo Quantidade de medicamentos não encontrado');

  const textBlock = group.blocks.find((b) => b.id === TEXT_BLOCK_ID);
  if (!textBlock) throw new Error('bloco de texto não encontrado');
  textBlock.content.richText = [p('p_fgrh1thy', QUESTION), p('p_medcount_limit', LIMIT_INFO)];

  const choice = group.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (!choice || choice.type !== 'choice input') throw new Error('choice input não encontrado');
  if (choice.options?.variableId !== MEDICATION_COUNT_VAR_ID) throw new Error('variableId medication_count inesperado');

  for (const opt of OPTIONS) {
    const item = choice.items.find((i) => i.id === opt.id);
    if (!item) throw new Error('item não encontrado: ' + opt.id);
    item.content = opt.content;
    if (item.value !== opt.value) throw new Error('value inesperado em ' + opt.id + ': ' + item.value);
    if (item.outgoingEdgeId !== opt.edge) throw new Error('edge inesperada em ' + opt.id + ': ' + item.outgoingEdgeId);
  }

  if (group.blocks.length !== 2) throw new Error('grupo com blocos inesperados: ' + group.blocks.length);

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
  console.log('limite ok:', check.includes(LIMIT_INFO));
  console.log('opcoes ok:', OPTIONS.every((o) => check.includes(o.content)));
  console.log('medication_count var ok:', after.typebot.variables.some((v) => v.id === MEDICATION_COUNT_VAR_ID && v.name === 'medication_count'));
  console.log('edges ok:', OPTIONS.every((o) => after.typebot.edges.some((e) => e.id === o.edge)));
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
