/**
 * Corrige apenas o bloco Declaração de elegibilidade no Typebot Doctor Prescreve.
 *
 * - Substitui "renovação online" por consulta médica assíncrona
 * - Solicita confirmação dos 5 critérios clínicos
 * - Opções: Sim, confirmo / Não confirmo
 * - Preserva variáveis, item IDs, edges e roteamento existentes
 *
 * Env: TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN (obrigatório)
 */
const fs = require('fs');
const path = require('path');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const GROUP_ID = 'fni2p22kfg51hs6s6lhcteec';
const TEXT_BLOCK_ID = 'iw6zqwf26frmqnp1csxiwlbm';
const CHOICE_BLOCK_ID = 'w9v6g0rlkucnfmxc3qh2a2qt';
const ITEM_SIM_ID = 'bknghkx2o6o7415qlyvv1v2t';
const ITEM_NAO_ID = 'uve39ku5lajo21x78dl7i335';
const EDGE_SIM = 'sozjhxmnxly3ybh3jju1awa1';
const EDGE_NAO = 'obe3sg61navcvru4wpy68uan';

const INTRO =
  'De acordo com o protocolo clínico do Doctor Prescreve, para prosseguir com a consulta médica assíncrona, confirme que:';
const CRITERIA =
  '• Possui diagnóstico prévio\n• Está em uso contínuo há pelo menos 30 dias\n• Não apresenta sinais de alerta\n• As informações prestadas são verdadeiras\n• Tem ciência de que a emissão da receita depende da avaliação médica';

const p = (id, text) => ({ id, type: 'p', children: [{ text }] });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyDeclaracaoPatch(typebot) {
  const t = clone(typebot);
  const group = t.groups.find((g) => g.id === GROUP_ID);
  if (!group) throw new Error('grupo Declaração de elegibilidade não encontrado');

  const textBlock = group.blocks.find((b) => b.id === TEXT_BLOCK_ID);
  if (!textBlock) throw new Error('bloco de texto da declaração não encontrado');

  textBlock.content.richText = [
    p('6WsYxKKuUt', ''),
    p('m2reAU24hO', '📋 CRITÉRIOS DE ELEGIBILIDADE'),
    p('fPLnHqJsaD', ''),
    p('JnJaeLX7Eo', INTRO),
    p('3zW8U6K4V9', CRITERIA),
    p('gTCgPHpJhK', ''),
    p('mlJPr67d5j', '{{declaracao_elegibilidade}}')
  ];

  const choiceBlock = group.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (!choiceBlock || choiceBlock.type !== 'choice input') {
    throw new Error('choice input da declaração não encontrado');
  }

  const simItem = choiceBlock.items.find((item) => item.id === ITEM_SIM_ID);
  const naoItem = choiceBlock.items.find((item) => item.id === ITEM_NAO_ID);
  if (!simItem || !naoItem) throw new Error('itens Sim/Não da declaração não encontrados');

  simItem.content = 'Sim, confirmo';
  simItem.outgoingEdgeId = EDGE_SIM;
  naoItem.content = 'Não confirmo';
  naoItem.outgoingEdgeId = EDGE_NAO;

  return t;
}

function validatePatch(before, after) {
  const errors = [];
  const beforeGroup = before.groups.find((g) => g.id === GROUP_ID);
  const afterGroup = after.groups.find((g) => g.id === GROUP_ID);
  if (!afterGroup) errors.push('grupo da declaração ausente após patch');

  const beforeChoice = beforeGroup?.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  const afterChoice = afterGroup?.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (!afterChoice) errors.push('choice input ausente após patch');

  if (beforeChoice?.items?.length !== afterChoice?.items?.length) {
    errors.push('quantidade de opções alterada');
  }

  for (const item of afterChoice?.items || []) {
    if (item.id === ITEM_SIM_ID && item.outgoingEdgeId !== EDGE_SIM) {
      errors.push('edge Sim alterado');
    }
    if (item.id === ITEM_NAO_ID && item.outgoingEdgeId !== EDGE_NAO) {
      errors.push('edge Não alterado');
    }
  }

  const beforeFp = JSON.stringify(beforeGroup?.blocks?.filter((b) => b.id !== TEXT_BLOCK_ID && b.id !== CHOICE_BLOCK_ID));
  const afterFp = JSON.stringify(afterGroup?.blocks?.filter((b) => b.id !== TEXT_BLOCK_ID && b.id !== CHOICE_BLOCK_ID));
  if (beforeFp !== afterFp) errors.push('outros blocos do grupo foram alterados');

  const beforeEdges = JSON.stringify(
    before.edges.filter((edge) => edge.from?.blockId !== CHOICE_BLOCK_ID && edge.to?.groupId !== GROUP_ID)
  );
  const afterEdges = JSON.stringify(
    after.edges.filter((edge) => edge.from?.blockId !== CHOICE_BLOCK_ID && edge.to?.groupId !== GROUP_ID)
  );
  if (beforeEdges !== afterEdges) errors.push('edges fora do bloco foram alterados');

  const text = JSON.stringify(afterGroup?.blocks?.find((b) => b.id === TEXT_BLOCK_ID));
  if (!text.includes('consulta médica assíncrona')) errors.push('texto não contém consulta médica assíncrona');
  if (text.includes('renovação online')) errors.push('texto ainda contém renovação online');

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
    path.join(backupDir, `typebot-doctor-prescreve-antes-declaracao-${stamp}.json`),
    JSON.stringify(beforePayload, null, 2)
  );

  const before = beforePayload.typebot;
  const after = applyDeclaracaoPatch(before);
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
    path.join(backupDir, `typebot-doctor-prescreve-depois-declaracao-${stamp}.json`),
    JSON.stringify(afterPayload, null, 2)
  );

  const check = JSON.stringify(afterPayload.typebot);
  console.log(
    JSON.stringify(
      {
        success: true,
        introOk: check.includes(INTRO),
        criteriosOk: check.includes('consulta médica assíncrona') && check.includes('diagnóstico prévio'),
        opcoesOk: check.includes('"content":"Sim, confirmo"') && check.includes('"content":"Não confirmo"'),
        routingOk:
          afterPayload.typebot.edges.some((e) => e.id === EDGE_SIM) &&
          afterPayload.typebot.edges.some((e) => e.id === EDGE_NAO)
      },
      null,
      2
    )
  );
})().catch((error) => {
  console.error('ERRO', error.message);
  process.exit(1);
});
