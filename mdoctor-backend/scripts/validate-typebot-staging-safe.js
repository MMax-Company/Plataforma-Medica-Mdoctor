const fs = require('fs');
const path = require('path');
const { collectBareSupabaseUrlsInTextBlocks } = require('./typebot-documents');

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

const requiredVars = [
  'med1_nome',
  'med2_nome',
  'med3_nome',
  'medication_count',
  'upload_url',
  'has_prescription_photo_ready',
  'has_previous_prescription',
  'eligibility_status',
  'payment_status'
];
const missingVars = requiredVars.filter((n) => !bot.variables?.some((v) => v.name === n));

const payloadFields = [
  'patient_name',
  'medication_2_name',
  'has_previous_prescription',
  'has_prescription_photo_ready',
  'payment_status',
  'protocol',
  'source'
];
const missingPayloadFields = payloadFields.filter((f) => !serialized.includes(f));

const consentPayloadFields = [
  'lgpd_accepted',
  'terms_of_use_accepted',
  'accepted_terms_links',
  'typebot_public_id'
];
const missingConsentFields = consentPayloadFields.filter((f) => !serialized.includes(f));
const bareSupabaseUrls = collectBareSupabaseUrlsInTextBlocks(bot);

const fotoGroup = (bot.groups || []).find((g) => String(g.title).includes('ENVIO DA RECEITA'));
const fotoBeforePayment = (bot.edges || []).some(
  (e) => e.to?.groupId === fotoGroup?.id && e.from?.blockId === 'q78qjnk6ticw'
);

const paymentEdge = (bot.edges || []).find((e) => e.id === 'xxpw9p5hptmv7u7qlatptirp');
const paymentToMedCount =
  paymentEdge?.to?.groupId &&
  (bot.groups || []).find((g) => g.id === paymentEdge.to.groupId)?.title?.includes('Quantidade');

const errors = [];
if (!hasExpected) errors.push('missing staging webhook URL');
if (hasForbidden.length) errors.push(`forbidden URLs: ${hasForbidden.join(', ')}`);
if (missingVars.length) errors.push(`missing variables: ${missingVars.join(', ')}`);
if (missingPayloadFields.length) errors.push(`webhook body missing: ${missingPayloadFields.join(', ')}`);
if (fotoBeforePayment) errors.push('foto upload must not follow Dados Pessoais directly');
if (!paymentToMedCount) errors.push('payment must route to medication count group');
if (missingConsentFields.length) errors.push(`webhook missing consent fields: ${missingConsentFields.join(', ')}`);
if (bareSupabaseUrls.length) errors.push(`bare supabase URLs in patient text: ${bareSupabaseUrls.join('; ')}`);
if (serialized.includes('file input')) errors.push('file input block must not exist (Typebot free plan)');
const webhookBlock = webhookBlocks[0];
if (!webhookBlock?.options?.responseVariableMapping?.some((m) => m.bodyPath === 'upload_url')) {
  errors.push('webhook must map response upload_url to variable');
}
const webhookBeforeFoto = (bot.edges || []).some(
  (e) => e.id === 'vgmrhkywl7kagoaeaq2ybdmg' && e.to?.groupId === fotoGroup?.id
);
if (!webhookBeforeFoto) errors.push('webhook must route to ENVIO DA RECEITA ANTERIOR before end');

const termsEdge = (bot.edges || []).find((e) => e.id === 'edge_terms_accept_to_payment');
const gateToTerms = (bot.edges || []).find((e) => e.id === 'edge_gate_to_terms');
if (!termsEdge) errors.push('terms acceptance must route to payment');
if (!gateToTerms) errors.push('gate must route to terms before payment');

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
      fieldCoverageHints: fieldCoverage,
      missingVars,
      missingPayloadFields,
      fotoBeforePayment,
      paymentToMedCount,
      missingConsentFields,
      bareSupabaseUrls,
      errors
    },
    null,
    2
  )
);

if (errors.length) process.exit(1);
