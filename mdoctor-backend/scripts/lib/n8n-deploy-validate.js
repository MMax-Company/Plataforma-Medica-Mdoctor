/**
 * Validação pós-deploy de workflow n8n via Public API.
 */

const TRIAGEM_PATH = '/api/webhook/triagem';
const LEGACY_WHATSAPP_PATH = '/api/whatsapp/webhook';
const REQUIRED_HTTP_NODE_NAME = 'POST Triagem Backend';

function isEvolutionWebhookWorkflow(payload = {}) {
  const name = String(payload?.name || '');
  const template = String(payload?.meta?.template || '');
  const nodes = payload?.nodes || [];
  return (
    template.includes('evolution-webhook') ||
    /evolution\s+webhook/i.test(name) ||
    nodes.some((n) => n.id === 'evo-parse' || n.id === 'evo-wh-base')
  );
}

function validateEvolutionWorkflowContent(row, expectedPayload) {
  const nodes = row?.nodes || [];
  const nodeNames = new Set(nodes.map((n) => n.name).filter(Boolean));
  const connections = row?.connections || expectedPayload?.connections || {};

  for (const [source, conn] of Object.entries(connections)) {
    if (!nodeNames.has(source)) {
      return { ok: false, reason: `conexão com origem inexistente: "${source}"` };
    }
    for (const outputs of conn.main || []) {
      for (const link of outputs || []) {
        if (link?.node && !nodeNames.has(link.node)) {
          return {
            ok: false,
            reason: `conexão quebrada: "${source}" → "${link.node}" (nó ausente em nodes[])`
          };
        }
      }
    }
  }

  const requiredIds = ['evo-wh-base', 'evo-parse', 'evo-route', 'evo-inbound'];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const missing = requiredIds.filter((id) => !nodeIds.has(id));
  if (missing.length) {
    return { ok: false, reason: `nós Evolution obrigatórios ausentes: ${missing.join(', ')}` };
  }

  const expectedNodes = expectedPayload?.nodes?.length ?? 0;
  if (expectedNodes && nodes.length !== expectedNodes) {
    return {
      ok: false,
      reason: `quantidade de nós diverge (API=${nodes.length}, JSON=${expectedNodes})`
    };
  }

  return { ok: true, workflowKind: 'evolution-webhook', nodeCount: nodes.length };
}

function findBackendHttpNode(nodes = []) {
  return nodes.find(
    (n) =>
      n.type === 'n8n-nodes-base.httpRequest' &&
      (n.id === 'tb-post' || n.name === REQUIRED_HTTP_NODE_NAME)
  );
}

function validateWorkflowContent(row, expectedPayload) {
  const payload = expectedPayload || row || {};
  if (isEvolutionWebhookWorkflow(payload)) {
    return validateEvolutionWorkflowContent(row, expectedPayload);
  }

  const nodes = row?.nodes || [];
  const httpNode = findBackendHttpNode(nodes);
  if (!httpNode) {
    const legacy = nodes.find(
      (n) => n.type === 'n8n-nodes-base.httpRequest' && n.name === 'POST Backend'
    );
    if (legacy) {
      return {
        ok: false,
        reason: 'workflow legado detectado (nó "POST Backend") — use PUT ou N8N_DEPLOY_FORCE_RECREATE=1',
        url: String(legacy.parameters?.url || ''),
        httpNodeName: legacy.name
      };
    }
    return { ok: false, reason: `nó "${REQUIRED_HTTP_NODE_NAME}" (id tb-post) não encontrado` };
  }

  if (httpNode.name !== REQUIRED_HTTP_NODE_NAME) {
    return {
      ok: false,
      reason: `nó HTTP deve se chamar "${REQUIRED_HTTP_NODE_NAME}" (atual: "${httpNode.name}")`,
      httpNodeName: httpNode.name
    };
  }

  const url = String(httpNode.parameters?.url || '');
  if (url.includes(LEGACY_WHATSAPP_PATH)) {
    return { ok: false, reason: `URL ainda aponta para ${LEGACY_WHATSAPP_PATH}`, url, httpNodeName: httpNode.name };
  }
  if (!url.includes(TRIAGEM_PATH)) {
    return { ok: false, reason: `URL não contém ${TRIAGEM_PATH}`, url, httpNodeName: httpNode.name };
  }
  if (!url.includes('BACKEND_BASE_URL')) {
    return {
      ok: false,
      reason: 'URL deve usar $env.BACKEND_BASE_URL (expressão n8n)',
      url,
      httpNodeName: httpNode.name
    };
  }

  const expectedNodes = expectedPayload?.nodes?.length ?? 0;
  if (expectedNodes && nodes.length !== expectedNodes) {
    return {
      ok: false,
      reason: `quantidade de nós diverge (API=${nodes.length}, JSON=${expectedNodes})`,
      url,
      httpNodeName: httpNode.name
    };
  }

  return { ok: true, url, httpNodeName: httpNode.name, nodeCount: nodes.length };
}

function pickPrimaryWorkflow(matches) {
  if (!matches.length) return null;
  const active = matches.filter((w) => w.active);
  if (active.length === 1) return active[0];
  if (active.length > 1) {
    return active.sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))).pop();
  }
  return matches.sort((a, b) => String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''))).pop();
}

module.exports = {
  TRIAGEM_PATH,
  LEGACY_WHATSAPP_PATH,
  REQUIRED_HTTP_NODE_NAME,
  isEvolutionWebhookWorkflow,
  validateEvolutionWorkflowContent,
  findBackendHttpNode,
  validateWorkflowContent,
  pickPrimaryWorkflow
};
