/**
 * Corrige apenas o bloco 11 — Sinais de alerta no Typebot Doctor Prescreve.
 *
 * - Mantém a pergunta sim/não em has_warning_signs
 * - Sim → lista de sinais de alerta (11B)
 * - Não → consentimento de telemedicina
 * - Não altera outros blocos, variáveis, rotas ou integrações
 *
 * Env: TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN (obrigatório)
 */
const fs = require('fs');
const path = require('path');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const GROUP_SINAIS_ID = 'pjgm9a0jhn3awaa5vtmat7ko';
const TEXT_BLOCK_ID = 'su7HceVXWyTCzi2vv3m4QbK';
const CHOICE_BLOCK_ID = 's5VQGsVF4hQgziQsXVdwPDW';
const VAR_HAS_WARNING_SIGNS = 'var_7wa4675j';
const VAR_SINAIS_ALERTA = 'he7ry4ccuhoyy3k2p11ryeuc';
const GROUP_LISTA_ID = 'grp_sinais_lista';
const GROUP_TELE_ID = 'grp_telemedicina_consent';
const TELE_INTRO_BLOCK_ID = 'blk_tele_intro';
const GROUP_PRESENCIAL_ID = 'y3vfu7p0f987fe6f1n2zx2t4';
const OLD_CONDITION_BLOCK_ID = 'm8z8uqbq019x172jv0hev99r';
const OLD_ETAPA2_GROUP_ID = 'grp_sinais_etapa2';

const QUESTION =
  'Você apresenta atualmente algum sintoma importante ou alguma piora recente do seu estado de saúde?';
const LIST_QUESTION =
  'Quais destes sinais de alerta você apresenta? Selecione todos que se aplicam.';

const SYMPTOM_ITEMS = [
  { id: 'it_og22qc8c', content: 'Dor no peito', value: 'dor_peito' },
  { id: 'it_wbbj4nvy', content: 'Falta de ar', value: 'falta_ar' },
  { id: 'it_mnd00o3r', content: 'Desmaio', value: 'desmaio' },
  { id: 'it_im14r5sw', content: 'Febre alta persistente', value: 'febre' },
  { id: 'it_dbk5a6g7', content: 'Sangramento', value: 'sangramento' }
];

const EDGE_SIM_TO_LISTA = 'edge_warn_sim_to_lista';
const EDGE_NAO_TO_TELE = 'edge_warn_nao_to_tele';
const EDGE_LISTA_TO_PRESENCIAL = 'edge_sinais_lista_to_presencial';
const EDGES_TO_REMOVE = new Set([
  'edge_sinais1_to_etapa2',
  'z5cxy70co8qqk7o4a6abmx39',
  'edge_sinais_to_telemedicine',
  'o51d9l56lzldmzcuvc0jdg6y'
]);

const p = (id, text) => ({ id, type: 'p', children: [{ text }] });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function blockFingerprint(groups) {
  const map = {};
  for (const group of groups) {
    for (const block of group.blocks) map[block.id] = JSON.stringify(block);
  }
  return map;
}

