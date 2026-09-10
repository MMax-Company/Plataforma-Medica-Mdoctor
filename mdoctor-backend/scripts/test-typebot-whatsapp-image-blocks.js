/**
 * Suporte a blocos de imagem no bridge Typebot -> WhatsApp.
 * Roda offline (sem Meta/Typebot reais):
 *   node mdoctor-backend/scripts/test-typebot-whatsapp-image-blocks.js
 *
 * Cobre:
 *  - imagem vira output { kind: 'image' } com a URL crua (nunca link textual);
 *  - ordem preservada: imagem -> texto -> pergunta -> opções;
 *  - caption opcional (content.caption / content.plainText);
 *  - mensagem de imagem sem URL é ignorada;
 *  - o provider Meta monta payload `type: image` com `image.link`;
 *  - URL de imagem inválida lança META_INVALID_IMAGE_URL (o bridge trata e
 *    segue sem derrubar a sessão — ver laço de envio em typebot-whatsapp.bridge).
 */
const assert = require('assert');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');

function run(label, fn) {
  try {
    fn();
    console.log(`OK   ${label}`);
  } catch (error) {
    console.error(`FAIL ${label}\n     ${error.message}`);
    process.exitCode = 1;
  }
}

const LOGO = 'https://s3.typebot.io/public/workspaces/ws/typebots/tb/blocks/img1?v=1';

run('imagem -> texto -> pergunta preserva a ordem e a URL crua', () => {
  const outputs = convertTypebotResponse({
    messages: [
      { type: 'image', content: { url: LOGO } },
      { type: 'text', content: { plainText: 'Bem-vindo ao Doctor Prescreve.' } }
    ],
    input: { id: 'i1', type: 'choice input', items: [{ content: 'Começar' }] }
  });
  assert.deepEqual(outputs.map((o) => o.kind), ['image', 'text', 'buttons']);
  assert.equal(outputs[0].url, LOGO);
  assert.equal(outputs[0].caption, undefined);
  // nunca deve virar link em texto
  assert.ok(!outputs.some((o) => o.kind === 'text' && String(o.text).includes(LOGO)));
});

run('caption vem de content.caption quando presente', () => {
  const [img] = convertTypebotResponse({
    messages: [{ type: 'image', content: { url: LOGO, caption: 'Doctor Prescreve' } }],
    input: {}
  });
  assert.equal(img.kind, 'image');
  assert.equal(img.caption, 'Doctor Prescreve');
});

run('caption cai para content.plainText se não houver caption', () => {
  const [img] = convertTypebotResponse({
    messages: [{ type: 'image', content: { url: LOGO, plainText: 'Legenda alternativa' } }],
    input: {}
  });
  assert.equal(img.caption, 'Legenda alternativa');
});

run('imagem sem URL é ignorada (não entra nos outputs)', () => {
  const outputs = convertTypebotResponse({
    messages: [
      { type: 'image', content: {} },
      { type: 'text', content: { plainText: 'texto' } }
    ],
    input: {}
  });
  assert.deepEqual(outputs.map((o) => o.kind), ['text']);
});

run('content.url pode vir como objeto { url }', () => {
  const [img] = convertTypebotResponse({
    messages: [{ type: 'image', content: { url: { url: LOGO } } }],
    input: {}
  });
  assert.equal(img.kind, 'image');
  assert.equal(img.url, LOGO);
});

// -------- provider Meta: payload type: image --------
(async () => {
  const metaProvider = require('../src/services/providers/meta.provider');
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-test';
  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'waba-test';

  const originalFetch = global.fetch;
  let lastBody = null;
  global.fetch = async (url, options = {}) => {
    lastBody = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.img' }] }) };
  };

  try {
    const res = await metaProvider.sendImageMessage({
      to: '+5511999990000',
      imageUrl: LOGO,
      caption: 'Doctor Prescreve',
      idempotencyKey: 'k1'
    });
    assert.equal(lastBody.type, 'image');
    assert.equal(lastBody.image.link, LOGO);
    assert.equal(lastBody.image.caption, 'Doctor Prescreve');
    assert.equal(res.providerMessageId, 'wamid.img');
    console.log('OK   sendImageMessage monta type:image com image.link e caption');
  } catch (e) {
    console.error('FAIL sendImageMessage payload\n     ' + e.message);
    process.exitCode = 1;
  }

  try {
    let threw = null;
    try {
      await metaProvider.sendImageMessage({ to: '+5511999990000', imageUrl: 'http://inseguro/img.png' });
    } catch (e) {
      threw = e.code;
    }
    assert.equal(threw, 'META_INVALID_IMAGE_URL');
    console.log('OK   URL não-HTTPS lança META_INVALID_IMAGE_URL (bridge trata no laço)');
  } catch (e) {
    console.error('FAIL validação de URL\n     ' + e.message);
    process.exitCode = 1;
  }

  global.fetch = originalFetch;
  console.log(process.exitCode ? 'FALHOU' : 'PASS: blocos de imagem Typebot -> WhatsApp');
})();
