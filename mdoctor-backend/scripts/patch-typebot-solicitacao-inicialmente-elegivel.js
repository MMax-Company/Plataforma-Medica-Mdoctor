/**
 * Corrige apenas o bloco Solicitação inicialmente elegível no Typebot Doctor Prescreve.
 *
 * - Substitui mensagem com referência a pagamento imediato
 * - Preserva block ID, outgoingEdgeId, edges e variáveis do fluxo
 *
 * Env: TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN (obrigatório)
 */
const fs = require('fs');
const path = require('path');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const GROUP_ID = 'e84h0bt9n8hgrj4ut48h245l';
const TEXT_BLOCK_ID = 'xus8mt3l0wv32b84gv9tkihm';

const GROUP_TITLE = 'Solicitação inicialmente elegível';
const PARAGRAPHS = [
  'Sua triagem inicial atende aos critérios para continuar.',
  'Agora precisamos coletar seus dados e confirmar a existência de uma receita anterior.',
  'A aprovação definitiva e a emissão da receita dependerão da análise médica.'
];

const p = (id, text) => ({ id, type: 'p', children: [{ text }] });

function buildRichText() {
  const richText = [p('8XwmQWKlMp', PARAGRAPHS[0])];
  for (let i = 1; i < PARAGRAPHS.length; i += 1) {
    richText.push(p(`p_sol_eleg_blank_${i}`, ''));
    richText.push(p(`p_sol_eleg_${i + 1}`, PARAGRAPHS[i]));
  }
  return richText;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applySolicitacaoPatch(typebot) {
  const t = clone(typebot);
  const group = t.groups.find((g) => g.id === GROUP_ID);
  if (!group) throw new Error('grupo Solicitação inicialmente elegível não encontrado');

  group.title = GROUP_TITLE;

  const textBlock = group.blocks.find((b) => b.id === TEXT_BLOCK_ID);
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('bloco de texto da solicitação elegível não encontrado');
  }

  textBlock.content.richText = buildRichText();
  return t;
}

function validatePatch(before, after) {
  const errors = [];
  const beforeGroup = before.groups.find((g) => g.id === GROUP_ID);
  const afterGroup = after.groups.find((g) => g.id === GROUP_ID);
  if (!afterGroup) errors.push('grupo ausente após patch');

  const beforeBlock = beforeGroup?.blocks.find((b) => b.id === TEXT_BLOCK_ID);
  const afterBlock = afterGroup?.blocks.find((b) => b.id === TEXT_BLOCK_ID);
  if (!afterBlock) errors.push('bloco de texto ausente após patch');

  if (beforeBlock?.outgoingEdgeId !== afterBlock?.outgoingEdgeId) {
    errors.push('outgoingEdgeId alterado');
  }

  if (afterGroup?.blocks?.length !== beforeGroup?.blocks?.length) {
    errors.push('quantidade de blocos do grupo alterada');
  }

  if (JSON.stringify(before.variables) !== JSON.stringify(after.variables)) {
    errors.push('variáveis alteradas');
  }

  if (JSON.stringify(before.edges) !== JSON.stringify(after.edges)) {
    errors.push('edges alteradas');
  }

  const text = JSON.stringify(afterBlock);
  for (const paragraph of PARAGRAPHS) {
    if (!text.includes(paragraph)) errors.push(`texto não contém: ${paragraph}`);
  }
  if (text.includes('pagamento')) errors.push('texto ainda contém pagamento');
  if (text.includes('solicitacao_elegivel_pagamento')) {
    errors.push('placeholder de pagamento ainda presente');
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
    path.join(backupDir, `typebot-doctor-prescreve-antes-solicitacao-elegivel-${stamp}.json`),
    JSON.stringify(beforePayload, null, 2)
  );

  const before = beforePayload.typebot;
  const after = applySolicitacaoPatch(before);
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
    path.join(backupDir, `typebot-doctor-prescreve-depois-solicitacao-elegivel-${stamp}.json`),
    JSON.stringify(afterPayload, null, 2)
  );

  const check = JSON.stringify(afterPayload.typebot);
  console.log(
    JSON.stringify(
      {
        success: true,
        titleOk: check.includes(GROUP_TITLE),
        paragraphsOk: PARAGRAPHS.every((paragraph) => check.includes(paragraph)),
        noPagamento: !check.includes('solicitacao_elegivel_pagamento'),
        routingOk: afterPayload.typebot.edges.some((edge) => edge.id === 'edge_elegivel_to_dados')
      },
      null,
      2
    )
  );
})().catch((error) => {
  console.error('ERRO', error.message);
  process.exit(1);
});
