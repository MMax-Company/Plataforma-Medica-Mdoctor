/**
 * Pedido 1 — correções estruturais do Typebot doctor-prescreve-8rmljgu
 * (ID interno higij2z0xihxxkr378rmljgu).
 *
 * Aplica sobre docs/typebot/typebot-doctor-prescreve-production.json:
 *  1. Declara variáveis usadas mas ausentes de variables[]:
 *     upload_check_action, upload_check_message, upload_completed,
 *     upload_status_url, nome_social (bloco "Nome social"), atendimentoId.
 *  2. Primeiro webhook: mapeia upload_status_url e atendimentoId
 *     (upload_url já era mapeado).
 *  3. Consulta de upload: método GET — o endpoint real de status
 *     (GET /api/upload-receita/:token/status) não aceita POST.
 *  4. Remove o salto automático do bloco do link "Enviar foto da receita"
 *     para o encerramento (pulava a pergunta "Já enviei a receita").
 *  5. Religa os itens "2" e "3" de Quantidade de medicamentos às suas
 *     próprias edges (edge_medcount_to_med1_b/_c ficavam órfãs).
 *  6. Remove as 3 edges mortas com from.blockId inexistente.
 *  8. Troca os values {{SIM}}/{{NÃO}} por sim/nao na Declaração de
 *     elegibilidade.
 *
 * Uso: node mdoctor-backend/scripts/patch-typebot-pedido1-estrutural.js
 */

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json');
const t = JSON.parse(fs.readFileSync(file, 'utf8'));
const changes = [];

function findBlock(blockId) {
  for (const group of t.groups) {
    const block = group.blocks.find((b) => b.id === blockId);
    if (block) return block;
  }
  throw new Error(`Bloco não encontrado: ${blockId}`);
}

// 1. Variáveis ausentes -------------------------------------------------
const missingVariables = [
  { id: 'var_upload_check_action', name: 'upload_check_action' },
  { id: 'var_upload_check_message', name: 'upload_check_message' },
  { id: 'var_upload_completed', name: 'upload_completed' },
  { id: 'var_upload_status_url', name: 'upload_status_url' },
  { id: 'vou30coxarhyas9y5q07k78k9', name: 'nome_social' },
  { id: 'var_atendimento_id', name: 'atendimentoId' }
];
for (const variable of missingVariables) {
  if (!t.variables.some((v) => v.id === variable.id)) {
    t.variables.push({ ...variable, isSessionVariable: false });
    changes.push(`variável declarada: ${variable.name} (${variable.id})`);
  }
}

// 2. Primeiro webhook: mapear upload_status_url e atendimentoId ---------
const firstWebhook = findBlock('axuwb907imxr22bqbnugj3ab');
const mapping = firstWebhook.options.responseVariableMapping;
const newMappings = [
  { id: 'map_upload_status_url', variableId: 'var_upload_status_url', bodyPath: 'upload_status_url' },
  { id: 'map_atendimento_id', variableId: 'var_atendimento_id', bodyPath: 'atendimentoId' }
];
for (const entry of newMappings) {
  if (!mapping.some((m) => m.bodyPath === entry.bodyPath)) {
    mapping.push(entry);
    changes.push(`primeiro webhook: mapeado ${entry.bodyPath} -> ${entry.variableId}`);
  }
}

// 3. Consulta de upload: GET no {{upload_status_url}} -------------------
const statusWebhook = findBlock('blk_upload_status_webhook');
if (statusWebhook.options.webhook.method !== 'GET') {
  statusWebhook.options.webhook.method = 'GET';
  changes.push('consulta de upload: método GET (endpoint de status é GET-only)');
}

// 4. Remover salto do link de upload para o encerramento ----------------
const fotoLink = findBlock('blk_foto_link');
if (fotoLink.outgoingEdgeId === 'edge_foto_link_to_end') {
  delete fotoLink.outgoingEdgeId;
  changes.push('removido outgoingEdgeId do bloco do link "Enviar foto da receita"');
}

// 5. Religar itens 2 e 3 da quantidade de medicamentos ------------------
const medCountChoice = findBlock('w97ho902ina4lg7b6dn0sycw');
const rewires = {
  a3tft76xm1j35grku3wi2wcr: 'edge_medcount_to_med1_b',
  tcxyvudqg1en4j05s0bby66i: 'edge_medcount_to_med1_c'
};
for (const item of medCountChoice.items) {
  const target = rewires[item.id];
  if (target && item.outgoingEdgeId !== target) {
    item.outgoingEdgeId = target;
    changes.push(`item "${item.content}" de Quantidade de medicamentos religado a ${target}`);
  }
}

// 6. Remover edges mortas/órfãs -----------------------------------------
const edgesToRemove = new Set([
  'gxvgai6wl7iwwc41d6lrrx6z',
  'fu2odekdi7zmcs9na14bkaks',
  'oeuocbgqpa3fmza0z9jrorm5',
  'edge_foto_link_to_end'
]);
const before = t.edges.length;
t.edges = t.edges.filter((e) => !edgesToRemove.has(e.id));
if (t.edges.length !== before) {
  changes.push(`edges removidas: ${before - t.edges.length} (${[...edgesToRemove].join(', ')})`);
}

// 8. {{SIM}}/{{NÃO}} -> sim/nao ------------------------------------------
for (const group of t.groups) {
  for (const block of group.blocks) {
    for (const item of block.items || []) {
      if (item.value === '{{SIM}}') {
        item.value = 'sim';
        changes.push(`item "${item.content}" (${group.title}): value {{SIM}} -> sim`);
      }
      if (item.value === '{{NÃO}}') {
        item.value = 'nao';
        changes.push(`item "${item.content}" (${group.title}): value {{NÃO}} -> nao`);
      }
    }
  }
}

// Validação de integridade ------------------------------------------------
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
  if (!referencedEdges.has(edge.id)) errors.push(`edge órfã (não referenciada): ${edge.id}`);
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
const walk = (node) => {
  if (!node || typeof node !== 'object') return;
  if (node.variableId && !varIds.has(node.variableId)) {
    errors.push(`variableId não declarado: ${node.variableId}`);
  }
  for (const key of Object.keys(node)) walk(node[key]);
};
for (const group of t.groups) walk(group.blocks);

if (errors.length) {
  console.error(JSON.stringify({ success: false, errors }, null, 2));
  process.exit(1);
}

fs.writeFileSync(file, `${JSON.stringify(t, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      success: true,
      changes,
      totals: {
        groups: t.groups.length,
        blocks: t.groups.reduce((acc, g) => acc + g.blocks.length, 0),
        variables: t.variables.length,
        edges: t.edges.length
      }
    },
    null,
    2
  )
);
