/**
 * Regenera typebot-webhook-staging.json a partir dos arquivos em lib/
 * Uso: node docs/n8n-workflows/build-typebot-webhook-json.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const build = fs.readFileSync(path.join(__dirname, 'lib/typebot-webhook-triagem.code.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, 'lib/typebot-webhook-route-response.code.js'), 'utf8');

const wf = {
  name: 'Typebot Webhook - Staging',
  active: true,
  nodes: [
    {
      parameters: { httpMethod: 'POST', path: 'typebot-webhook', responseMode: 'responseNode', options: {} },
      id: 'tb-wh',
      name: 'Webhook Typebot',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [200, 300],
      webhookId: 'typebot-webhook-staging'
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: build },
      id: 'tb-build',
      name: 'Build Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [440, 300]
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ ($env.BACKEND_BASE_URL || $env.BACKEND_URL || 'https://doctor-repositorio-central-production.up.railway.app').replace(/\\/$/, '') + '/api/webhook/triagem' }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'X-Correlation-Id', value: '={{ $json.correlationId }}' },
            { name: 'Idempotency-Key', value: '={{ $json.idempotencyKey }}' },
            { name: 'X-N8N-Workflow', value: 'typebot-webhook-staging' }
          ]
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.triagemPayload }}',
        options: { timeout: 30000, response: { response: { fullResponse: true, neverError: true } } }
      },
      id: 'tb-post',
      name: 'POST Triagem Backend',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [700, 300]
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: route },
      id: 'tb-route',
      name: 'Route Response',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [940, 300]
    },
    {
      parameters: {
        conditions: {
          options: { version: 2, leftValue: '', caseSensitive: true, typeValidation: 'strict' },
          combinator: 'and',
          conditions: [
            {
              id: 'ok-check',
              leftValue: '={{ $json.ok }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'true', singleValue: true }
            }
          ]
        }
      },
      id: 'tb-if',
      name: 'Backend OK?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1180, 300]
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $json.typebotResponse }}',
        options: { responseCode: 200 }
      },
      id: 'tb-ok',
      name: 'Resposta Sucesso',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.3,
      position: [1420, 200]
    },
    {
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $json.typebotResponse }}',
        options: { responseCode: 200 }
      },
      id: 'tb-err',
      name: 'Resposta Erro',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.3,
      position: [1420, 420]
    }
  ],
  connections: {
    'Webhook Typebot': { main: [[{ node: 'Build Payload', type: 'main', index: 0 }]] },
    'Build Payload': { main: [[{ node: 'POST Triagem Backend', type: 'main', index: 0 }]] },
    'POST Triagem Backend': { main: [[{ node: 'Route Response', type: 'main', index: 0 }]] },
    'Route Response': { main: [[{ node: 'Backend OK?', type: 'main', index: 0 }]] },
    'Backend OK?': {
      main: [
        [{ node: 'Resposta Sucesso', type: 'main', index: 0 }],
        [{ node: 'Resposta Erro', type: 'main', index: 0 }]
      ]
    }
  },
  settings: { executionOrder: 'v1' }
};

fs.writeFileSync(path.join(__dirname, 'typebot-webhook-staging.json'), `${JSON.stringify(wf, null, 2)}\n`);
console.log('OK typebot-webhook-staging.json');
