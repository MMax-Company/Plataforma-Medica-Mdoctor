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

  const menu = await routeMetaWhatsAppInbound({
      phone: '5511999999999',
      text: 'Oi',
      whatsappSession: { typebot_session_id: null }
    });
    assert.equal(menu.action, 'reply');
    assert.equal(menu.reply, MAIN_MENU_TEXT);

    const medical = await routeMetaWhatsAppInbound({
      phone: '5511999999999',
      text: '1',
      whatsappSession: { typebot_session_id: null }
    });
    assert.equal(medical.action, 'typebot_bootstrap');

    const support = await routeMetaWhatsAppInbound({
      phone: '5511999999999',
      text: '2',
      whatsappSession: { typebot_session_id: null }
    });
    assert.equal(support.action, 'reply');
    assert.equal(support.reply, 'Aguarde suporte');

    const ongoing = await routeMetaWhatsAppInbound({
      phone: '5511999999999',
      text: 'Max Matos',
      whatsappSession: { typebot_session_id: 'session-abc' }
    });
    assert.equal(ongoing.action, 'typebot');
    assert.equal(ongoing.text, 'Max Matos');

    console.log(JSON.stringify({ ok: true, metaMenuRouting: 'ok' }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
