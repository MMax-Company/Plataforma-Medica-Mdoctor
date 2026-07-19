/**
 * Integra pedidos 1–5 (PR #24) no export staging-safe a partir do production.json,
 * preservando webhook n8n staging e URLs Supabase staging.
 *
 * Ordem recomendada antes de publicar:
 *   1. node mdoctor-backend/scripts/patch-typebot-resumo-dados.js docs/typebot/typebot-doctor-prescreve-staging-safe.json
 *   2. node mdoctor-backend/scripts/integrate-staging-receita-whatsapp-pedidos.js
 *   3. node mdoctor-backend/scripts/validate-typebot-staging-safe.js
 *
 * Uso: node mdoctor-backend/scripts/integrate-staging-receita-whatsapp-pedidos.js
 */

const fs = require('fs');
const path = require('path');

const stagingFile = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
const productionFile = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json');
const exportMirror = path.join(__dirname, '../../docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json');

const STAGING_WEBHOOK = 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook';
const PROD_WEBHOOK = 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook';

const UPLOAD_GROUP_IDS = [
  'grp_foto_receita',
  'grp_upload_status_check',
  'grp_upload_status_result',
  'grp_upload_confirmed',
  'grp_upload_pending_retry',
  'grp_upload_continue_later'
];

const UPLOAD_EDGE_IDS = [
  'edge_upload_check_request',
  'edge_status_to_condition',
  'edge_status_done',
  'edge_status_pending',
  'edge_pending_retry_to_status',
  'edge_upload_confirmed_to_end',
  'edge_pending_resend_to_upload',
  'edge_pending_continue_later',
  'edge_continue_later_to_end'
];

const REMOVED_EDGE_IDS = ['edge_foto_link_to_end', 'edge_upload_check_wait', 'edge_pending_back_to_upload'];

const UPLOAD_VAR_NAMES = new Set([
  'upload_url',
  'upload_check_action',
  'upload_check_message',
  'upload_completed',
  'upload_status_url',
  'upload_status',
  'atendimentoId',
  'nome_social'
]);

const staging = JSON.parse(fs.readFileSync(stagingFile, 'utf8'));
const production = JSON.parse(fs.readFileSync(productionFile, 'utf8'));
const changes = [];

function findGroup(bot, groupId) {
  return bot.groups.find((g) => g.id === groupId) || null;
}

function findWebhookBlock(bot) {
  for (const group of bot.groups) {
    const block = group.blocks.find((b) => b.id === 'axuwb907imxr22bqbnugj3ab');
    if (block) return block;
  }
  return null;
}

// 1. Substituir grupos de upload pelos do production (pedidos 1–5)
staging.groups = staging.groups.filter((g) => !UPLOAD_GROUP_IDS.includes(g.id));
for (const groupId of UPLOAD_GROUP_IDS) {
  const prodGroup = findGroup(production, groupId);
  if (!prodGroup) throw new Error(`Grupo ausente em production: ${groupId}`);
  staging.groups.push(JSON.parse(JSON.stringify(prodGroup)));
  changes.push(`grupo copiado: ${prodGroup.title}`);
}

// 2. Atualizar edges de upload
staging.edges = staging.edges.filter(
  (e) => !UPLOAD_EDGE_IDS.includes(e.id) && !REMOVED_EDGE_IDS.includes(e.id)
);
for (const edgeId of UPLOAD_EDGE_IDS) {
  const prodEdge = production.edges.find((e) => e.id === edgeId);
  if (!prodEdge) throw new Error(`Edge ausente em production: ${edgeId}`);
  staging.edges.push(JSON.parse(JSON.stringify(prodEdge)));
  changes.push(`edge copiada: ${edgeId}`);
}

// 3. Webhook triagem — mapeamentos data.* + URL staging
const stagingWebhook = findWebhookBlock(staging);
const prodWebhook = findWebhookBlock(production);
if (!stagingWebhook || !prodWebhook) throw new Error('Webhook axuwb907imxr22bqbnugj3ab não encontrado');

stagingWebhook.options.responseVariableMapping = JSON.parse(
  JSON.stringify(prodWebhook.options.responseVariableMapping)
);
stagingWebhook.options.webhook.url = STAGING_WEBHOOK;
if (stagingWebhook.options.webhook.body) {
  stagingWebhook.options.webhook.body = stagingWebhook.options.webhook.body.replace(
    new RegExp(PROD_WEBHOOK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    STAGING_WEBHOOK
  );
}
changes.push('webhook triagem: data.* mappings + URL staging');

// 4. Variáveis de upload
const stagingVarIds = new Set(staging.variables.map((v) => v.id));
for (const prodVar of production.variables) {
  if (!UPLOAD_VAR_NAMES.has(prodVar.name)) continue;
  if (staging.variables.some((v) => v.name === prodVar.name)) continue;
  staging.variables.push(JSON.parse(JSON.stringify(prodVar)));
  changes.push(`variável adicionada: ${prodVar.name}`);
}

// Garantir var_upload_status mesmo se nome já existir com id diferente
if (!staging.variables.some((v) => v.name === 'upload_status')) {
  const prodVar = production.variables.find((v) => v.name === 'upload_status');
  if (prodVar && !stagingVarIds.has(prodVar.id)) {
    staging.variables.push(JSON.parse(JSON.stringify(prodVar)));
    changes.push('variável adicionada: upload_status');
  }
}

// 5. Sanidade — sem URL production no JSON staging
const serialized = JSON.stringify(staging);
if (serialized.includes(PROD_WEBHOOK)) {
  throw new Error('URL de webhook production ainda presente no staging-safe');
}
if (serialized.includes('n8n-node-production')) {
  throw new Error('Referência n8n production ainda presente no staging-safe');
}

fs.writeFileSync(stagingFile, `${JSON.stringify(staging, null, 2)}\n`);
if (fs.existsSync(exportMirror)) {
  fs.writeFileSync(exportMirror, `${JSON.stringify(staging, null, 2)}\n`);
  changes.push('espelho export atualizado');
}

console.log(JSON.stringify({
  success: true,
  stagingFile,
  groups: staging.groups.length,
  edges: staging.edges.length,
  variables: staging.variables.length,
  changes
}, null, 2));
