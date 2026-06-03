#!/usr/bin/env node
/**
 * Reconstrói Typebot Webhook - Staging no n8n-staging via API.
 * - Desativa "Doctor Prescreve — Typebot Produção" (somente nesta instância)
 * - Publica "Typebot Webhook - Staging"
 */
const fs = require('fs');
const path = require('path');

const baseUrl = String(process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(
  /\/$/,
  ''
);
const apiKey = String(process.env.N8N_API_KEY || '').trim();
const workflowFile = path.join(__dirname, '../../docs/n8n-workflows/typebot-webhook-staging.json');
const buildPayloadFile = path.join(__dirname, '../../docs/n8n-workflows/build-payload-COPIAR.js');

const PROD_WORKFLOW_NAME = 'Doctor Prescreve — Typebot Produção';
const STAGING_WORKFLOW_NAME = 'Typebot Webhook - Staging';
const WEBHOOK_PATH = 'typebot-webhook';

const WRAP_RESPONSE = `const backend = $input.first().json || {};
const ctx = $('Build Payload').first().json;
return [{
  json: {
    ok: backend.success !== false,
    success: backend.success !== false,
    duplicate: Boolean(backend.duplicate),
    correlationId: ctx.correlationId,
    atendimento: backend.atendimento || null,
    upload_url: backend.upload_url || null,
    status: backend.status || null,
    prescription_upload_pending: Boolean(backend.prescription_upload_pending)
  }
}];`;

const RESPOND_BODY =
  "={{ { success: true, message: 'Triagem recebida com sucesso!', upload_url: $json.upload_url || null } }}";

if (!apiKey) {
  console.error('N8N_API_KEY required');
  process.exit(1);
}

function prepareWorkflow() {
  const wf = JSON.parse(fs.readFileSync(workflowFile, 'utf8'));
  const buildCode = fs.readFileSync(buildPayloadFile, 'utf8');

  wf.name = STAGING_WORKFLOW_NAME;
  wf.active = true;

  const build = wf.nodes.find((n) => n.name === 'Build Payload');
  const post = wf.nodes.find((n) => n.name === 'POST Backend');
  const wrap = wf.nodes.find((n) => n.name === 'Wrap Response');
  let respond = wf.nodes.find((n) => n.name === 'Resposta Sucesso');

  if (!build || !post || !wrap) throw new Error('workflow nodes missing');

  build.parameters.jsCode = buildCode;
  wrap.parameters.jsCode = WRAP_RESPONSE;

  post.parameters.url = 'https://mdoctor-backend-staging-staging.up.railway.app/api/whatsapp/webhook';
  post.parameters.jsonBody = '={{ $json.payload }}';
  post.parameters.headerParameters = post.parameters.headerParameters || { parameters: [] };
  const headers = post.parameters.headerParameters.parameters;
  const setHeader = (name, value) => {
    const h = headers.find((x) => x.name === name);
    if (h) h.value = value;
    else headers.push({ name, value });
  };
  setHeader('Content-Type', 'application/json');
  setHeader('X-MDoctor-Webhook-Secret', '={{ $env.N8N_WEBHOOK_SECRET }}');
  setHeader('X-Correlation-Id', '={{ $json.correlationId }}');
  setHeader('Idempotency-Key', '={{ $json.idempotencyKey }}');

  const wh = wf.nodes.find((n) => n.name === 'Webhook Typebot');
  if (wh) {
    wh.parameters.httpMethod = 'POST';
    wh.parameters.path = WEBHOOK_PATH;
    wh.parameters.responseMode = 'responseNode';
  }

  wf.nodes = wf.nodes.filter((n) => n.name !== 'Respond');
  if (!respond) {
    respond = {
      id: '407e8516-e4ca-441e-b247-f090d70974a7',
      name: 'Resposta Sucesso',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.3,
      position: [960, 300],
      parameters: {
        respondWith: 'json',
        responseBody: RESPOND_BODY,
        options: { responseCode: 200 }
      }
    };
    wf.nodes.push(respond);
  } else {
    respond.parameters = {
      respondWith: 'json',
      responseBody: RESPOND_BODY,
      options: { responseCode: 200 }
    };
  }

  wf.connections = {
    'Webhook Typebot': { main: [[{ node: 'Build Payload', type: 'main', index: 0 }]] },
    'Build Payload': { main: [[{ node: 'POST Backend', type: 'main', index: 0 }]] },
    'POST Backend': { main: [[{ node: 'Wrap Response', type: 'main', index: 0 }]] },
    'Wrap Response': { main: [[{ node: 'Resposta Sucesso', type: 'main', index: 0 }]] }
  };

  fs.writeFileSync(workflowFile, `${JSON.stringify(wf, null, 2)}\n`);
  return wf;
}

async function request(method, urlPath, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

function workflowList(data) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

async function setActive(id, active) {
  if (active) await request('POST', `/api/v1/workflows/${id}/activate`);
  else await request('POST', `/api/v1/workflows/${id}/deactivate`);
}

async function testWebhook() {
  const payload = {
    whatsapp: '5511999884400',
    Nome_Completo: 'Rebuild Staging Test',
    data_nascimento: '01/01/1990',
    cpf_paciente: '52998224725',
    has_previous_prescription: 'sim',
    has_prescription_photo_ready: 'sim',
    payment_status: 'paid',
    medication_count: 1,
    med1_nome: 'Losartana',
    med1_dose: '50',
    med1_frequencia: '1x',
    med1_via: 'oral',
    doenca_cronica: 'hipertensao',
    tempo_uso: 'mais de 6 meses',
    eligibility_status: 'eligible'
  };
  const res = await fetch(`${baseUrl}/webhook/${WEBHOOK_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { status: res.status, body, body_length: text.length };
}

async function main() {
  const wf = prepareWorkflow();
  const list = workflowList(await request('GET', '/api/v1/workflows?limit=250'));

  const prod = list.find((w) => w.name === PROD_WORKFLOW_NAME);
  const staging = list.find((w) => w.name === STAGING_WORKFLOW_NAME);

  const deactivated = [];
  if (prod?.id) {
    await setActive(prod.id, false);
    deactivated.push({ id: prod.id, name: prod.name });
  }

  for (const w of list) {
    if (!w.active || w.id === staging?.id) continue;
    const detail = await request('GET', `/api/v1/workflows/${w.id}`);
    const nodes = detail.nodes || [];
    const hasPath = nodes.some(
      (n) =>
        (n.type || '').includes('webhook') &&
        (n.parameters?.path === WEBHOOK_PATH || JSON.stringify(n.parameters || {}).includes(WEBHOOK_PATH))
    );
    if (hasPath && w.name !== STAGING_WORKFLOW_NAME) {
      await setActive(w.id, false);
      deactivated.push({ id: w.id, name: w.name });
    }
  }

  let saved;
  if (staging?.id) {
    saved = await request('PATCH', `/api/v1/workflows/${staging.id}`, { ...wf, id: staging.id });
    await setActive(staging.id, true);
  } else {
    saved = await request('POST', '/api/v1/workflows', wf);
    if (saved?.id) await setActive(saved.id, true);
  }

  const afterList = workflowList(await request('GET', '/api/v1/workflows?limit=250'));
  const activeTypebot = [];
  for (const w of afterList.filter((x) => x.active)) {
    const detail = await request('GET', `/api/v1/workflows/${w.id}`);
    const nodes = detail.nodes || [];
    if (
      nodes.some(
        (n) => (n.type || '').includes('webhook') && n.parameters?.path === WEBHOOK_PATH
      )
    ) {
      activeTypebot.push({ id: w.id, name: w.name, active: w.active });
    }
  }

  await new Promise((r) => setTimeout(r, 2000));
  const webhook = await testWebhook();

  console.log(
    JSON.stringify(
      {
        auth_ok: true,
        prod_deactivated_on_staging: deactivated,
        staging_workflow: {
          id: saved?.id || staging?.id,
          name: STAGING_WORKFLOW_NAME,
          active: true
        },
        active_workflows_with_path_typebot_webhook: activeTypebot,
        no_duplicate_active: activeTypebot.length <= 1,
        webhook_test: webhook,
        upload_url_ok: Boolean(webhook.body?.upload_url) && webhook.body?.success === true
      },
      null,
      2
    )
  );

  if (!webhook.body?.upload_url) process.exit(1);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
