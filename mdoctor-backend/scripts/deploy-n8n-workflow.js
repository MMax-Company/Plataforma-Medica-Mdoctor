/**
 * Import/update/activate n8n workflow JSON via Public API (/api/v1).
 *
 * Compatível com backend Mdoctor (rotas inalteradas):
 *   /api/whatsapp/webhook, eligibility, upload-receita — não são modificadas por este script.
 *
 * Env:
 *   N8N_TARGET=local        → http://localhost:5678 + carrega docker/n8n/.env
 *   N8N_BASE_URL            staging Railway ou local
 *   N8N_API_KEY             Settings → n8n API (ou em docker/n8n/.env)
 *   N8N_WORKFLOW_FILE       caminho do JSON
 *   N8N_BASIC_AUTH_USER     opcional (Docker local)
 *   N8N_BASIC_AUTH_PASSWORD opcional
 *   N8N_SKIP_WEBHOOK_CHECK  1 para pular validação pós-deploy
 *   N8N_WEBHOOK_PATH        sobrescreve path extraído do JSON
 */

const fs = require('fs');
const path = require('path');
const { applyDockerN8nEnv } = require('./lib/load-docker-n8n-env');
const log = require('./lib/n8n-deploy-log');

const STAGING_URL = 'https://n8n-staging-staging-2dfe.up.railway.app';
const LOCAL_URL = 'http://localhost:5678';

const target = String(process.env.N8N_TARGET || '').trim().toLowerCase();
const isLocal = target === 'local';

if (isLocal) {
  const loaded = applyDockerN8nEnv();
  if (loaded.found && loaded.applied.length) {
    log.info(`docker/n8n/.env → ${loaded.applied.join(', ')}`);
  } else if (!loaded.found) {
    log.warn(`docker/n8n/.env não encontrado (${loaded.file})`);
  }
}

const baseUrl = String(
  process.env.N8N_BASE_URL || (isLocal ? LOCAL_URL : STAGING_URL)
).replace(/\/$/, '');
const apiKey = String(process.env.N8N_API_KEY || '').trim();
const workflowFile = process.env.N8N_WORKFLOW_FILE;
const basicUser = String(process.env.N8N_BASIC_AUTH_USER || '').trim();
const basicPassword = String(process.env.N8N_BASIC_AUTH_PASSWORD || '').trim();
const skipWebhookCheck = String(process.env.N8N_SKIP_WEBHOOK_CHECK || '') === '1';

function buildHeaders(includeJson = true) {
  const headers = { 'X-N8N-API-KEY': apiKey, accept: 'application/json' };
  if (includeJson) headers['Content-Type'] = 'application/json';
  if (basicUser && basicPassword) {
    headers.Authorization = `Basic ${Buffer.from(`${basicUser}:${basicPassword}`).toString('base64')}`;
  }
  return headers;
}

function mapHttpError(status, text) {
  const body = String(text || '').toLowerCase();
  if (status === 401) {
    if (body.includes('basic') || body.includes('unauthorized') && !apiKey) {
      return 'erro de autenticação (Basic Auth incorreto ou ausente)';
    }
    return 'API Key inválida';
  }
  if (status === 403) return 'erro de autenticação (acesso negado)';
  if (status === 404 && body.includes('not found')) return 'recurso não encontrado na API n8n';
  return `HTTP ${status}`;
}

async function request(method, urlPath, body) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const hint = mapHttpError(response.status, text);
    throw new Error(`${hint} — ${method} ${urlPath}: ${text.slice(0, 500)}`);
  }
  return data;
}

function toApiBody(source, id) {
  const body = {
    name: source.name,
    nodes: source.nodes,
    connections: source.connections,
    settings: source.settings || {},
    staticData: source.staticData ?? null,
    active: true
  };
  if (source.pinData) body.pinData = source.pinData;
  if (id) body.id = id;
  return body;
}

