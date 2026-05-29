/**
 * Embeds docs/n8n-workflows/lib/whatsapp-inbound-menu.code.js into evolution-webhook-staging.json
 */
const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, '../../docs/n8n-workflows/evolution-webhook-staging.json');
const codePath = path.join(__dirname, '../../docs/n8n-workflows/lib/whatsapp-inbound-menu.code.js');

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const code = fs.readFileSync(codePath, 'utf8').trim();

const node = workflow.nodes.find((n) => n.id === 'evo-inbound' || n.name === 'Relay To Typebot Webhook');
if (!node) {
  console.error('Inbound menu node not found');
  process.exit(1);
}

node.name = 'Handle WhatsApp Inbound Menu';
node.parameters.jsCode = code;

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log('Updated', workflowPath);
