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

  console.log(JSON.stringify({
    ok: true,
    metaMenuRouting: 'ok',
    menuText: MAIN_MENU_TEXT,
    preservesValidSession: ongoing.action === 'typebot',
    clearsIncompatibleOnMenu: backToMenu.clearTypebotSession === true
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
