/**
 * Validação local — integração n8n ao fluxo WhatsApp + Typebot consolidado.
 * Não faz deploy, não chama produção, não altera n8n remoto.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../docs/n8n-workflows');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function collectUrls(nodes = []) {
  return nodes
    .filter((n) => n.type === 'n8n-nodes-base.httpRequest')
    .map((n) => ({ name: n.name, id: n.id, url: String(n.parameters?.url || '') }));
}

function collectCode(nodes = []) {
  return nodes
    .filter((n) => n.type === 'n8n-nodes-base.code')
    .map((n) => String(n.parameters?.jsCode || ''))
    .join('\n');
}

async function main() {
  const report = {};

  // 1) Canonical Typebot → triagem
  const triagem = readJson('typebot-webhook-staging.json');
  assert.equal(triagem.active, true);
  const triagemUrls = collectUrls(triagem.nodes);
  assert.equal(triagemUrls.length, 1);
  assert.match(triagemUrls[0].url, /\/api\/webhook\/triagem/);
  assert.doesNotMatch(triagemUrls[0].url, /\/api\/whatsapp\/webhook/);
  assert.doesNotMatch(triagemUrls[0].url, /\/api\/whatsapp\/support/);
  const triagemCode = collectCode(triagem.nodes);
  assert.match(triagemCode, /typebot-result:/);
  assert.match(triagemCode, /payment_token/);
  assert.doesNotMatch(triagemCode, /TYPEBOT_PUBLIC_URL/);
  assert.doesNotMatch(triagemCode, /evolution/i);
  assert.doesNotMatch(triagemCode, /baileys/i);
  report['1_typebot_webhook_triagem'] = 'ok';

  // 2) COPIAR legado desativado (sem HTTP Request paralelo)
  const copiar = readJson('typebot-webhook-staging-COPIAR.json');
  assert.equal(copiar.active, false);
  assert.equal(collectUrls(copiar.nodes).length, 0);
  assert.match(JSON.stringify(copiar), /410/);
  report['2_copiar_legacy_disabled'] = 'ok';

  // 3) Stripe payment via n8n desativado
  const stripe = readJson('stripe-payment-staging.json');
  assert.equal(stripe.active, false);
  assert.equal(stripe.meta?.active, false);
  assert.equal(collectUrls(stripe.nodes).length, 0);
  assert.match(JSON.stringify(stripe), /\/api\/webhooks\/stripe/);
  report['3_stripe_n8n_payment_blocked'] = 'ok';

  // 4) Clinical rejection → Meta via backend
  const reject = readJson('clinical-rejection-notify-staging.json');
  const rejectUrls = collectUrls(reject.nodes);
  assert.equal(rejectUrls.length, 1);
  assert.match(rejectUrls[0].url, /\/api\/whatsapp\/notify-text/);
  assert.doesNotMatch(JSON.stringify(reject), /EVOLUTION_API/);
  assert.doesNotMatch(JSON.stringify(reject), /message\/sendText/);
  assert.doesNotMatch(collectCode(reject.nodes), /baileys/i);
  assert.doesNotMatch(collectCode(reject.nodes), /evolution/i);
  assert.match(collectCode(reject.nodes), /clinical-reject:/);
  report['4_clinical_reject_meta_backend'] = 'ok';

  // 5) Prescription delivery idempotency
  const delivery = readJson('prescription-delivery-staging.json');
  const deliveryUrls = collectUrls(delivery.nodes);
  assert.equal(deliveryUrls.length, 1);
  assert.match(deliveryUrls[0].url, /\/api\/atendimentos\/.*\/deliver/);
  assert.match(JSON.stringify(delivery), /Idempotency-Key/);
  assert.match(collectCode(delivery.nodes), /delivery:/);
  report['5_prescription_delivery_idempotent'] = 'ok';

  // 6) Staging-safe router permanece histórico inativo
  const safe = readJson('doctor-prescreve-staging-safe.json');
  assert.equal(safe.active, false);
  report['6_staging_safe_inactive'] = 'ok';

  // 7) Produção workflow preservado (não alterado nesta etapa)
  const prodPath = path.join(ROOT, 'production/doctor-prescreve-typebot-production.json');
  assert.ok(fs.existsSync(prodPath));
  report['7_production_workflow_preserved'] = 'ok';

  // 8) Backend notify-text + legados 410
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '../src/routes/whatsapp.routes.js'),
    'utf8'
  );
  assert.match(routesSrc, /router\.post\('\/notify-text'/);
  assert.match(routesSrc, /sendWhatsAppText/);
  assert.match(routesSrc, /legacy_support_endpoint_blocked/);
  assert.match(routesSrc, /legacy_process_message_blocked/);
  report['8_backend_notify_text'] = 'ok';

  // 9) Idempotência estável no Build Payload
  const buildSrc = fs.readFileSync(
    path.join(ROOT, 'lib/typebot-webhook-triagem.code.js'),
    'utf8'
  );
  assert.match(buildSrc, /typebot-result:\$\{resultId\}/);
  assert.match(buildSrc, /payment_token/);
  assert.match(buildSrc, /checkout_session_id/);
  assert.doesNotMatch(buildSrc, /triagem-\$\{digits\([^)]+\)\}-\$\{Date\.now\(\)\}/);
  report['9_idempotency_stable_resultId'] = 'ok';

  // 10) Sem menus / publicUrl no fluxo ativo de triagem
  assert.doesNotMatch(triagemCode, /1 - Iniciar atendimento/);
  assert.doesNotMatch(triagemCode, /typebot\.co\//);
  report['10_no_menu_no_public_url'] = 'ok';

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
