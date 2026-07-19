/**
 * Pedidos 1–5 — fluxo de receita anterior via WhatsApp (sem link externo).
 *
 * Aplica sobre docs/typebot/typebot-doctor-prescreve-production.json:
 *  1. Aguardando envio da receita: upload_status=pending, instruções WhatsApp, sem link.
 *  2. Conferir novamente: webhook GET por upload_status_url (atendimentoId no backend).
 *  3. Enviar novamente / Continuar depois no upload pendente.
 *  4. Upload confirmado: mensagem final e avanço sem opções de retry.
 *  5. bodyPath com prefixo data. (Typebot engine 3.17+).
 *
 * Uso: node mdoctor-backend/scripts/patch-typebot-receita-whatsapp-pedidos.js
 */

const fs = require('fs');
const path = require('path');

const file =
  process.env.TYPEBOT_FILE ||
  path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json');
const t = JSON.parse(fs.readFileSync(file, 'utf8'));
const changes = [];

function findGroup(groupId) {
  const group = t.groups.find((g) => g.id === groupId);
  if (!group) throw new Error(`Grupo não encontrado: ${groupId}`);
  return group;
}

function findBlock(blockId) {
  for (const group of t.groups) {
    const block = group.blocks.find((b) => b.id === blockId);
    if (block) return block;
  }
  throw new Error(`Bloco não encontrado: ${blockId}`);
}

function richParagraph(id, text) {
  return {
    id,
    type: 'p',
    children: [{ text }]
  };
}

function ensureVariable(variable) {
  if (!t.variables.some((v) => v.id === variable.id)) {
    t.variables.push({ ...variable, isSessionVariable: false });
    changes.push(`variável declarada: ${variable.name}`);
  }
}

ensureVariable({ id: 'var_upload_status', name: 'upload_status' });

// Pedido 1 — Aguardando envio da receita ---------------------------------
const fotoGroup = findGroup('grp_foto_receita');
fotoGroup.title = 'Aguardando envio da receita';

const setPendingBlock = {
  id: 'blk_set_upload_pending',
  type: 'Set variable',
  options: {
    variableId: 'var_upload_status',
    expressionToEvaluate: 'pending'
  }
};

const fotoTxt = findBlock('blk_foto_txt');
fotoTxt.content = {
  richText: [
    richParagraph(
      'p_upload_intro_1',
      'Envie agora uma foto legível ou um arquivo em PDF da sua receita anterior.'
    ),
    richParagraph(
      'p_upload_intro_2',
      'O documento deve mostrar o nome do paciente, os medicamentos, as doses, a identificação do profissional e, quando disponível, a data de emissão.'
    ),
    richParagraph(
      'p_upload_intro_3',
      'Envie o arquivo diretamente nesta conversa do WhatsApp. Formatos aceitos: JPG, JPEG, PNG ou PDF (até 10 MB).'
    )
  ]
};

const fotoLink = findBlock('blk_foto_link');
fotoLink.content = {
  richText: [
    richParagraph(
      'p_upload_whatsapp_hint',
      'Quando terminar o envio, toque em "Conferir novamente" para validarmos o recebimento.'
    )
  ]
};
changes.push('Pedido 1: bloco Aguardando envio da receita atualizado (WhatsApp direto, upload_status pending)');

const uploadCheck = findBlock('blk_upload_check');
uploadCheck.items = [
  {
    id: 'upload_check_yes',
    outgoingEdgeId: 'edge_upload_check_request',
    content: 'Conferir novamente',
    value: 'check'
  }
];
delete uploadCheck.items.find?.(() => false);
changes.push('Pedido 1/3: opção inicial renomeada para Conferir novamente');

if (!fotoGroup.blocks.some((b) => b.id === 'blk_set_upload_pending')) {
  fotoGroup.blocks.unshift(setPendingBlock);
}

// Remover edge "Ainda não enviei" se existir
t.edges = t.edges.filter((edge) => edge.id !== 'edge_upload_check_wait');
changes.push('edge_upload_check_wait removida (sem link externo para voltar)');

// Pedido 3 — Conferir novamente ------------------------------------------
const statusGroup = findGroup('grp_upload_status_check');
statusGroup.title = 'Conferir novamente';

