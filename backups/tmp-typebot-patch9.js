/**
 * Pedido 9 — fluxo de suporte + perguntas finais pós-atendimento
 * sobre backups/typebot-doctor-prescreve-antes-20260718-1404.json.
 */
const fs = require('fs');
const path = require('path');

const backup = require('./typebot-doctor-prescreve-antes-20260718-1404.json');
const t = JSON.parse(JSON.stringify(backup.typebot));
const changes = [];

const p = (text) => ({ id: 'p_' + Math.random().toString(36).slice(2, 10), type: 'p', children: [{ text }] });
const findGroup = (id) => {
  const g = t.groups.find((g) => g.id === id);
  if (!g) throw new Error('grupo não encontrado: ' + id);
  return g;
};
const findBlock = (id) => {
  for (const g of t.groups) {
    const b = g.blocks.find((b) => b.id === id);
    if (b) return { group: g, block: b };
  }
  throw new Error('bloco não encontrado: ' + id);
};
const findEdge = (id) => {
  const e = t.edges.find((e) => e.id === id);
  if (!e) throw new Error('edge não encontrada: ' + id);
  return e;
};

// ==================== 1. Fluxo de suporte (Falar com o suporte)
{
  const gSuporte = findGroup('hwxhyusppqmf7d773ffg66c4');
  gSuporte.title = 'Suporte (fora do fluxo)';
  const txt = findBlock('ibgeg2r5znrytr0fkp0vr7wm').block;
  txt.outgoingEdgeId = 'edge_suporte_to_choice';
  txt.content.richText = [
    p('Você será atendido pela equipe de suporte do Doctor Prescreve.'),
    p('Descreva sua dúvida neste WhatsApp e nossa equipe retornará em breve.')
  ];
  gSuporte.blocks.push({
    id: 'blk_suporte_choice',
    type: 'choice input',
    items: [
      {
        id: 'item_suporte_menu',
        outgoingEdgeId: 'edge_suporte_to_menu',
        content: 'Voltar ao menu principal'
      },
      {
        id: 'item_suporte_encerrar',
        outgoingEdgeId: 'edge_suporte_to_encerrar',
        content: 'Encerrar'
      }
    ]
  });
  t.edges.push(
    { id: 'edge_suporte_to_choice', from: { blockId: 'ibgeg2r5znrytr0fkp0vr7wm' }, to: { groupId: 'hwxhyusppqmf7d773ffg66c4', blockId: 'blk_suporte_choice' } },
    { id: 'edge_suporte_to_menu', from: { blockId: 'blk_suporte_choice', itemId: 'item_suporte_menu' }, to: { groupId: 'kinRXxYop2X4d7F9qt8WNB', blockId: 'sbjZWLJGVkHAkDqS4JQeGow' } },
    { id: 'edge_suporte_to_encerrar', from: { blockId: 'blk_suporte_choice', itemId: 'item_suporte_encerrar' }, to: { groupId: 'y6vh28eodwchfvyk30311twg' } }
  );
  changes.push('1. Suporte: mensagem de atendimento pela equipe + opções Voltar ao menu principal / Encerrar (sem reiniciar consulta, cadastro ou pagamento)');
}

