/**
 * Corrige apenas os blocos Medicamento 1, 2 e 3 no Typebot Doctor Prescreve.
 *
 * - Perguntas separadas: nome, dose/concentração, frequência e via
 * - Texto da pergunta antes de cada input (WhatsApp não envia só "Escolha uma opção")
 * - Opções de frequência e via conforme protocolo
 * - "Outra frequência" / "Outra via" abrem campo complementar
 * - Preserva med1_*, med2_* e med3_* (sem novas variáveis)
 *
 * Uso local:
 *   node scripts/patch-typebot-medicamentos.js
 *
 * Publicar (TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN):
 *   TYPEBOT_API_TOKEN=... node scripts/patch-typebot-medicamentos.js --publish
 */
const fs = require('fs');
const path = require('path');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';

const FREQUENCY_OPTIONS = [
  'uma vez ao dia',
  'duas vezes ao dia',
  'três vezes ao dia',
  'dias alternados',
  'uma vez por semana',
  'conforme necessidade',
  'outra frequência'
];

const ROUTE_OPTIONS = ['oral', 'subcutânea', 'inalatória', 'tópica', 'outra via'];

const MED_SLOTS = [
  {
    slot: 1,
    groupId: 'w1hv8mudb1upggxvd1rldzhy',
    introBlockId: 'blk_epa4gygz',
    nomeInputId: 'blk_xp763m78',
    doseInputId: 'blk_n5x21i7c',
    freqChoiceId: 'blk_yyroio7i',
    viaChoiceId: 'blk_nggi0xs0',
    nomeVarId: 'var_mx6kx9ou',
    doseVarId: 'var_qlugduhi',
    freqVarId: 'var_8uua327o',
    viaVarId: 'var_f58ysctc',
    exitEdgeId: 'edge_med1_to_route',
    exitTo: {
      groupId: 'grp_route_after_med1',
      blockId: 'grp_route_after_med1_cond'
    }
  },
  {
    slot: 2,
    groupId: 'o1xsvn2jsapc3r1p4uf33vor',
    introBlockId: 'blk_mikn1jnk',
    nomeInputId: 'blk_fjhq98ob',
    doseInputId: 'blk_e3e58xjk',
    freqChoiceId: 'blk_g7zx538s',
    viaChoiceId: 'blk_upxrgzun',
    nomeVarId: 'var_zwfpx9rs',
    doseVarId: 'var_r8ghfh11',
    freqVarId: 'var_mb5cid9v',
    viaVarId: 'var_gmomjnaw',
    exitEdgeId: 'edge_med2_to_route',
    exitTo: {
      groupId: 'grp_route_after_med2',
      blockId: 'grp_route_after_med2_cond'
    }
  },
  {
    slot: 3,
    groupId: 'iaurdgxvycgifdiuif84saz5',
    introBlockId: 'blk_f0osinc4',
    nomeInputId: 'blk_k8s4myef',
    doseInputId: 'blk_g0v3kz80',
    freqChoiceId: 'blk_mefdgbik',
    viaChoiceId: 'blk_gxda5jr4',
    nomeVarId: 'var_1qln31lh',
    doseVarId: 'var_8o8q2i2u',
    freqVarId: 'var_la7nbosl',
    viaVarId: 'var_6u0oxmee',
    exitEdgeId: 'edge_med3_to_foto',
    exitTo: {
      groupId: 'wupo36l29a2x66rh0bwf5yex'
    }
  }
];

const LOCAL_FILES = [
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json'),
  path.join(__dirname, '../../docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json')
];

const p = (id, text) => ({ id, type: 'p', children: [{ text }] });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function textBlock(id, text) {
  return { id, type: 'text', content: { richText: [p(`${id}_p`, text)] } };
}

function textInputBlock(id, variableId, placeholder) {
  return {
    id,
    type: 'text input',
    options: {
      labels: { placeholder, button: 'Enviar' },
      variableId
    }
  };
}

