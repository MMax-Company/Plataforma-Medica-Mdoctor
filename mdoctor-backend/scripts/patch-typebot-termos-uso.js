/**
 * Corrige apenas o bloco Termos de uso no Typebot Doctor Prescreve.
 *
 * - Substitui "taxa de avaliação médica" por pagamento da consulta médica (gate)
 * - Apresenta 5 documentos com título separado do link
 * - Opções: "Li e concordo" / "Não concordo"
 * - Preserva variáveis, rotas de aceite e integrações existentes
 *
 * Uso:
 *   node patch-typebot-termos-uso.js --local
 *   TYPEBOT_API_TOKEN=*** node patch-typebot-termos-uso.js
 */
const fs = require('fs');
const path = require('path');

const TYPEBOT_ID = 'higij2z0xihxxkr378rmljgu';
const GROUP_TERMS_ID = 'grp_termos_uso';
const GROUP_GATE_ID = 'grp_gate_pagamento';
const GROUP_TERMS_DECLINE_ID = 'grp_termos_decline';
const INTRO_BLOCK_ID = 'blk_terms_intro';
const DOCS_BLOCK_ID = 'blk_terms_doc';
const CHOICE_BLOCK_ID = 'blk_terms_choice';
const GATE_TEXT_BLOCK_ID = 'blk_gate_txt';
const VAR_TERMS = 'var_gzc2gcsu';
const CHOICE_ACCEPT = 'Li e concordo';
const CHOICE_DECLINE = 'Não concordo';
const GATE_TEXT =
  'Triagem aprovada. Leia os termos antes do pagamento da consulta médica.';

const TERMS_DOC_SPECS = [
  { label: 'Termos de Uso', file: 'Politica_e_termos_de_uso_Doctor_Prescreve.pdf' },
  { label: 'Política de Privacidade', file: 'Politica_de_Privacidade_Doctor_Prescreve.pdf' },
  {
    label: 'Política de Cancelamento e Reembolso',
    file: 'Politica_de_Cancelamento_e_Reembolso_Doctor_Prescreve.pdf'
  },
  { label: 'Política da Prescrição', file: 'Politica_da_Prescricao_Doctor_Prescreve.pdf' },
  { label: 'Aviso de Não Urgência e Emergência', file: 'Aviso_Nao_Urgencia_Emergencia.pdf' }
];