const statusWebhook = findBlock('blk_upload_status_webhook');
const statusMapping = statusWebhook.options.responseVariableMapping;
const mappingTargets = {
  upload_completed: 'var_upload_completed',
  upload_status: 'var_upload_status',
  message: 'var_upload_check_message',
  foto_receita_url: 'var_upload_url'
};
for (const [bodyPath, variableId] of Object.entries(mappingTargets)) {
  const prefixed = `data.${bodyPath}`;
  let entry = statusMapping.find((m) => m.bodyPath === prefixed || m.bodyPath === bodyPath);
  if (!entry && bodyPath === 'foto_receita_url') {
    entry = statusMapping.find((m) => m.bodyPath === 'data.upload_url' || m.bodyPath === 'upload_url');
  }
  if (entry) {
    entry.bodyPath = prefixed;
    entry.variableId = variableId;
  } else {
    statusMapping.push({
      id: `map_status_${bodyPath}`,
      variableId,
      bodyPath: prefixed
    });
  }
}
if (statusWebhook.options.webhook.method !== 'GET') {
  statusWebhook.options.webhook.method = 'GET';
}
changes.push('Pedido 3: webhook Conferir novamente consulta backend (data.* + upload_status)');

// Primeiro webhook — prefixo data. + upload_status -----------------------
const firstWebhook = findBlock('axuwb907imxr22bqbnugj3ab');
for (const entry of firstWebhook.options.responseVariableMapping) {
  if (!entry.bodyPath.startsWith('data.')) {
    entry.bodyPath = `data.${entry.bodyPath}`;
  }
}
const firstMappings = firstWebhook.options.responseVariableMapping;
if (!firstMappings.some((m) => m.bodyPath === 'data.upload_status')) {
  firstMappings.push({
    id: 'map_upload_status',
    variableId: 'var_upload_status',
    bodyPath: 'data.upload_status'
  });
}
changes.push('primeiro webhook: bodyPath data.* e upload_status mapeado');

// Pedido 4 — Enviar novamente / Continuar depois -------------------------
const pendingTxt = findBlock('blk_upload_pending_txt');
pendingTxt.content = {
  richText: [
    richParagraph('p_upload_pending_1', 'Ainda não localizamos o envio da receita neste atendimento.'),
    richParagraph(
      'p_upload_pending_2',
      'Envie agora uma foto legível ou um PDF da receita anterior nesta conversa do WhatsApp.'
    ),
    richParagraph(
      'p_upload_pending_3',
      'Formatos aceitos: JPG, JPEG, PNG ou PDF (até 10 MB). Depois, toque em "Conferir novamente".'
    )
  ]
};

const pendingChoice = findBlock('blk_upload_pending_choice');
pendingChoice.items = [
  {
    id: 'pending_retry',
    outgoingEdgeId: 'edge_pending_retry_to_status',
    content: 'Conferir novamente',
    value: 'check'
  },
  {
    id: 'pending_resend',
    outgoingEdgeId: 'edge_pending_resend_to_upload',
    content: 'Enviar novamente',
    value: 'retry'
  },
  {
    id: 'pending_continue_later',
    outgoingEdgeId: 'edge_pending_continue_later',
    content: 'Continuar depois',
    value: 'later'
  }
];
changes.push('Pedido 4: opções Enviar novamente e Continuar depois');

// Grupo Continuar depois
if (!t.groups.some((g) => g.id === 'grp_upload_continue_later')) {
  t.groups.push({
    id: 'grp_upload_continue_later',
    title: 'Continuar depois',
    graphCoordinates: { x: -4705, y: -1257.5 },
    blocks: [
      {
        id: 'blk_continue_set_pending',
        type: 'Set variable',
        options: {
          variableId: 'var_upload_status',
          expressionToEvaluate: 'pending'
        }
      },
      {
        id: 'blk_continue_txt',
        outgoingEdgeId: 'edge_continue_later_to_end',
        type: 'text',
        content: {
          richText: [
            richParagraph(
              'p_continue_later_1',
              'Seu atendimento {{atendimentoId}} foi salvo com status de envio pendente.'
            ),
            richParagraph(
              'p_continue_later_2',
              'Quando estiver pronto, envie a foto ou PDF da receita anterior nesta mesma conversa do WhatsApp.'
            ),
            richParagraph(
              'p_continue_later_3',
              'Formatos aceitos: JPG, JPEG, PNG ou PDF (até 10 MB). Depois, retome pelo botão "Conferir novamente".'
            )
          ]
        }
      }
    ]
  });
  changes.push('grupo Continuar depois criado');
}