function buildMedicationBlocks(config) {
  const { slot, groupId } = config;
  const ids = {
    nomeQ: `blk_med${slot}_nome_q`,
    doseQ: `blk_med${slot}_dose_q`,
    freqQ: `blk_med${slot}_freq_q`,
    viaQ: `blk_med${slot}_via_q`,
    freqOutraQ: `blk_med${slot}_freq_outra_q`,
    freqOutraInput: `blk_med${slot}_freq_outra_in`,
    viaOutraQ: `blk_med${slot}_via_outra_q`,
    viaOutraInput: `blk_med${slot}_via_outra_in`
  };

  const freqOutraEdge = `edge_med${slot}_freq_outra`;
  const freqToViaEdge = `edge_med${slot}_freq_outra_to_via`;
  const viaOutraEdge = `edge_med${slot}_via_outra`;
  const viaOutraExitEdge = `edge_med${slot}_via_outra_exit`;

  const freqItems = FREQUENCY_OPTIONS.map((content, index) => {
    const item = {
      id: `it_med${slot}_freq_${index + 1}`,
      content
    };
    if (content === 'outra frequência') item.outgoingEdgeId = freqOutraEdge;
    return item;
  });

  const routeItems = ROUTE_OPTIONS.map((content, index) => {
    const item = {
      id: `it_med${slot}_via_${index + 1}`,
      content
    };
    if (content === 'outra via') item.outgoingEdgeId = viaOutraEdge;
    return item;
  });

  const blocks = [
    textBlock(config.introBlockId, `Medicamento ${slot} de {{medication_count}} — informe:`),
    textBlock(ids.nomeQ, 'Qual o nome do medicamento?'),
    textInputBlock(config.nomeInputId, config.nomeVarId, 'Nome do medicamento'),
    textBlock(ids.doseQ, 'Qual a dose ou concentração?'),
    textInputBlock(config.doseInputId, config.doseVarId, 'Dose ou concentração (ex.: 50 mg)'),
    textBlock(ids.freqQ, 'Qual a frequência de uso?'),
    {
      id: config.freqChoiceId,
      type: 'choice input',
      items: freqItems,
      options: { variableId: config.freqVarId }
    },
    textBlock(ids.viaQ, 'Qual a via de administração?'),
    {
      id: config.viaChoiceId,
      type: 'choice input',
      items: routeItems,
      options: { variableId: config.viaVarId },
      outgoingEdgeId: config.exitEdgeId
    },
    textBlock(ids.freqOutraQ, 'Informe a frequência:'),
    {
      id: ids.freqOutraInput,
      type: 'text input',
      outgoingEdgeId: freqToViaEdge,
      options: {
        labels: { placeholder: 'Descreva a frequência', button: 'Enviar' },
        variableId: config.freqVarId
      }
    },
    textBlock(ids.viaOutraQ, 'Informe a via de administração:'),
    {
      id: ids.viaOutraInput,
      type: 'text input',
      outgoingEdgeId: viaOutraExitEdge,
      options: {
        labels: { placeholder: 'Descreva a via', button: 'Enviar' },
        variableId: config.viaVarId
      }
    }
  ];

  const edges = [
    {
      id: freqOutraEdge,
      from: { blockId: config.freqChoiceId, itemId: freqItems.find((i) => i.content === 'outra frequência').id },
      to: { groupId, blockId: ids.freqOutraQ }
    },
    {
      id: freqToViaEdge,
      from: { blockId: ids.freqOutraInput },
      to: { groupId, blockId: ids.viaQ }
    },
    {
      id: viaOutraEdge,
      from: { blockId: config.viaChoiceId, itemId: routeItems.find((i) => i.content === 'outra via').id },
      to: { groupId, blockId: ids.viaOutraQ }
    },
    {
      id: viaOutraExitEdge,
      from: { blockId: ids.viaOutraInput },
      to: config.exitTo
    }
  ];

  return { blocks, edges, exitBlockIds: [config.viaChoiceId, ids.viaOutraInput] };
}

