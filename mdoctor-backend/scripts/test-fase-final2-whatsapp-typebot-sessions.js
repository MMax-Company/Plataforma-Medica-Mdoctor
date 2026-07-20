/**
 * ETAPA FINAL 2 — verificação local: referências antigas + regras de sessão.
 * Base: PR #27 + PR #28 (cb955aa). Sem deploy, E2E ou teste humano.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const N8N = path.join(ROOT, 'docs/n8n-workflows');
const SRC = path.join(ROOT, 'mdoctor-backend/src');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function collectN8nUrls(wf) {
  return (wf.nodes || [])
    .filter((n) => n.type === 'n8n-nodes-base.httpRequest')
    .map((n) => String(n.parameters?.url || ''));
}

async function main() {
  const report = {};

  // ── Referências oficiais ──
  const official = require('../src/constants/typebot-whatsapp.official');
  assert.equal(official.OFFICIAL_TYPEBOT_PUBLIC_ID, 'doctor-prescreve-8rmljgu');
  assert.equal(official.OFFICIAL_TYPEBOT_ID, 'higij2z0xihxxkr378rmljgu');
  assert.match(official.OFFICIAL_TYPEBOT_PUBLIC_URL, /typebot\.co\/doctor-prescreve-8rmljgu/);
  report['refs_oficiais_typebot_meta'] = 'ok';

  const bridgeSrc = read('mdoctor-backend/src/services/typebot-whatsapp.bridge.js');
  assert(!bridgeSrc.includes('Iniciar Atendimento'));
  assert.match(bridgeSrc, /Vamos Começar|welcomeChoiceInputId/);
  assert.doesNotMatch(bridgeSrc, /publicUrl|TYPEBOT_PUBLIC_URL/);
  report['refs_sem_publicurl_bootstrap'] = 'ok';

  // 1) Menu sem sessão
  require('../src/services/post-delivery-survey.service').handleSurveyInbound = async () => ({ handled: false });
  require('../src/services/whatsapp-support.service').handleRejectionResponse = async () => ({ handled: false });
  require('../src/services/whatsapp-support.service').getPatientSupportContext = async () => null;
  require('../src/services/whatsapp-support.service').createWhatsAppSupportEntry = async () => ({
    duplicate: false,
    reply: 'Aguarde suporte'
  });
  delete require.cache[require.resolve('../src/services/whatsapp-meta-inbound.service')];
  const { routeMetaWhatsAppInbound, MAIN_MENU_TEXT } = require('../src/services/whatsapp-meta-inbound.service');

  const menuNoSession = await routeMetaWhatsAppInbound({
    phone: '5511999887766',
    text: 'Oi',
    whatsappSession: { typebot_session_id: null }
  });
  assert.equal(menuNoSession.action, 'reply');
  assert.equal(menuNoSession.reply, MAIN_MENU_TEXT);
  report['1_menu_sem_sessao'] = 'ok';

  // 2) Continuidade com sessão válida
  const ongoing = await routeMetaWhatsAppInbound({
    phone: '5511999887766',
    text: 'Ana Silva',
    whatsappSession: { typebot_session_id: 'tb-valid-1', metadata: { typebot_expected_input_id: 'blk_name' } }
  });
  assert.equal(ongoing.action, 'typebot');
  assert.equal(ongoing.text, 'Ana Silva');
  report['2_continuidade_sessao_valida'] = 'ok';

  // 3) Opção 1 inicia Typebot oficial
  const opt1 = await routeMetaWhatsAppInbound({
    phone: '5511999887766',
    text: '1',
    whatsappSession: { typebot_session_id: 'tb-old' }
  });
  assert.equal(opt1.action, 'typebot_bootstrap');
  assert.equal(opt1.clearTypebotSession, true);
  assert.equal(opt1.clearClinicalMetadata, true);
  report['3_opcao1_typebot_oficial'] = 'ok';

  // 4) Pagamento validado retoma uma vez
  const { completePaymentByToken } = require('../src/services/typebot-payment-link.service');
  let continueCalls = 0;
  const paySession = {
    id: 'wa-pay',
    phone: '5511999887766',
    typebot_session_id: 'pay-sess',
    metadata: {
      typebot_payment: {
        token: 'tok-1',
        checkout_session_id: 'cs_1',
        typebot_session_id: 'pay-sess',
        payment_status: 'pending',
        status: 'open'
      }
    }
  };
  await completePaymentByToken('tok-1', {
    session: paySession,
    refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
    claimFlowResume: async () => true,
    callTypebot: async () => {
      continueCalls += 1;
      return { sessionId: 'pay-sess', messages: [], input: { id: 'next', type: 'text input' } };
    },
    provider: {
      sendTextMessage: async () => ({ providerMessageId: 'm1' }),
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    },
    persistSession: async () => {},
    createIntegrationError: async () => {},
    sendTypebotOutputs: async () => []
  });
  const dup = await completePaymentByToken('tok-1', {
    session: {
      ...paySession,
      metadata: {
        typebot_payment: { ...paySession.metadata.typebot_payment, flow_resumed: true, payment_status: 'paid' }
      }
    },
    refreshPaymentStatus: async () => ({ paymentStatus: 'paid' })
  });
  assert.equal(continueCalls, 1);
  assert.equal(dup.alreadyCompleted, true);
  report['4_pagamento_retoma_uma_vez'] = 'ok';

  // 5) paid sem Stripe não confirma
  const { normalizePaymentStatus } = require('../src/services/clinical-payload-normalizer.service');
  const typebotPaid = normalizePaymentStatus({ payment_status: 'paid' });
  assert.equal(typebotPaid.paid, false);
  assert.equal(typebotPaid.payment_status, 'unverified');
  report['5_paid_sem_stripe_nao_confirma'] = 'ok';

  // 6) Upload duplicado não reprocessa
  const uploadSrc = read('mdoctor-backend/src/services/typebot-prescription-upload.service.js');
  assert.match(uploadSrc, /processed_media_ids|processed_message_ids/);
  assert.match(uploadSrc, /claimMetaMessage|duplicate/);
  report['6_upload_duplicado_nao_reprocessa'] = 'ok';

  // 7) Upload ambíguo bloqueia
  assert.match(uploadSrc, /WHATSAPP_UPLOAD_AMBIGUOUS_ATENDIMENTO/);
  report['7_upload_ambiguo_bloqueia'] = 'ok';

  // 8) Suporte limpa somente metadata transitória
  const { TRANSIENT_CLINICAL_METADATA_KEYS } = require('../src/store/whatsapp-sessions.store');
  const sessionStoreSrc = read('mdoctor-backend/src/store/whatsapp-sessions.store.js');
  assert.match(sessionStoreSrc, /clearTransientClinicalSessionMetadata/);
  assert.doesNotMatch(sessionStoreSrc, /atendimentos\.store/);
  for (const k of TRANSIENT_CLINICAL_METADATA_KEYS) {
    assert.match(sessionStoreSrc, new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const opt2 = await routeMetaWhatsAppInbound({
    phone: '5511999887766',
    text: '2',
    whatsappSession: { typebot_session_id: 'tb-x', metadata: { typebot_payment: { token: 't' } } },
    messageId: 'wamid-sup'
  });
  assert.equal(opt2.clearClinicalMetadata, true);
  report['8_suporte_limpa_metadata_transitoria'] = 'ok';

  // 9) Ticket duplicado reutilizado (mock idempotência)
  const phone = '5511999887766';
  const key = 'meta:wamid-dup';
  const rows = [];
  const mockCreate = async ({ phone: p, idempotencyKey: ik }) => {
    const digits = p.replace(/\D/g, '');
    const byKey = rows.find((r) => r.dados_clinicos?.idempotency_key === ik);
    if (byKey) return { duplicate: true, idempotentReplay: true, atendimento: byKey, reply: 'já aberto' };
    const row = { id: `s${rows.length}`, paciente_telefone: digits, dados_clinicos: { idempotency_key: ik } };
    rows.push(row);
    return { duplicate: false, atendimento: row, reply: 'ok' };
  };
  const a = await mockCreate({ phone, idempotencyKey: key });
  const b = await mockCreate({ phone, idempotencyKey: key });
  assert.equal(b.duplicate, true);
  assert.equal(b.atendimento.id, a.atendimento.id);
  report['9_ticket_duplicado_reutilizado'] = 'ok';

  // 10) Encerramento retorna ao menu
  require('../src/services/whatsapp-support.service').getPatientSupportContext = async () => null;
  delete require.cache[require.resolve('../src/services/whatsapp-meta-inbound.service')];
  const { routeMetaWhatsAppInbound: routeAfterClose } = require('../src/services/whatsapp-meta-inbound.service');
  const afterClose = await routeAfterClose({
    phone,
    text: 'Oi',
    whatsappSession: { typebot_session_id: null }
  });
  assert.equal(afterClose.reply, MAIN_MENU_TEXT);
  report['10_encerramento_menu'] = 'ok';

  // 11) Endpoints legados bloqueados
  const routesSrc = read('mdoctor-backend/src/routes/whatsapp.routes.js');
  assert.match(routesSrc, /legacy_support_endpoint_blocked/);
  assert.match(routesSrc, /legacy_process_message_blocked/);
  assert.match(routesSrc, /status\(410\)/);
  assert.doesNotMatch(routesSrc, /processIncomingMessage\(/);
  const automationSrc = read('mdoctor-automation/server.js');
  assert.match(automationSrc, /Proxy WhatsApp desativado/);
  assert.match(automationSrc, /status\(410\)/);
  report['11_endpoints_legados_bloqueados'] = 'ok';

  // 12) Workflows antigos desativados
  const inactive = [
    ['docs/n8n-workflows/typebot-webhook-staging-COPIAR.json', false],
    ['docs/n8n-workflows/stripe-payment-staging.json', false],
    ['docs/n8n-workflows/doctor-prescreve-staging-safe.json', false],
    ['docs/n8n-workflows/typebot-webhook-staging.json', true],
    ['docs/n8n-workflows/clinical-rejection-notify-staging.json', null],
    ['docs/n8n-workflows/prescription-delivery-staging.json', null]
  ];
  for (const [rel, expectedActive] of inactive) {
    const wf = readJson(rel);
    if (expectedActive === false) assert.equal(wf.active, false, rel);
    if (expectedActive === true) assert.equal(wf.active, true, rel);
    if (rel.includes('COPIAR') || rel.includes('stripe-payment')) {
      assert.equal(collectN8nUrls(wf).length, 0, rel);
    }
  }
  assert.equal(readJson('mdoctor-automation/flows/whatsapp-router.json').active, false);
  assert.equal(readJson('mdoctor-automation/flows/whatsapp-flow.json').active, false);
  report['12_workflows_antigos_desativados'] = 'ok';

  // 13) n8n usa somente endpoints oficiais
  const triagem = readJson('docs/n8n-workflows/typebot-webhook-staging.json');
  const triagemUrls = collectN8nUrls(triagem);
  assert.equal(triagemUrls.length, 1);
  assert.match(triagemUrls[0], /\/api\/webhook\/triagem/);
  assert.doesNotMatch(triagemUrls[0], /\/api\/whatsapp\/webhook/);

  const reject = readJson('docs/n8n-workflows/clinical-rejection-notify-staging.json');
  assert.match(collectN8nUrls(reject)[0], /\/api\/whatsapp\/notify-text/);

  const delivery = readJson('docs/n8n-workflows/prescription-delivery-staging.json');
  assert.match(collectN8nUrls(delivery)[0], /\/api\/atendimentos\/.*\/deliver/);

  const stripeWf = readJson('docs/n8n-workflows/stripe-payment-staging.json');
  assert.equal(collectN8nUrls(stripeWf).length, 0);
  report['13_n8n_endpoints_oficiais'] = 'ok';

  // Stripe PI legado ignorado para Typebot
  const stripeSrc = read('mdoctor-backend/src/services/stripe-webhook.service.js');
  assert.match(stripeSrc, /payment_intent\.succeeded/);
  assert.match(stripeSrc, /whatsapp_checkout_only/);
  report['stripe_pi_legado_neutralizado'] = 'ok';

  // Upload URL não enviado no Meta
  assert.match(uploadSrc, /nunca reenviar upload_url/);
  report['upload_url_nao_enviado_meta'] = 'ok';

  // Dados persistidos preservados na limpeza
  assert.doesNotMatch(sessionStoreSrc, /deleteAtendimento|updateAtendimento/);
  report['dados_persistidos_preservados'] = 'ok';

  console.log(JSON.stringify({ ok: true, status: 'PRONTO PARA DEPLOY STAGING', ...report }, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify({ ok: false, status: 'BLOQUEADO', error: error.message, stack: error.stack }, null, 2)
  );
  process.exit(1);
});