// Edges pedido 4
t.edges = t.edges.filter((edge) => edge.id !== 'edge_pending_back_to_upload');
const edgeDefs = [
  {
    id: 'edge_pending_resend_to_upload',
    from: { blockId: 'blk_upload_pending_choice', itemId: 'pending_resend' },
    to: { groupId: 'grp_foto_receita', blockId: 'blk_foto_txt' }
  },
  {
    id: 'edge_pending_continue_later',
    from: { blockId: 'blk_upload_pending_choice', itemId: 'pending_continue_later' },
    to: { groupId: 'grp_upload_continue_later', blockId: 'blk_continue_set_pending' }
  },
  {
    id: 'edge_continue_later_to_end',
    from: { blockId: 'blk_continue_txt' },
    to: { groupId: 'jnbvtyzr1ffz4ff5n05a999k' }
  }
];
for (const edge of edgeDefs) {
  const idx = t.edges.findIndex((e) => e.id === edge.id);
  if (idx >= 0) t.edges[idx] = edge;
  else t.edges.push(edge);
}

// Pedido 5 — Upload confirmado -------------------------------------------
const confirmedGroup = findGroup('grp_upload_confirmed');
confirmedGroup.title = 'Upload confirmado';

const confirmedSetCompleted = {
  id: 'blk_set_upload_completed',
  type: 'Set variable',
  options: {
    variableId: 'var_upload_status',
    expressionToEvaluate: 'completed'
  }
};
const confirmedSetFlag = {
  id: 'blk_set_upload_completed_flag',
  type: 'Set variable',
  options: {
    variableId: 'var_upload_completed',
    expressionToEvaluate: 'true'
  }
};

const confirmedTxt = findBlock('blk_upload_confirmed_txt');
confirmedTxt.content = {
  richText: [
    richParagraph(
      'p_upload_confirmed_1',
      'Receita anterior recebida e vinculada ao seu atendimento.'
    ),
    richParagraph(
      'p_upload_confirmed_2',
      'Estamos realizando a conferência final das informações antes do encaminhamento para análise médica.'
    )
  ]
};

if (!confirmedGroup.blocks.some((b) => b.id === 'blk_set_upload_completed')) {
  confirmedGroup.blocks.unshift(confirmedSetCompleted, confirmedSetFlag);
}
changes.push('Pedido 5: Upload confirmado com mensagem final e upload_status=completed');

// Validação ---------------------------------------------------------------
const errors = [];
const varIds = new Set(t.variables.map((v) => v.id));
const edgeIds = new Set(t.edges.map((e) => e.id));
const blockIds = new Set();
const itemIds = new Set();
const groupIds = new Set(t.groups.map((g) => g.id));
const referencedEdges = new Set();

for (const group of t.groups) {
  for (const block of group.blocks) {
    blockIds.add(block.id);
    if (block.outgoingEdgeId) {
      referencedEdges.add(block.outgoingEdgeId);
      if (!edgeIds.has(block.outgoingEdgeId)) {
        errors.push(`outgoingEdgeId sem edge: ${block.outgoingEdgeId} (bloco ${block.id})`);
      }
    }
    for (const item of block.items || []) {
      itemIds.add(item.id);
      if (item.outgoingEdgeId) {
        referencedEdges.add(item.outgoingEdgeId);
        if (!edgeIds.has(item.outgoingEdgeId)) {
          errors.push(`outgoingEdgeId sem edge: ${item.outgoingEdgeId} (item ${item.id})`);
        }
      }
    }
  }
}
for (const event of t.events || []) {
  if (event.outgoingEdgeId) referencedEdges.add(event.outgoingEdgeId);
}
for (const edge of t.edges) {
  if (!referencedEdges.has(edge.id)) errors.push(`edge órfã: ${edge.id}`);
  if (edge.from.blockId && !blockIds.has(edge.from.blockId)) {
    errors.push(`edge ${edge.id}: from.blockId inexistente ${edge.from.blockId}`);
  }
  if (edge.from.itemId && !itemIds.has(edge.from.itemId)) {
    errors.push(`edge ${edge.id}: from.itemId inexistente ${edge.from.itemId}`);
  }
  if (!groupIds.has(edge.to.groupId)) {
    errors.push(`edge ${edge.id}: to.groupId inexistente ${edge.to.groupId}`);
  }
  if (edge.to.blockId && !blockIds.has(edge.to.blockId)) {
    errors.push(`edge ${edge.id}: to.blockId inexistente ${edge.to.blockId}`);
  }
}

if (errors.length) {
  console.error(JSON.stringify({ success: false, errors }, null, 2));
  process.exit(1);
}

fs.writeFileSync(file, `${JSON.stringify(t, null, 2)}\n`);
console.log(JSON.stringify({ success: true, changes, edges: t.edges.length, variables: t.variables.length }, null, 2));