function applyMedicamentosPatch(typebot) {
  const t = clone(typebot);
  const newEdgeIds = new Set();
  const exitBlockIds = new Set();

  for (const config of MED_SLOTS) {
    const group = t.groups.find((g) => g.id === config.groupId);
    if (!group) throw new Error(`grupo Medicamento ${config.slot} não encontrado (${config.groupId})`);

    const built = buildMedicationBlocks(config);
    group.blocks = built.blocks;
    built.edges.forEach((edge) => newEdgeIds.add(edge.id));
    built.exitBlockIds.forEach((id) => exitBlockIds.add(id));

    const edgeById = new Map(t.edges.map((edge) => [edge.id, edge]));
    for (const edge of built.edges) {
      if (edgeById.has(edge.id)) Object.assign(edgeById.get(edge.id), edge);
      else {
        t.edges.push(edge);
        edgeById.set(edge.id, edge);
      }
    }

    const exitEdge = edgeById.get(config.exitEdgeId);
    if (!exitEdge) throw new Error(`edge de saída ausente: ${config.exitEdgeId}`);
    exitEdge.from = { blockId: config.viaChoiceId };
    exitEdge.to = config.exitTo;
  }

  t.edges = t.edges.filter((edge) => {
    const fromBlock = edge.from?.blockId;
    if (!fromBlock) return true;
    const slot = MED_SLOTS.find(
      (config) =>
        edge.id !== config.exitEdgeId
        && !newEdgeIds.has(edge.id)
        && [config.freqChoiceId, config.viaChoiceId, config.nomeInputId, config.doseInputId].includes(fromBlock)
    );
    return !slot;
  });

  return t;
}

function validatePatch(before, after) {
  const errors = [];
  if (JSON.stringify(before.variables) !== JSON.stringify(after.variables)) {
    errors.push('variáveis alteradas');
  }

  for (const name of ['med1_nome', 'med1_dose', 'med1_frequencia', 'med1_via', 'med2_nome', 'med3_via']) {
    if (!after.variables.some((v) => v.name === name)) errors.push(`variável ausente: ${name}`);
  }

  for (const config of MED_SLOTS) {
    const group = after.groups.find((g) => g.id === config.groupId);
    if (!group) {
      errors.push(`grupo med${config.slot} ausente`);
      continue;
    }

    const texts = group.blocks.filter((b) => b.type === 'text').map((b) => JSON.stringify(b.content));
    const joined = texts.join(' ');
    if (!joined.includes('Qual o nome do medicamento?')) errors.push(`med${config.slot}: pergunta nome ausente`);
    if (!joined.includes('Qual a dose ou concentração?')) errors.push(`med${config.slot}: pergunta dose ausente`);
    if (!joined.includes('Qual a frequência de uso?')) errors.push(`med${config.slot}: pergunta frequência ausente`);
    if (!joined.includes('Qual a via de administração?')) errors.push(`med${config.slot}: pergunta via ausente`);

    const freqChoice = group.blocks.find((b) => b.id === config.freqChoiceId);
    const viaChoice = group.blocks.find((b) => b.id === config.viaChoiceId);
    if (!freqChoice?.items?.some((i) => i.content === 'outra frequência')) {
      errors.push(`med${config.slot}: opção outra frequência ausente`);
    }
    if (!viaChoice?.items?.some((i) => i.content === 'outra via')) {
      errors.push(`med${config.slot}: opção outra via ausente`);
    }
    if (!FREQUENCY_OPTIONS.every((opt) => freqChoice?.items?.some((i) => i.content === opt))) {
      errors.push(`med${config.slot}: frequências incompletas`);
    }
    if (!ROUTE_OPTIONS.every((opt) => viaChoice?.items?.some((i) => i.content === opt))) {
      errors.push(`med${config.slot}: vias incompletas`);
    }

    const outraFreqItem = freqChoice.items.find((i) => i.content === 'outra frequência');
    const outraViaItem = viaChoice.items.find((i) => i.content === 'outra via');
    if (!after.edges.some((e) => e.from?.itemId === outraFreqItem.id)) {
      errors.push(`med${config.slot}: edge outra frequência ausente`);
    }
    if (!after.edges.some((e) => e.from?.itemId === outraViaItem.id)) {
      errors.push(`med${config.slot}: edge outra via ausente`);
    }
  }

  const beforeGroupIds = new Set(before.groups.map((g) => g.id));
  const afterGroupIds = new Set(after.groups.map((g) => g.id));
  for (const id of afterGroupIds) {
    if (!beforeGroupIds.has(id)) errors.push(`grupo adicionado inesperado: ${id}`);
  }
  for (const id of beforeGroupIds) {
    if (!afterGroupIds.has(id)) errors.push(`grupo removido inesperado: ${id}`);
  }

  if (errors.length) throw new Error(errors.join('; '));
}

