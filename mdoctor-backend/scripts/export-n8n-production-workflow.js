/**
 * Exporta workflow n8n produção para docs/n8n-workflows/production/
 */
require('./load-dotenv');

const fs = require('fs');
const path = require('path');

const base = String(process.env.N8N_BASE_URL || 'https://n8n-node-production-f844.up.railway.app').replace(
  /\/$/,
  ''
);
const apiKey = String(process.env.N8N_API_KEY || '').trim();
const workflowId = process.env.N8N_WORKFLOW_ID || 'P7qhHC4iNgW8sxDJ';

if (!apiKey) {
  console.error('N8N_API_KEY required');
  process.exit(1);
}

async function main() {
  const res = await fetch(`${base}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': apiKey }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  const wf = data.data || data;
  const dir = path.join(__dirname, '../../docs/n8n-workflows/production');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'doctor-prescreve-typebot-production.json');
  fs.writeFileSync(file, JSON.stringify(wf, null, 2));
  console.log(JSON.stringify({ exported: file, name: wf.name, active: wf.active }, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