const LOCAL_FILES = [
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-homologado-20260716.json'),
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json'),
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json')
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function detectStorageBase(typebot) {
  const privacyUrl =
    'https://usihurogvphtjedyhyfl.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/Politica_de_Privacidade_Doctor_Prescreve.pdf';
  const serialized = JSON.stringify(typebot);
  const match = serialized.match(
    /(https:\/\/[^"]+\/storage\/v1\/object\/public\/[^/]+\/)Politica_de_Privacidade_Doctor_Prescreve\.pdf/
  );
  return match ? match[1] : privacyUrl.replace('Politica_de_Privacidade_Doctor_Prescreve.pdf', '');
}

function buildDocRichText(baseUrl) {
  return TERMS_DOC_SPECS.map((doc, index) => ({
    id: `p_terms_doc_${index}`,
    type: 'p',
    children: [
      { text: '📄 ' },
      {
        url: `${baseUrl}${doc.file}`,
        type: 'a',
        target: '_blank',
        children: [{ text: doc.label }]
      }
    ]
  }));
}

function ensureTermsDeclineGroup(typebot) {
  let group = typebot.groups.find((g) => g.id === GROUP_TERMS_DECLINE_ID);
  if (group) return group;

  group = {
    id: GROUP_TERMS_DECLINE_ID,
    title: 'Encerramento termos',
    graphCoordinates: { x: -2900, y: -1650 },
    blocks: [
      {
        id: 'blk_termos_decline_txt',
        type: 'text',
        content: {
          richText: [
            {
              id: 'p_terms_decline_0',
              type: 'p',
              children: [
                {
                  text: 'Tudo bem. Sem o aceite dos termos de uso não é possível seguir com a avaliação médica.'
                }
              ]
            },
            {
              id: 'p_terms_decline_1',
              type: 'p',
              children: [
                {
                  text: 'O atendimento foi encerrado e nenhuma cobrança foi realizada.'
                }
              ]
            },
            {
              id: 'p_terms_decline_2',
              type: 'p',
              children: [
                {
                  text: 'Se mudar de ideia, é só enviar uma nova mensagem por aqui.'
                }
              ]
            }
          ]
        }
      }
    ]
  };
  typebot.groups.push(group);
  return group;
}

function ensureDeclineEdge(typebot) {
  const edgeId = 'edge_terms_to_decline';
  if (typebot.edges.some((e) => e.id === edgeId)) return;

  typebot.edges.push({
    id: edgeId,
    from: {
      blockId: CHOICE_BLOCK_ID,
      itemId: 'terms_decline'
    },
    to: {
      groupId: GROUP_TERMS_DECLINE_ID,
      blockId: 'blk_termos_decline_txt'
    }
  });
}

function applyTermosPatch(typebot) {
  const t = clone(typebot);
  const baseUrl = detectStorageBase(t);

  const gateGroup = t.groups.find((g) => g.id === GROUP_GATE_ID);
  if (!gateGroup) throw new Error('grupo gate pagamento não encontrado');
  const gateText = gateGroup.blocks.find((b) => b.id === GATE_TEXT_BLOCK_ID);
  if (!gateText || gateText.type !== 'text') throw new Error('bloco gate texto não encontrado');
  gateText.content.richText = [
    {
      id: 'p_hr9ihtdz',
      type: 'p',
      children: [{ text: GATE_TEXT }]
    }
  ];

  const group = t.groups.find((g) => g.id === GROUP_TERMS_ID);
  if (!group) throw new Error('grupo Termos de uso não encontrado');

  const intro = group.blocks.find((b) => b.id === INTRO_BLOCK_ID);
  if (!intro || intro.type !== 'text') throw new Error('bloco intro termos não encontrado');
  intro.content.richText = [
    {
      id: 'p_l9gynbqu',
      type: 'p',
      children: [
        {
          text: 'Antes de realizar o pagamento, leia e aceite os termos de uso do Doctor Prescreve.'
        }
      ]
    },
    {
      id: 'p_terms_intro_docs',
      type: 'p',
      children: [{ text: 'Leia os documentos abaixo:' }]
    }
  ];

  const docs = group.blocks.find((b) => b.id === DOCS_BLOCK_ID);
  if (!docs || docs.type !== 'text') throw new Error('bloco docs termos não encontrado');
  docs.content.richText = buildDocRichText(baseUrl);

  const choice = group.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (!choice || choice.type !== 'choice input') throw new Error('choice input termos não encontrado');
  if (choice.options?.variableId !== VAR_TERMS) {
    throw new Error('variableId terms_of_use_accepted inesperado');
  }

  let accept = choice.items.find((i) => i.id === 'terms_agree');
  if (!accept) {
    accept = { id: 'terms_agree', outgoingEdgeId: 'edge_terms_to_accept', value: 'sim' };
    choice.items.unshift(accept);
  }
  accept.content = CHOICE_ACCEPT;
  accept.outgoingEdgeId = 'edge_terms_to_accept';

  let decline = choice.items.find((i) => i.id === 'terms_decline');
  if (!decline) {
    decline = { id: 'terms_decline', outgoingEdgeId: 'edge_terms_to_decline', value: 'nao' };
    choice.items.push(decline);
  }
  decline.content = CHOICE_DECLINE;
  decline.outgoingEdgeId = 'edge_terms_to_decline';

  ensureTermsDeclineGroup(t);
  ensureDeclineEdge(t);

  return t;
}

function blockFingerprint(groups) {
  const map = {};
  for (const group of groups) {
    for (const block of group.blocks) map[block.id] = JSON.stringify(block);
  }
  return map;
}

function validatePatch(before, after) {
  const errors = [];
  const beforeBlocks = blockFingerprint(before.groups);
  const afterBlocks = blockFingerprint(after.groups);
  const allowedChanged = new Set([
    GATE_TEXT_BLOCK_ID,
    INTRO_BLOCK_ID,
    DOCS_BLOCK_ID,
    CHOICE_BLOCK_ID,
    'blk_termos_decline_txt'
  ]);

  for (const [id, json] of Object.entries(afterBlocks)) {
    if (beforeBlocks[id] === json) continue;
    if (!allowedChanged.has(id)) errors.push('bloco alterado inesperado: ' + id);
  }

  if (JSON.stringify(before.variables) !== JSON.stringify(after.variables)) {
    errors.push('variáveis alteradas');
  }

  const beforeEdgeIds = new Set(before.edges.map((e) => e.id));
  for (const edge of after.edges) {
    if (beforeEdgeIds.has(edge.id)) continue;
    if (edge.id !== 'edge_terms_to_decline') errors.push('edge adicionada inesperada: ' + edge.id);
  }
  for (const edge of before.edges) {
    if (!after.edges.some((e) => e.id === edge.id)) errors.push('edge removida: ' + edge.id);
  }

  const termsVar = after.variables.find((v) => v.id === VAR_TERMS);
  if (!termsVar || termsVar.name !== 'terms_of_use_accepted') {
    errors.push('variável terms_of_use_accepted ausente ou renomeada');
  }

  const termsGroup = after.groups.find((g) => g.id === GROUP_TERMS_ID);
  const choice = termsGroup.blocks.find((b) => b.id === CHOICE_BLOCK_ID);
  if (choice.items.find((i) => i.id === 'terms_agree')?.content !== CHOICE_ACCEPT) {
    errors.push('opção de aceite incorreta');
  }
  if (choice.items.find((i) => i.id === 'terms_decline')?.content !== CHOICE_DECLINE) {
    errors.push('opção de recusa incorreta');
  }

  const gateGroup = after.groups.find((g) => g.id === GROUP_GATE_ID);
  const gateSerialized = JSON.stringify(gateGroup);
  if (gateSerialized.includes('taxa de avaliação médica')) {
    errors.push('texto taxa de avaliação médica ainda presente no gate');
  }
  if (!gateSerialized.includes('pagamento da consulta médica')) {
    errors.push('texto pagamento da consulta médica ausente no gate');
  }

  const docsSerialized = JSON.stringify(termsGroup.blocks.find((b) => b.id === DOCS_BLOCK_ID));
  for (const doc of TERMS_DOC_SPECS) {
    if (!docsSerialized.includes(doc.label)) errors.push('documento ausente: ' + doc.label);
  }

  if (errors.length) throw new Error(errors.join('; '));
}

function patchLocalFiles() {
  const report = [];
  for (const file of LOCAL_FILES) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) {
      report.push({ file: resolved, skipped: true, reason: 'not found' });
      continue;
    }
    const before = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const after = applyTermosPatch(before);
    validatePatch(before, after);
    fs.writeFileSync(resolved, JSON.stringify(after, null, 2) + '\n');
    report.push({ file: resolved, groups: after.groups.length, ok: true });
  }
  return report;
}

async function patchLiveTypebot() {
  const token = String(process.env.TYPEBOT_API_TOKEN || process.env.TYPEBOT_TOKEN || '').trim();
  if (!token) throw new Error('TYPEBOT_API_TOKEN ou TYPEBOT_TOKEN ausente');

  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').slice(0, 12);
  const backupDir = path.join(__dirname, '../../backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const beforeRes = await fetch(`https://app.typebot.io/api/v1/typebots/${TYPEBOT_ID}`, { headers });
  if (!beforeRes.ok) throw new Error('GET falhou: ' + (await beforeRes.text()).slice(0, 400));
  const beforePayload = await beforeRes.json();
  fs.writeFileSync(
    path.join(backupDir, `typebot-doctor-prescreve-antes-termos-${stamp}.json`),
    JSON.stringify(beforePayload, null, 2)
  );

  const before = beforePayload.typebot;
  const after = applyTermosPatch(before);
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

  return { success: true };
}

(async () => {
  if (process.argv.includes('--local')) {
    const report = patchLocalFiles();
    console.log(JSON.stringify({ mode: 'local', report }, null, 2));
    return;
  }

  const token = String(process.env.TYPEBOT_API_TOKEN || process.env.TYPEBOT_TOKEN || '').trim();
  if (!token) {
    const report = patchLocalFiles();
    console.log(
      JSON.stringify(
        {
          mode: 'local-only',
          note: 'TYPEBOT_API_TOKEN ausente; exports JSON atualizados no repo',
          report
        },
        null,
        2
      )
    );
    return;
  }

  const result = await patchLiveTypebot();
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error('ERRO', error.message);
  process.exit(1);
});