function patchLocalFile(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    console.warn('arquivo não encontrado, ignorando:', absolute);
    return null;
  }
  const before = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const payload = before.typebot || before;
  const after = applyMedicamentosPatch(payload);
  validatePatch(payload, after);
  const output = before.typebot ? { ...before, typebot: after } : after;
  fs.writeFileSync(absolute, `${JSON.stringify(output, null, 2)}\n`);
  return absolute;
}

async function publishToTypebot(token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const backupDir = path.join(__dirname, '../../backups');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(0, 12);

  const beforeRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers });
  if (!beforeRes.ok) throw new Error(`GET falhou: ${(await beforeRes.text()).slice(0, 400)}`);
  const beforePayload = await beforeRes.json();
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(
    path.join(backupDir, `typebot-doctor-prescreve-antes-medicamentos-${stamp}.json`),
    JSON.stringify(beforePayload, null, 2)
  );

  const before = beforePayload.typebot;
  const after = applyMedicamentosPatch(before);
  validatePatch(before, after);

  const patchRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      typebot: { version: after.version, groups: after.groups, edges: after.edges },
      overwrite: true
    })
  });
  if (!patchRes.ok) throw new Error(`PATCH falhou: ${(await patchRes.text()).slice(0, 800)}`);

  const publishRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}/publish`, {
    method: 'POST',
    headers
  });
  if (!publishRes.ok) throw new Error(`PUBLISH falhou: ${(await publishRes.text()).slice(0, 800)}`);

  const afterRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers });
  if (!afterRes.ok) throw new Error('GET pós-patch falhou');
  const afterPayload = await afterRes.json();
  fs.writeFileSync(
    path.join(backupDir, `typebot-doctor-prescreve-depois-medicamentos-${stamp}.json`),
    JSON.stringify(afterPayload, null, 2)
  );

  return {
    published: true,
    perguntaNomeOk: JSON.stringify(afterPayload.typebot).includes('Qual o nome do medicamento?'),
    frequenciasOk: FREQUENCY_OPTIONS.every((opt) => JSON.stringify(afterPayload.typebot).includes(opt)),
    viasOk: ROUTE_OPTIONS.every((opt) => JSON.stringify(afterPayload.typebot).includes(opt))
  };
}

async function main() {
  const publish = process.argv.includes('--publish');
  const updated = LOCAL_FILES.map(patchLocalFile).filter(Boolean);
  console.log(JSON.stringify({ localFilesUpdated: updated }, null, 2));

  if (!publish) return;

  const token = String(process.env.TYPEBOT_API_TOKEN || process.env.TYPEBOT_TOKEN || '').trim();
  if (!token) throw new Error('TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN ausente para --publish');
  const result = await publishToTypebot(token);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error('ERRO', error.message);
    process.exit(1);
  });
}

module.exports = {
  FREQUENCY_OPTIONS,
  ROUTE_OPTIONS,
  MED_SLOTS,
  applyMedicamentosPatch,
  buildMedicationBlocks,
  validatePatch
};
