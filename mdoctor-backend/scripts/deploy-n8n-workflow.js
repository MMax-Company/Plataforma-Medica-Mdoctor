/**
 * Import/update/activate n8n workflow JSON via Public API (/api/v1).
 *
 * Atualização completa via PUT (PATCH parcial não substitui nodes/connections).
 *
 * Env:
 *   N8N_TARGET=local
 *   N8N_BASE_URL
 *   N8N_API_KEY
 *   N8N_WORKFLOW_FILE
 *   N8N_WORKFLOW_ID          força atualizar este id (opcional)
 *   N8N_DEPLOY_FORCE_RECREATE 1 → apaga e recria se validação falhar
 *   N8N_SKIP_WEBHOOK_CHECK
 *   N8N_BASIC_AUTH_USER / N8N_BASIC_AUTH_PASSWORD
 */

const fs = require('fs');
const path = require('path');
const { applyDockerN8nEnv } = require('./lib/load-docker-n8n-env');
const log = require('./lib/n8n-deploy-log');
const {
  validateWorkflowContent,
  pickPrimaryWorkflow,
  TRIAGEM_PATH
} = require('./lib/n8n-deploy-validate');

const STAGING_URL = 'https://n8n-staging-staging-2dfe.up.railway.app';
const LOCAL_URL = 'http://localhost:5678';

const target = String(process.env.N8N_TARGET || '').trim().toLowerCase();
const isLocal = target === 'local';
const forceRecreate = String(process.env.N8N_DEPLOY_FORCE_RECREATE || '') === '1';
const forcedWorkflowId = String(process.env.N8N_WORKFLOW_ID || '').trim();

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
    if (body.includes('basic') || (body.includes('unauthorized') && !apiKey)) {
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

const READ_ONLY_WORKFLOW_FIELDS = new Set([
  'active',
  'id',
  'createdAt',
  'updatedAt',
  'versionId',
  'meta',
  'isArchived',
  'shared',
  'tags'
]);

function toApiBody(source) {
  const body = {
    name: source.name,
    nodes: source.nodes,
    connections: source.connections,
    settings: source.settings || {},
    staticData: source.staticData ?? null
  };
  if (source.pinData) body.pinData = source.pinData;
  for (const key of Object.keys(body)) {
    if (READ_ONLY_WORKFLOW_FIELDS.has(key)) delete body[key];
  }
  return body;
}

async function listAllWorkflows() {
  const collected = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const qs = new URLSearchParams({ limit: '250' });
    if (cursor) qs.set('cursor', cursor);
    const res = await request('GET', `/api/v1/workflows?${qs.toString()}`);
    const chunk = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
    collected.push(...chunk);
    cursor = res?.nextCursor || res?.cursor || null;
    if (!cursor || chunk.length === 0) break;
  }
  return collected;
}

function findByName(list, name) {
  return list.filter((w) => String(w.name || '').trim() === String(name).trim());
}

async function getWorkflowRow(workflowId) {
  const wf = await request('GET', `/api/v1/workflows/${workflowId}`);
  return wf?.data ?? wf;
}

async function deactivateWorkflow(workflowId) {
  try {
    await request('POST', `/api/v1/workflows/${workflowId}/deactivate`);
  } catch (error) {
    if (!String(error.message).includes('404')) throw error;
  }
}

async function deleteWorkflow(workflowId) {
  await deactivateWorkflow(workflowId);
  await request('DELETE', `/api/v1/workflows/${workflowId}`);
}

async function putWorkflow(workflowId, apiBody) {
  return request('PUT', `/api/v1/workflows/${workflowId}`, apiBody);
}

async function createWorkflow(apiBody) {
  return request('POST', '/api/v1/workflows', apiBody);
}

async function ensureWorkflowActive(workflowId) {
  let row = await getWorkflowRow(workflowId);
  if (row?.active) return row;
  await request('POST', `/api/v1/workflows/${workflowId}/activate`);
  row = await getWorkflowRow(workflowId);
  if (!row?.active) {
    throw new Error('workflow permanece inativo após POST /activate');
  }
  return row;
}

async function removeDuplicates(matches, keepId) {
  const removed = [];
  for (const wf of matches) {
    if (wf.id === keepId) continue;
    log.warn(`removendo workflow duplicado: id=${wf.id} name="${wf.name}" active=${wf.active}`);
    await deleteWorkflow(wf.id);
    removed.push(wf.id);
  }
  return removed;
}

async function deployToId(workflowId, apiBody, payload) {
  log.info(`PUT /api/v1/workflows/${workflowId} (substituição completa)`);
  await deactivateWorkflow(workflowId);
  await putWorkflow(workflowId, apiBody);
  await ensureWorkflowActive(workflowId);
  const row = await getWorkflowRow(workflowId);
  const check = validateWorkflowContent(row, payload);
  return { workflowId, row, check };
}

