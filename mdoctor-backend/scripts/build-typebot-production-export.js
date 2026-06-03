/**
 * Gera docs/typebot/typebot-doctor-prescreve-production.json
 * a partir do staging-safe, trocando apenas o webhook para n8n produção.
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
const dest = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json');
const STAGING_WH = 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook';
const PROD_WH = 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook';

const bot = JSON.parse(fs.readFileSync(src, 'utf8'));
let raw = JSON.stringify(bot);
if (!raw.includes(STAGING_WH)) {
  console.error('Source missing staging webhook — run patch-typebot-reorganize.js first');
  process.exit(1);
}
raw = raw.split(STAGING_WH).join(PROD_WH);
const out = JSON.parse(raw);
out.name = 'Doctor Prescreve';
out.publicId = 'doctor-prescreve-8rmljgu';
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ written: dest, publicId: out.publicId, webhook: PROD_WH }, null, 2));
