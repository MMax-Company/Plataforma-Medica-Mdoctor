#!/usr/bin/env node
/**
 * Atualiza typebot-webhook-staging.json com o código da lib e propaga upload_url na resposta.
 */
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '../../docs/n8n-workflows/typebot-webhook-staging.json');
const buildPayloadPath = path.join(__dirname, '../../docs/n8n-workflows/lib/typebot-webhook-payload.code.js');

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

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const buildCode = fs.readFileSync(buildPayloadPath, 'utf8');

const buildNode = workflow.nodes.find((n) => n.name === 'Build Payload');
const wrapNode = workflow.nodes.find((n) => n.name === 'Wrap Response');
if (!buildNode || !wrapNode) {
  console.error('Build Payload or Wrap Response node missing');
  process.exit(1);
}

buildNode.parameters.jsCode = buildCode;
wrapNode.parameters.jsCode = WRAP_RESPONSE;

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
console.log(JSON.stringify({ ok: true, file: workflowPath, buildBytes: buildCode.length }, null, 2));
