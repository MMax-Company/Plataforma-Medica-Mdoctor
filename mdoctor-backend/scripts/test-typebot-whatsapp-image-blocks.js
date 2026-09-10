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
  const png = Buffer.from('89504e470d0a1a0a', 'hex'); // assinatura PNG
  // mock: 1) download da imagem, 2) upload /media -> {id}, 3) POST /messages
  function installFetch({ uploadOk = true } = {}) {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.startsWith(LOGO)) {
        return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => png };
      }
      if (u.endsWith('/media')) {
        calls.push({ kind: 'upload', hasForm: typeof options.body?.append === 'function' });
        return uploadOk
          ? { ok: true, status: 200, json: async () => ({ id: 'MEDIA-123' }) }
          : { ok: false, status: 400, json: async () => ({ error: { message: 'nope', code: 'X' } }) };
      }
      // /messages
      const body = JSON.parse(options.body);
      calls.push({ kind: 'message', body });
      return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.img' }] }) };
    };
    return calls;
  }

  try {
    const calls = installFetch({ uploadOk: true });
    const res = await metaProvider.sendImageMessage({ to: '+5511999990000', imageUrl: LOGO, caption: 'Doctor Prescreve', idempotencyKey: 'k1' });
    const msg = calls.find((c) => c.kind === 'message').body;
    assert.equal(msg.type, 'image');
    assert.equal(msg.image.id, 'MEDIA-123', 'deve enviar por media_id (ordem preservada), não por link');
    assert.equal(msg.image.link, undefined);
    assert.equal(msg.image.caption, 'Doctor Prescreve');
    assert.ok(calls.some((c) => c.kind === 'upload'), 'deve ter subido a imagem primeiro');
    assert.equal(res.providerMessageId, 'wamid.img');
    console.log('OK   sendImageMessage sobe a imagem e envia por media_id (não por link)');
  } catch (e) {
    console.error('FAIL sendImageMessage por media_id\n     ' + e.message);
    process.exitCode = 1;
  }

  try {
    const calls = installFetch({ uploadOk: false });
    const res = await metaProvider.sendImageMessage({ to: '+5511999990000', imageUrl: LOGO + '?x=2', idempotencyKey: 'k2' });
    const msg = calls.find((c) => c.kind === 'message').body;
    assert.equal(msg.image.link, LOGO + '?x=2', 'upload falhou -> fallback para link');
    assert.equal(msg.image.id, undefined);
    assert.equal(res.providerMessageId, 'wamid.img');
    console.log('OK   upload falha -> fallback para image.link (não derruba)');
  } catch (e) {
    console.error('FAIL fallback link\n     ' + e.message);
    process.exitCode = 1;
  }

  try {
    const calls = installFetch({ uploadOk: true });
    await metaProvider.sendImageMessage({ to: '+5511999990000', mediaId: 'PRE-UP-9', idempotencyKey: 'k3' });
    const msg = calls.find((c) => c.kind === 'message').body;
    assert.equal(msg.image.id, 'PRE-UP-9');
    assert.ok(!calls.some((c) => c.kind === 'upload'), 'mediaId direto não re-sobe');
    console.log('OK   mediaId direto envia por id sem re-upload');
  } catch (e) {
    console.error('FAIL mediaId direto\n     ' + e.message);
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