function extractWebhookPaths(workflow) {
  const override = String(process.env.N8N_WEBHOOK_PATH || '').trim();
  if (override) return [override.replace(/^\//, '')];
  const paths = [];
  for (const node of workflow.nodes || []) {
    if (node.type === 'n8n-nodes-base.webhook' && node.parameters?.path) {
      paths.push(String(node.parameters.path).replace(/^\//, ''));
    }
  }
  return [...new Set(paths)];
}

async function validateWorkflowActive(workflowId) {
  const wf = await request('GET', `/api/v1/workflows/${workflowId}`);
  const row = wf?.data ?? wf;
  if (!row?.active) {
    throw new Error('workflow importado mas permanece inativo na API');
  }
  return row;
}

async function validateProductionWebhook(webhookPath) {
  const url = `${baseUrl}/webhook/${webhookPath}`;
  const headers = buildHeaders(false);

  const getRes = await fetch(url, { method: 'GET', headers });
  const getText = await getRes.text();

  if (getRes.status === 200) {
    log.ok(`webhook ativo — GET ${url} → HTTP 200`);
    return { method: 'GET', status: 200 };
  }

  const postRes = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const postText = await postRes.text();

  const notRegistered =
    postRes.status === 404 &&
    (postText.includes('not registered') || postText.includes('not registered.'));

  if (notRegistered) {
    throw new Error(
      `webhook inativo — POST /webhook/${webhookPath} retornou 404 (workflow não publicado ou path incorreto)`
    );
  }

  if (postRes.status === 200 || postRes.status === 201 || postRes.status === 204) {
    log.ok(`webhook ativo — POST /webhook/${webhookPath} → HTTP ${postRes.status}`);
    if (getRes.status !== 200) {
      log.info(
        `GET /webhook/${webhookPath} → HTTP ${getRes.status} (nó Typebot aceita POST; GET não retorna 200)`
      );
    }
    return { method: 'POST', status: postRes.status };
  }

  log.ok(
    `webhook ativo — POST /webhook/${webhookPath} → HTTP ${postRes.status} (registrado; resposta do fluxo)`
  );
  if (getRes.status !== 200) {
    log.info(`GET /webhook/${webhookPath} → HTTP ${getRes.status}`);
  }
  return { method: 'POST', status: postRes.status };
}

async function main() {
  if (!apiKey) {
    log.fail('N8N_API_KEY é obrigatória (Settings → n8n API no n8n local)');
    process.exit(1);
  }
  if (!workflowFile) {
    log.fail('N8N_WORKFLOW_FILE é obrigatório');
    process.exit(1);
  }

  const workflowPath = path.resolve(workflowFile);
  if (!fs.existsSync(workflowPath)) {
    log.fail(`Arquivo não encontrado: ${workflowPath}`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const payload = { ...raw, active: true };

  log.info(`n8n deploy → ${baseUrl}`);
  log.info(`workflow: ${payload.name} (${path.basename(workflowPath)})`);

  const existing = await request('GET', '/api/v1/workflows?limit=250');
  const list = Array.isArray(existing?.data) ? existing.data : Array.isArray(existing) ? existing : [];
  const found = list.find((w) => w.name === payload.name);

  let workflowId;
  let action;

  if (found?.id) {
    workflowId = found.id;
    await request('PATCH', `/api/v1/workflows/${workflowId}`, toApiBody(payload, workflowId));
    await request('POST', `/api/v1/workflows/${workflowId}/activate`);
    action = 'updated';
    log.ok('workflow atualizado');
  } else {
    const created = await request('POST', '/api/v1/workflows', toApiBody(payload));
    workflowId = created?.id ?? created?.data?.id;
    if (!workflowId) {
      throw new Error('API não retornou id do workflow criado');
    }
    await request('POST', `/api/v1/workflows/${workflowId}/activate`);
    action = 'created';
    log.ok('workflow criado');
  }

  const activeRow = await validateWorkflowActive(workflowId);
  log.ok(`workflow ativo na API (id=${workflowId}, active=${activeRow.active})`);

  const webhookPaths = extractWebhookPaths(payload);
  if (!skipWebhookCheck && webhookPaths.length) {
    for (const webhookPath of webhookPaths) {
      await validateProductionWebhook(webhookPath);
    }
  } else if (!webhookPaths.length) {
    log.warn('Nenhum nó webhook no JSON — validação de URL ignorada');
  }

  const summary = {
    success: true,
    action,
    baseUrl,
    workflowId,
    name: payload.name,
    active: true,
    webhookPaths,
    file: workflowPath
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  const msg = error.message || String(error);
  if (msg.includes('API Key inválida')) {
    log.fail('API Key inválida');
  } else if (msg.includes('autenticação')) {
    log.fail('erro de autenticação');
  } else {
    log.fail(msg);
  }
  process.exit(1);
});