function applySinaisPatch(typebot) {
  const t = clone(typebot);
  const groupSinais = t.groups.find((g) => g.id === GROUP_SINAIS_ID);
  if (!groupSinais) throw new Error('grupo 11 — Sinais de alerta não encontrado');

  const textBlock = groupSinais.blocks.find((b) => b.id === TEXT_BLOCK_ID);
  if (!textBlock) throw new Error('bloco de texto dos sinais não encontrado');
  textBlock.content.richText = [p('p_sinais_gate_q', QUESTION)];

  const choiceBlock = groupSinais.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (!choiceBlock || choiceBlock.type !== 'choice input') {
    throw new Error('choice input dos sinais não encontrado');
  }

  delete choiceBlock.outgoingEdgeId;
  choiceBlock.items = [
    {
      id: 'it_warn_sim',
      outgoingEdgeId: EDGE_SIM_TO_LISTA,
      content: 'Sim',
      value: 'true'
    },
    {
      id: 'it_warn_nao',
      outgoingEdgeId: EDGE_NAO_TO_TELE,
      content: 'Não',
      value: 'false'
    }
  ];
  choiceBlock.options = { variableId: VAR_HAS_WARNING_SIGNS };

  groupSinais.blocks = groupSinais.blocks.filter((b) => b.id !== OLD_CONDITION_BLOCK_ID);

  const listaIndex = t.groups.findIndex((g) => g.id === GROUP_LISTA_ID);
  const listaGroup = {
    id: GROUP_LISTA_ID,
    title: '11B — Lista de sinais de alerta',
    graphCoordinates: { x: -2820, y: -3470 },
    blocks: [
      {
        id: 'blk_sinais_lista_txt',
        type: 'text',
        content: { richText: [p('p_sinais_lista_q', LIST_QUESTION)] }
      },
      {
        id: 'blk_sinais_lista_choice',
        outgoingEdgeId: EDGE_LISTA_TO_PRESENCIAL,
        type: 'choice input',
        items: clone(SYMPTOM_ITEMS),
        options: { variableId: VAR_SINAIS_ALERTA, isMultipleChoice: true }
      }
    ]
  };
  if (listaIndex >= 0) t.groups[listaIndex] = listaGroup;
  else t.groups.push(listaGroup);

  t.groups = t.groups.filter((g) => g.id !== OLD_ETAPA2_GROUP_ID);

  t.edges = t.edges.filter((e) => !EDGES_TO_REMOVE.has(e.id));

  const edgeById = new Map(t.edges.map((e) => [e.id, e]));
  const upsertEdge = (edge) => {
    if (edgeById.has(edge.id)) Object.assign(edgeById.get(edge.id), edge);
    else {
      t.edges.push(edge);
      edgeById.set(edge.id, edge);
    }
  };

  upsertEdge({
    id: EDGE_SIM_TO_LISTA,
    from: { blockId: CHOICE_BLOCK_ID, itemId: 'it_warn_sim' },
    to: { groupId: GROUP_LISTA_ID }
  });
  upsertEdge({
    id: EDGE_NAO_TO_TELE,
    from: { blockId: CHOICE_BLOCK_ID, itemId: 'it_warn_nao' },
    to: { groupId: GROUP_TELE_ID, blockId: TELE_INTRO_BLOCK_ID }
  });
  upsertEdge({
    id: EDGE_LISTA_TO_PRESENCIAL,
    from: { blockId: 'blk_sinais_lista_choice' },
    to: { groupId: GROUP_PRESENCIAL_ID }
  });

  return t;
}

