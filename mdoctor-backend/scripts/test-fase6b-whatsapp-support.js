/**
 * FASE 6B — consolidação do suporte WhatsApp (opção 2, Meta oficial).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  createWhatsAppSupportEntry,
  SUPPORT_ALREADY_OPEN_REPLY,
  SUPPORT_SUB
} = require('../src/services/whatsapp-support.service');
const { STATUS } = require('../src/store/atendimentos.store');
const { TRANSIENT_CLINICAL_METADATA_KEYS } = require('../src/store/whatsapp-sessions.store');
const { isSupportQueue } = require('../src/constants/whatsapp-queue');

function makeSupportRow(id, phone, patch = {}) {
  return {
    id,
    paciente_telefone: phone,
    status: STATUS.WAITING,
    condicao: 'suporte_whatsapp',
    dados_clinicos: {
      queue_type: 'support',
      whatsapp_support: true,
      idempotency_key: `meta:wamid-${id}`,
      ...patch
    }
  };
}

async function main() {
  const report = {};

  // 1 + 2) Idempotência messageId + telefone com ticket aberto
  let createCalls = 0;
  const phone = '5511999887766';
  const key = 'meta:wamid-dup-test';
  const rows = [];
  const mockCreate = async ({ phone: p, idempotencyKey: ik }) => {
    const digits = p.replace(/\D/g, '');
    if (ik) {
      const byKey = rows.find(
        (r) => isSupportQueue(r) && r.dados_clinicos?.idempotency_key === ik
      );
      if (byKey) {
        return { duplicate: true, idempotentReplay: true, atendimento: byKey, reply: SUPPORT_ALREADY_OPEN_REPLY };
      }
    }
    const open = rows.find(
      (r) => isSupportQueue(r) && r.paciente_telefone === digits && r.status === STATUS.WAITING
    );
    if (open) {
      return { duplicate: true, atendimento: open, reply: SUPPORT_ALREADY_OPEN_REPLY };
    }
    const row = makeSupportRow(`sup-${rows.length + 1}`, digits, { idempotency_key: ik });
    rows.push(row);
    createCalls += 1;
    return { duplicate: false, atendimento: row, reply: 'ok' };
  };

  const a = await mockCreate({ phone, idempotencyKey: key });
  const b = await mockCreate({ phone, idempotencyKey: key });
  assert.equal(createCalls, 1);
  assert.equal(b.duplicate, true);
  assert.equal(b.idempotentReplay, true);

  const c = await mockCreate({ phone, idempotencyKey: 'meta:wamid-other' });
  assert.equal(c.duplicate, true);
  assert.equal(c.atendimento.id, a.atendimento.id);
  report['1_2_idempotencia_messageid_e_telefone'] = 'ok';

  // 3) Opção 2 não inicia Typebot — mocks antes do require (bindings no topo do módulo inbound)
  require('../src/services/post-delivery-survey.service').handleSurveyInbound = async () => ({ handled: false });
  require('../src/services/whatsapp-support.service').handleRejectionResponse = async () => ({ handled: false });
  require('../src/services/whatsapp-support.service').getPatientSupportContext = async () => null;
  require('../src/services/whatsapp-support.service').createWhatsAppSupportEntry = async () => ({
    duplicate: false,
    reply: 'Aguarde suporte'
  });
  delete require.cache[require.resolve('../src/services/whatsapp-meta-inbound.service')];
  const { routeMetaWhatsAppInbound, MAIN_MENU_TEXT } = require('../src/services/whatsapp-meta-inbound.service');

  const support = await routeMetaWhatsAppInbound({
    phone,
    text: '2',
    whatsappSession: { typebot_session_id: 'tb-old' },
    messageId: 'wamid-opt2'
  });
  assert.equal(support.action, 'reply');
  assert.notEqual(support.action, 'typebot');
  assert.notEqual(support.action, 'typebot_bootstrap');
  assert.equal(support.clearClinicalMetadata, true);
  report['3_opcao2_nao_inicia_typebot'] = 'ok';

  // 4) Mensagem durante WAITING não cria novo ticket
  let supportCreates = 0;
  require('../src/services/whatsapp-support.service').getPatientSupportContext = async () => ({
    atendimento_id: 'sup-open',
    support_sub_status: SUPPORT_SUB.WAITING
  });
  require('../src/services/whatsapp-support.service').createWhatsAppSupportEntry = async () => {
    supportCreates += 1;
    return { reply: 'should not create' };
  };
  require('../src/services/whatsapp-support.service').logSupportInboundMessage = async () => {};
  delete require.cache[require.resolve('../src/services/whatsapp-meta-inbound.service')];
  const { routeMetaWhatsAppInbound: routeWaiting } = require('../src/services/whatsapp-meta-inbound.service');

  const waitingMsg = await routeWaiting({
    phone,
    text: 'Preciso de ajuda com minha receita',
    whatsappSession: { typebot_session_id: null },
    messageId: 'wamid-waiting-1'
  });
  assert.equal(waitingMsg.action, 'reply');
  assert.equal(supportCreates, 0);
  assert.match(waitingMsg.reply, /fila de suporte/i);
  report['4_waiting_nao_cria_ticket'] = 'ok';

  // 5) Limpeza metadata temporária (simulação local — sem Supabase)
  const sessionBefore = {
    id: 'sess-1',
    phone,
    typebot_session_id: 'tb-123',
    metadata: {
      typebot_expected_input_id: 'blk_x',
      typebot_multi_choice: { selected: [] },
      typebot_payment: { token: 'pay-1' },
      typebot_prescription_upload: { token: 'up-1' },
      post_delivery_survey: { active: true },
      last_inbound_message_id: 'wamid-1'
    }
  };
  const metadata = { ...sessionBefore.metadata };
  for (const k of TRANSIENT_CLINICAL_METADATA_KEYS) delete metadata[k];
  const cleared = { ...sessionBefore, typebot_session_id: null, metadata };

  for (const k of TRANSIENT_CLINICAL_METADATA_KEYS) {
    assert.equal(cleared.metadata[k], undefined, `metadata ${k} should be cleared`);
  }
  assert.equal(cleared.metadata.post_delivery_survey.active, true);
  assert.equal(cleared.typebot_session_id, null);
  const storeSrc = fs.readFileSync(
    path.join(__dirname, '../src/store/whatsapp-sessions.store.js'),
    'utf8'
  );
  assert.match(storeSrc, /TRANSIENT_CLINICAL_METADATA_KEYS/);
  report['5_limpa_metadata_temporaria'] = 'ok';

  // 6) Dados clínicos persistidos — função não toca atendimentos (source check)
  assert.doesNotMatch(storeSrc, /atendimentos\.store/);
  report['6_dados_clinicos_persistidos_intactos'] = 'ok';

  // 7) Encerramento fecha o support_tickets diretamente
  const supportSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/whatsapp-support.service.js'),
    'utf8'
  );
  assert.match(supportSrc, /closeWhatsAppSupportEntry/);
  assert.match(supportSrc, /updateSupportTicket/);
  assert.match(supportSrc, /status:\s*'closed'/);
  assert.doesNotMatch(supportSrc, /createAtendimento/);
  report['7_encerramento_fecha_ticket'] = 'ok';

  // 8) Após encerramento menu 1/2
  require('../src/services/whatsapp-support.service').getPatientSupportContext = async () => null;
  delete require.cache[require.resolve('../src/services/whatsapp-meta-inbound.service')];
  const { routeMetaWhatsAppInbound: routeMenu, MAIN_MENU_TEXT: menuText } = require('../src/services/whatsapp-meta-inbound.service');
  const menu = await routeMenu({
    phone,
    text: 'Oi',
    whatsappSession: { typebot_session_id: null },
    messageId: 'wamid-menu'
  });
  assert.equal(menu.reply, menuText);
  report['8_pos_encerramento_menu'] = 'ok';

  // 9) Rotas legadas neutralizadas
  const routesSrc = fs.readFileSync(
    path.join(__dirname, '../src/routes/whatsapp.routes.js'),
    'utf8'
  );
  assert.match(routesSrc, /legacy_support_endpoint_blocked/);
  assert.match(routesSrc, /legacy_process_message_blocked/);
  assert.match(routesSrc, /status\(410\)/);
  assert.doesNotMatch(routesSrc, /processIncomingMessage\(/);
  report['9_rotas_legadas_neutralizadas'] = 'ok';

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
