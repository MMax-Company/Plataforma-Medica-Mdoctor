const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '../../docs/n8n-workflows/typebot-webhook-staging.json');
const codePath = path.join(__dirname, '../../docs/n8n-workflows/lib/typebot-webhook-payload.code.js');

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
const jsCode = fs.readFileSync(codePath, 'utf8');
const buildNode = workflow.nodes.find((item) => item.name === 'Build Payload');
const wrapNode = workflow.nodes.find((item) => item.name === 'Wrap Response');
if (!buildNode) throw new Error('Build Payload node not found');
if (!wrapNode) throw new Error('Wrap Response node not found');
buildNode.parameters.jsCode = jsCode;
wrapNode.parameters.jsCode = WRAP_RESPONSE;
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Embedded typebot payload + upload_url wrap into typebot-webhook-staging.json');
