const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json');
const expectedWebhook = 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook';
const forbidden = ['n8n-node-production', 'web-production', 'mdoctor-backend-staging-staging.up.railway.app/api/whatsapp/webhook'];

const raw = fs.readFileSync(filePath, 'utf8');
const bot = JSON.parse(raw);
const serialized = JSON.stringify(bot);

const urls = [...new Set(serialized.match(/https?:\/\/[^"\\]+/g) || [])];
const webhookUrls = urls.filter((u) => u.includes('webhook') || u.includes('n8n'));
const hasExpected = serialized.includes(expectedWebhook);
const hasForbidden = forbidden.filter((f) => serialized.includes(f));

const blocks = (bot.groups || []).flatMap((g) => g.blocks || []);
const paymentBlocks = blocks.filter((b) => String(b.type || '').toLowerCase().includes('payment'));
const webhookBlocks = blocks.filter((b) => {
  const s = JSON.stringify(b).toLowerCase();
  return s.includes('webhook') || s.includes('typebot-webhook');
});

const fieldHints = [
  'nome',
  'telefone',
  'cpf',
  'nascimento',
  'hipertens',
  'diabetes',
  'medic',
  'continu',
  'alerta',
  'lgpd',
  'consent'
];
const fieldCoverage = fieldHints.filter((hint) => serialized.toLowerCase().includes(hint));

console.log(
  JSON.stringify(
    {
      file: filePath,
      parseable: true,
      hasExpectedWebhook: hasExpected,
      expectedWebhook,
      webhookUrls,
      forbiddenFound: hasForbidden,
      paymentBlocksCount: paymentBlocks.length,
      webhookBlocksCount: webhookBlocks.length,
      fieldCoverageHints: fieldCoverage
    },
    null,
    2
  )
);

if (!hasExpected || hasForbidden.length) process.exit(1);