async function deployRecreate(apiBody, payload) {
  log.info('recriando workflow (POST /api/v1/workflows)');
  const created = await createWorkflow(apiBody);
  const workflowId = created?.id ?? created?.data?.id;
  if (!workflowId) throw new Error('API não retornou id do workflow criado');
  await ensureWorkflowActive(workflowId);
  const row = await getWorkflowRow(workflowId);
  const check = validateWorkflowContent(row, payload);
  return { workflowId, row, check, recreated: true };
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

async function validateProductionWebhook(webhookPath) {
  const url = `${baseUrl}/webhook/${webhookPath}`;
  const headers = buildHeaders(false);

  const getRes = await fetch(url, { method: 'GET', headers });
  if (getRes.status === 200) {
    log.ok(`webhook ativo — GET ${url} → HTTP 200`);
    return;
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
    throw new Error(`webhook inativo — POST /webhook/${webhookPath} → 404`);
  }

  log.ok(`webhook ativo — POST /webhook/${webhookPath} → HTTP ${postRes.status}`);
}

function exitClean(code) {
  setImmediate(() => process.exit(code));
}

async function main() {
  if (!apiKey) throw new Error('N8N_API_KEY é obrigatória (Settings → n8n API)');
  if (!workflowFile) throw new Error('N8N_WORKFLOW_FILE é obrigatório');

  const workflowPath = path.resolve(workflowFile);
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Arquivo não encontrado: ${workflowPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const apiBody = toApiBody(payload);

  log.info(`n8n deploy → ${baseUrl}`);
  log.info(`workflow: ${payload.name} (${path.basename(workflowPath)})`);

  const list = await listAllWorkflows();
  const matches = forcedWorkflowId
    ? list.filter((w) => w.id === forcedWorkflowId)
    : findByName(list, payload.name);

  if (forcedWorkflowId && !matches.length) {
    throw new Error(`N8N_WORKFLOW_ID=${forcedWorkflowId} não encontrado na instância`);
  }

  if (matches.length > 1) {
    log.warn(`${matches.length} workflows com nome "${payload.name}" — removendo duplicatas`);
  }

  let workflowId;
  let action;
  let recreated = false;
  let removedIds = [];

  const primary = forcedWorkflowId ? { id: forcedWorkflowId } : pickPrimaryWorkflow(matches);

  if (primary?.id) {
    workflowId = primary.id;
    removedIds = await removeDuplicates(matches, workflowId);
    let result = await deployToId(workflowId, apiBody, payload);

    if (!result.check.ok) {
      log.warn(`validação pós-PUT falhou: ${result.check.reason}`);
      if (result.check.url) log.info(`URL atual na API: ${result.check.url}`);

      if (forceRecreate) {
        log.info('N8N_DEPLOY_FORCE_RECREATE=1 — apagando e recriando');
        await deleteWorkflow(workflowId);
        const fresh = await deployRecreate(apiBody, payload);
        workflowId = fresh.workflowId;
        result = fresh;
        recreated = true;
        action = 'recreated';
      } else {
        throw new Error(
          `${result.check.reason}. Defina N8N_DEPLOY_FORCE_RECREATE=1 ou corrija manualmente no n8n.`
        );
      }
    } else {
      action = removedIds.length ? 'updated (deduped)' : 'updated';
    }

    log.ok('workflow atualizado');
  } else {
    const fresh = await deployRecreate(apiBody, payload);
    workflowId = fresh.workflowId;
    if (!fresh.check.ok) {
      throw new Error(`workflow criado mas inválido: ${fresh.check.reason}`);
    }
    action = 'created';
    recreated = Boolean(fresh.recreated);
    log.ok('workflow criado');
  }

  const finalRow = await getWorkflowRow(workflowId);
  const finalCheck = validateWorkflowContent(finalRow, payload);
  if (!finalCheck.ok) {
    throw new Error(`validação final falhou: ${finalCheck.reason}`);
  }

  log.ok(`workflow ativo na API (id=${workflowId}, active=${finalRow.active})`);
  if (finalCheck.workflowKind === 'evolution-webhook') {
    log.ok(`workflow Evolution validado (${finalCheck.nodeCount} nós, conexões íntegras)`);
  } else {
    log.ok(
      `nó "${finalCheck.httpNodeName}" → ${TRIAGEM_PATH} (${finalCheck.nodeCount} nós)`
    );
  }

  const webhookPaths = extractWebhookPaths(payload);
  if (!skipWebhookCheck && webhookPaths.length) {
    for (const webhookPath of webhookPaths) {
      await validateProductionWebhook(webhookPath);
    }
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        action,
        recreated,
        removedDuplicateIds: removedIds,
        baseUrl,
        workflowId,
        name: payload.name,
        active: true,
        validation: finalCheck,
        webhookPaths,
        file: workflowPath
      },
      null,
      2
    )
  );
}

main()
  .then(() => exitClean(0))
  .catch((error) => {
    const msg = error?.message || String(error);
    if (msg.includes('API Key inválida')) log.fail('API Key inválida');
    else if (msg.includes('autenticação')) log.fail('erro de autenticação');
    else log.fail(msg);
    exitClean(1);
  });