// ==================== 2. Perguntas finais pós-atendimento (grupo 42)
{
  const g42 = findGroup('bhrt6it0ud0teq3tw26q40ba');
  findBlock('raqkqz8ghhcf8bylhfuisbpb').block.outgoingEdgeId = 'edge_pos_atend_to_pergunta';
  g42.blocks.push(
    {
      id: 'blk_pos_atend_pergunta',
      outgoingEdgeId: 'edge_pos_atend_to_choice',
      type: 'text',
      content: { richText: [p('O que deseja fazer agora?')] }
    },
    {
      id: 'blk_pos_atend_choice',
      type: 'choice input',
      items: [
        {
          id: 'item_pos_encerrar',
          outgoingEdgeId: 'edge_pos_encerrar',
          content: 'Encerrar atendimento'
        },
        {
          id: 'item_pos_suporte',
          outgoingEdgeId: 'edge_pos_suporte',
          content: 'Falar com o suporte'
        }
      ]
    }
  );
  t.edges.push(
    { id: 'edge_pos_atend_to_pergunta', from: { blockId: 'raqkqz8ghhcf8bylhfuisbpb' }, to: { groupId: 'bhrt6it0ud0teq3tw26q40ba', blockId: 'blk_pos_atend_pergunta' } },
    { id: 'edge_pos_atend_to_choice', from: { blockId: 'blk_pos_atend_pergunta' }, to: { groupId: 'bhrt6it0ud0teq3tw26q40ba', blockId: 'blk_pos_atend_choice' } },
    { id: 'edge_pos_encerrar', from: { blockId: 'blk_pos_atend_choice', itemId: 'item_pos_encerrar' }, to: { groupId: 'grp_pos_atendimento_encerrar' } },
    { id: 'edge_pos_suporte', from: { blockId: 'blk_pos_atend_choice', itemId: 'item_pos_suporte' }, to: { groupId: 'hwxhyusppqmf7d773ffg66c4', blockId: 'ibgeg2r5znrytr0fkp0vr7wm' } }
  );
  t.groups.push({
    id: 'grp_pos_atendimento_encerrar',
    title: '42B — Encerramento pós-atendimento',
    graphCoordinates: { x: -4800, y: -1750 },
    blocks: [
      {
        id: 'blk_pos_encerrar_txt',
        type: 'text',
        content: {
          richText: [
            p('Atendimento encerrado.'),
            p('Obrigado por utilizar o Doctor Prescreve. Se precisar de ajuda, envie uma mensagem quando preferir.')
          ]
        }
      }
    ]
  });
  changes.push('2. Pós-atendimento (42): pergunta "O que deseja fazer agora?" com Encerrar atendimento / Falar com o suporte; sem novo atendimento clínico e sem repetir perguntas');
}

// ================================================= Validação local
const errors = [];
const varIds = new Set(t.variables.map((v) => v.id));
const edgeIds = new Set(t.edges.map((e) => e.id));
const groupIds = new Set(t.groups.map((g) => g.id));
const blockIds = new Set();
const itemIds = new Set();
for (const g of t.groups) for (const b of g.blocks) {
  if (blockIds.has(b.id)) errors.push('bloco duplicado: ' + b.id);
  blockIds.add(b.id);
  for (const i of b.items || []) {
    if (itemIds.has(i.id)) errors.push('item duplicado: ' + i.id);
    itemIds.add(i.id);
  }
}
const referenced = new Set();
for (const g of t.groups) for (const b of g.blocks) {
  if (b.outgoingEdgeId) {
    referenced.add(b.outgoingEdgeId);
    if (!edgeIds.has(b.outgoingEdgeId)) errors.push(`outgoingEdgeId sem edge: ${b.outgoingEdgeId} (bloco ${b.id})`);
  }
  for (const i of b.items || []) {
    if (i.outgoingEdgeId) {
      referenced.add(i.outgoingEdgeId);
      if (!edgeIds.has(i.outgoingEdgeId)) errors.push(`outgoingEdgeId sem edge: ${i.outgoingEdgeId} (item ${i.id})`);
    }
  }
}
for (const ev of t.events || []) if (ev.outgoingEdgeId) referenced.add(ev.outgoingEdgeId);
for (const e of t.edges) {
  if (!referenced.has(e.id)) errors.push('edge órfã: ' + e.id);
  if (e.from.blockId && !blockIds.has(e.from.blockId)) errors.push(`edge ${e.id}: from.blockId inexistente`);
  if (e.from.itemId && !itemIds.has(e.from.itemId)) errors.push(`edge ${e.id}: from.itemId inexistente`);
  if (!groupIds.has(e.to.groupId)) errors.push(`edge ${e.id}: to.groupId inexistente ${e.to.groupId}`);
  if (e.to.blockId && !blockIds.has(e.to.blockId)) errors.push(`edge ${e.id}: to.blockId inexistente ${e.to.blockId}`);
}
const walk = (node) => {
  if (!node || typeof node !== 'object') return;
  if (node.variableId && !varIds.has(node.variableId)) errors.push('variableId não declarado: ' + node.variableId);
  for (const k of Object.keys(node)) walk(node[k]);
};
for (const g of t.groups) walk(g.blocks);

