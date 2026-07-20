const assert = require('assert');

async function main() {
  require('../src/services/post-delivery-survey.service').handleSurveyInbound = async () => ({ handled: false });
  require('../src/services/whatsapp-support.service').handleRejectionResponse = async () => ({ handled: false });
  require('../src/services/whatsapp-support.service').getPatientSupportContext = async () => null;
  require('../src/services/whatsapp-support.service').createWhatsAppSupportEntry = async () => ({
    duplicate: false,
    reply: 'Aguarde suporte'
  });

  const { routeMetaWhatsAppInbound, MAIN_MENU_TEXT } = require('../src/services/whatsapp-meta-inbound.service');

  assert.equal(MAIN_MENU_TEXT, '1 - Iniciar atendimento\n2 - Suporte');
  assert(!MAIN_MENU_TEXT.includes('Iniciar Atendimento'));
  assert(!/typebot\.(io|co)\//i.test(MAIN_MENU_TEXT));

  const menu = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: 'Oi',
    whatsappSession: { typebot_session_id: null }
  });
  assert.equal(menu.action, 'reply');
  assert.equal(menu.reply, MAIN_MENU_TEXT);
  assert.equal(menu.clearTypebotSession, false);

  const medical = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: '1',
    whatsappSession: { typebot_session_id: null }
  });
  assert.equal(medical.action, 'typebot_bootstrap');
  assert.equal(medical.clearTypebotSession, true);

  const support = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: '2',
    whatsappSession: { typebot_session_id: null }
  });
  assert.equal(support.action, 'reply');
  assert.equal(support.reply, 'Aguarde suporte');
  assert.notEqual(support.action, 'typebot_bootstrap');
  assert.notEqual(support.action, 'typebot');
  assert.equal(support.clearTypebotSession, true);

  const other = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: 'xyz',
    whatsappSession: { typebot_session_id: null }
  });
  assert.equal(other.action, 'reply');
  assert.equal(other.reply, MAIN_MENU_TEXT);

  const ongoing = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: 'Max Matos',
    whatsappSession: { typebot_session_id: 'session-abc' }
  });
  assert.equal(ongoing.action, 'typebot');
  assert.equal(ongoing.text, 'Max Matos');
  assert.equal(ongoing.clearTypebotSession, undefined);

  const backToMenu = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: 'Oi',
    whatsappSession: { typebot_session_id: 'session-abc' }
  });
  assert.equal(backToMenu.action, 'reply');
  assert.equal(backToMenu.reply, MAIN_MENU_TEXT);
  assert.equal(backToMenu.clearTypebotSession, true);

  const MED_COUNT_INPUT = 'q78qjnk6ticw';
  const activeClinical = {
    typebot_session_id: 'session-clinical-1',
    metadata: { typebot_expected_input_id: MED_COUNT_INPUT }
  };

  const oneDuringClinical = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: '1',
    whatsappSession: activeClinical
  });
  assert.equal(oneDuringClinical.action, 'typebot');
  assert.equal(oneDuringClinical.text, '1');
  assert.equal(oneDuringClinical.clearTypebotSession, undefined);

  const twoDuringClinical = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: '2',
    whatsappSession: activeClinical
  });
  assert.equal(twoDuringClinical.action, 'typebot');
  assert.equal(twoDuringClinical.text, '2');

  const textDuringClinical = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: 'losartana',
    whatsappSession: {
      typebot_session_id: 'session-clinical-1',
      metadata: { typebot_expected_input_id: 'blk_med_name' }
    }
  });
  assert.equal(textDuringClinical.action, 'typebot');

  const staleSessionOne = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: '1',
    whatsappSession: { typebot_session_id: 'session-stale-no-input' }
  });
  assert.equal(staleSessionOne.action, 'typebot_bootstrap');

  const { createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');
  const uploadBridgeMocks = {
    findPendingUploadContext: async () => null,
    findUploadContextForPhone: async () => null,
    persistUploadContext: async () => {},
    uploadContextFromSession: () => null,
    augmentOutputsWithUploadLink: (outputs) => outputs,
    responseLooksLikeUploadStage: () => false,
    isUploadChoiceInput: () => false,
    isUploadConfirmationText: () => false,
    getUploadStatus: async () => ({ upload_completed: false })
  };
  const SESSION_ID = 'fhfy71suowpdmj4xn2kbtbqy';
  let storedSessionId = SESSION_ID;
  const continuePaths = [];
  const medCountBridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async ({ typebotSessionId }) => { storedSessionId = typebotSessionId; },
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: storedSessionId,
      metadata: { typebot_expected_input_id: MED_COUNT_INPUT }
    }),
    persistExpectedInput: async () => {},
    createIntegrationError: async () => {},
    callTypebot: async (path, body) => {
      continuePaths.push(path);
      assert.equal(body.message.text, '1');
      assert(path.includes(`/sessions/${SESSION_ID}/continueChat`));
      return { messages: [{ type: 'text', content: { plainText: 'Próximo passo' } }] };
    },
    provider: {
      sendTextMessage: async () => ({ providerMessageId: 'm1' }),
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    }
  });
  const routed = await routeMetaWhatsAppInbound({
    phone: '5511999999999',
    text: '1',
    whatsappSession: {
      id: 'wa-1',
      typebot_session_id: SESSION_ID,
      metadata: { typebot_expected_input_id: MED_COUNT_INPUT }
    }
  });
  assert.equal(routed.action, 'typebot');
  const bridgeResult = await medCountBridge({
    messageId: 'wamid-med-count-1',
    text: routed.text,
    identity: { phone: '5511999999999', bsuid: null },
    whatsappSession: {
      id: 'wa-1',
      typebot_session_id: SESSION_ID,
      metadata: { typebot_expected_input_id: MED_COUNT_INPUT }
    },
    menuBootstrap: false
  });
  assert.equal(storedSessionId, SESSION_ID);
  assert.equal(bridgeResult.sessionIdReused, true);
  assert.equal(continuePaths.length, 1);

  console.log(JSON.stringify({
    ok: true,
    metaMenuRouting: 'ok',
    menuText: MAIN_MENU_TEXT,
    preservesValidSession: ongoing.action === 'typebot',
    clinicalNumericToTypebot: oneDuringClinical.action === 'typebot',
    clearsIncompatibleOnMenu: backToMenu.clearTypebotSession === true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