function validatePatch(before, after) {
  const errors = [];
  const beforeBlocks = blockFingerprint(before.groups);
  const afterBlocks = blockFingerprint(after.groups);

  const allowedChanged = new Set([
    TEXT_BLOCK_ID,
    CHOICE_BLOCK_ID,
    'blk_sinais_lista_txt',
    'blk_sinais_lista_choice'
  ]);
  const allowedRemoved = new Set([OLD_CONDITION_BLOCK_ID, 'blk_sinais2_txt', 'blk_sinais2_choice']);

  for (const [id, json] of Object.entries(afterBlocks)) {
    if (beforeBlocks[id] === json) continue;
    if (!allowedChanged.has(id)) errors.push('bloco alterado inesperado: ' + id);
  }
  for (const id of Object.keys(beforeBlocks)) {
    if (id in afterBlocks) continue;
    if (!allowedRemoved.has(id)) errors.push('bloco removido inesperado: ' + id);
  }

  const beforeGroupIds = new Set(before.groups.map((g) => g.id));
  const afterGroupIds = new Set(after.groups.map((g) => g.id));
  for (const id of afterGroupIds) {
    if (beforeGroupIds.has(id)) continue;
    if (id !== GROUP_LISTA_ID) errors.push('grupo adicionado inesperado: ' + id);
  }
  for (const id of beforeGroupIds) {
    if (afterGroupIds.has(id)) continue;
    if (id !== OLD_ETAPA2_GROUP_ID) errors.push('grupo removido inesperado: ' + id);
  }

  if (JSON.stringify(before.variables) !== JSON.stringify(after.variables)) {
    errors.push('variáveis alteradas');
  }

  const hasWarning = after.variables.find((v) => v.id === VAR_HAS_WARNING_SIGNS);
  if (!hasWarning || hasWarning.name !== 'has_warning_signs') {
    errors.push('variável has_warning_signs ausente ou renomeada');
  }

  const groupSinais = after.groups.find((g) => g.id === GROUP_SINAIS_ID);
  const choice = groupSinais.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (choice.options.variableId !== VAR_HAS_WARNING_SIGNS) {
    errors.push('gate não usa has_warning_signs');
  }

  const edgeSim = after.edges.find((e) => e.id === EDGE_SIM_TO_LISTA);
  const edgeNao = after.edges.find((e) => e.id === EDGE_NAO_TO_TELE);
  if (edgeSim?.to?.groupId !== GROUP_LISTA_ID) errors.push('Sim não direciona para lista');
  if (edgeNao?.to?.groupId !== GROUP_TELE_ID) errors.push('Não não direciona para telemedicina');

  if (groupSinais.blocks.some((b) => b.type === 'Condition')) {
    errors.push('bloco Condition ainda presente no grupo 11');
  }

  if (errors.length) throw new Error(errors.join('; '));
}

(async () => {
  const token = String(process.env.TYPEBOT_API_TOKEN || process.env.TYPEBOT_TOKEN || '').trim();
  if (!token) throw new Error('TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN ausente');

  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(0, 12);
  const backupDir = path.join(__dirname, '../../backups');

  const beforeRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers });
  if (!beforeRes.ok) throw new Error('GET falhou: ' + (await beforeRes.text()).slice(0, 400));
  const beforePayload = await beforeRes.json();
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(
    path.join(backupDir, `typebot-doctor-prescreve-antes-sinais-${stamp}.json`),
    JSON.stringify(beforePayload, null, 2)
  );

  const before = beforePayload.typebot;
  const after = applySinaisPatch(before);
  validatePatch(before, after);

  const patchRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      typebot: { version: after.version, groups: after.groups, edges: after.edges },
      overwrite: true
    })
  });
  console.log('PATCH HTTP', patchRes.status);
  if (!patchRes.ok) {
    console.log((await patchRes.text()).slice(0, 800));
    process.exit(1);
  }

  const publishRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}/publish`, {
    method: 'POST',
    headers
  });
  console.log('PUBLISH HTTP', publishRes.status);
  if (!publishRes.ok) {
    console.log((await publishRes.text()).slice(0, 800));
    process.exit(1);
  }

  const afterRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers });
  if (!afterRes.ok) throw new Error('GET pós-patch falhou');
  const afterPayload = await afterRes.json();
  fs.writeFileSync(
    path.join(backupDir, `typebot-doctor-prescreve-depois-sinais-${stamp}.json`),
    JSON.stringify(afterPayload, null, 2)
  );

  const check = JSON.stringify(afterPayload.typebot);
  console.log(
    JSON.stringify(
      {
        success: true,
        perguntaOk: check.includes(QUESTION),
        simNaoOk: check.includes('"content":"Sim"') && check.includes('"content":"Não"'),
        hasWarningSignsOk: check.includes('"name":"has_warning_signs"'),
        listaOk: check.includes(GROUP_LISTA_ID),
        telemedicinaOk: afterPayload.typebot.edges.some(
          (e) => e.id === EDGE_NAO_TO_TELE && e.to.groupId === GROUP_TELE_ID
        )
      },
      null,
      2
    )
  );
})().catch((error) => {
  console.error('ERRO', error.message);
  process.exit(1);
});