const terminals = new Set([
  'qcah9q14es9gj6enry35d05u', 'y3vfu7p0f987fe6f1n2zx2t4', 'rp422fl4hazbcuxqloeav9ce',
  'jnbvtyzr1ffz4ff5n05a999k', 'grp_telemedicina_decline', 'grp_inelegivel_presencial',
  'y6vh28eodwchfvyk30311twg', 'grp_upload_confirmed', 'grp_end_receita_none', 'grp_end_receita_not_now',
  'grp_end_condicao_nao_contemplada', 'grp_termos_decline', 'grp_end_aguardando_receita',
  'grp_end_idade', 'grp_pos_atendimento_encerrar'
]);
for (const g of t.groups) {
  if (terminals.has(g.id)) continue;
  const last = g.blocks[g.blocks.length - 1];
  const hasExit = last && (last.outgoingEdgeId || (last.items || []).some((i) => i.outgoingEdgeId));
  if (!hasExit) errors.push('grupo intermediário sem saída: ' + g.id + ' (' + g.title + ')');
}

// Preservação: webhooks, pagamento, links, publicId
const orig = backup.typebot;
{
  const o = orig.groups.find((g) => g.id === 'k6wdfy82owoapnhek8cinv26').blocks.find((b) => b.id === 'axuwb907imxr22bqbnugj3ab').options;
  const n = findBlock('axuwb907imxr22bqbnugj3ab').block.options;
  if (JSON.stringify(o) !== JSON.stringify(n)) errors.push('webhook n8n alterado (deveria estar 100% intacto)');
}
const pick = (tb) => JSON.stringify({
  statusWebhook: tb.groups.find((g) => g.id === 'grp_upload_status_check').blocks.find((b) => b.id === 'blk_upload_status_webhook').options,
  payment: tb.groups.find((g) => g.id === 'ulwovuu3brh5oeawwcuvr0h2').blocks.find((b) => b.id === 'rapfykn1f1uno89ypqmwi43f').options,
  publicId: tb.publicId,
  settings: tb.settings
});
if (pick(t) !== pick(orig)) errors.push('DIVERGÊNCIA em status-webhook/pagamento/publicId/settings');
for (const v of orig.variables) if (!t.variables.some((x) => x.id === v.id)) errors.push('variável removida: ' + v.name);

if (errors.length) {
  console.error(JSON.stringify({ success: false, errors }, null, 2));
  process.exit(1);
}

const result = { ...backup, typebot: t };
const depoisPath = path.join(__dirname, 'typebot-doctor-prescreve-depois-20260718-1404.json');
fs.writeFileSync(depoisPath, JSON.stringify(result, null, 2));

const altered = {
  groups: [
    findGroup('hwxhyusppqmf7d773ffg66c4'),
    findGroup('bhrt6it0ud0teq3tw26q40ba'),
    findGroup('grp_pos_atendimento_encerrar')
  ],
  blocks: [
    findBlock('ibgeg2r5znrytr0fkp0vr7wm').block,
    findBlock('blk_suporte_choice').block,
    findBlock('raqkqz8ghhcf8bylhfuisbpb').block,
    findBlock('blk_pos_atend_pergunta').block,
    findBlock('blk_pos_atend_choice').block,
    findBlock('blk_pos_encerrar_txt').block
  ],
  edges: [
    'edge_suporte_to_choice', 'edge_suporte_to_menu', 'edge_suporte_to_encerrar',
    'edge_pos_atend_to_pergunta', 'edge_pos_atend_to_choice', 'edge_pos_encerrar', 'edge_pos_suporte'
  ].map((id) => findEdge(id))
};

console.log(JSON.stringify({
  success: true,
  changes,
  altered,
  totals: { groups: t.groups.length, edges: t.edges.length, variables: t.variables.length },
  output: depoisPath
}, null, 2));
