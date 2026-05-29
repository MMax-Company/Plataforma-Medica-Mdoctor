const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '../../docs/n8n-workflows/typebot-webhook-staging.json');
const codePath = path.join(__dirname, '../../docs/n8n-workflows/lib/typebot-webhook-payload.code.js');

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const jsCode = fs.readFileSync(codePath, 'utf8');
const node = workflow.nodes.find((item) => item.name === 'Build Payload');
if (!node) throw new Error('Build Payload node not found');
node.parameters.jsCode = jsCode;
fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Embedded typebot payload normalizer into typebot-webhook-staging.json');
