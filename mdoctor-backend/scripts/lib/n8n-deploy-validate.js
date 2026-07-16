/**
 * Validação pós-deploy de workflow n8n via Public API.
 */

const TRIAGEM_PATH = '/api/webhook/triagem';
const LEGACY_WHATSAPP_PATH = '/api/whatsapp/webhook';
const REQUIRED_HTTP_NODE_NAME = 'POST Triagem Backend';

function findBackendHttpNode(nodes = []) {
  return nodes.find(
    (n) =>
      n.type === 'n8n-nodes-base.httpRequest' &&
      (n.id === 'tb-post' || n.name === REQUIRED_HTTP_NODE_NAME)
  );
}

function validateWorkflowContent(row, expectedPayload) {
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
  findBackendHttpNode,
  validateWorkflowContent,
  pickPrimaryWorkflow
};
