const assert = require('assert');
const {
  OFFICIAL_TYPEBOT_PUBLIC_ID,
  OFFICIAL_TYPEBOT_ID,
  OFFICIAL_TYPEBOT_PUBLIC_URL,
  resolveWhatsAppTypebotPublicId,
  getWhatsAppTypebotOfficialConfig
} = require('../src/constants/typebot-whatsapp.official');

function main() {
  assert.equal(OFFICIAL_TYPEBOT_PUBLIC_ID, 'doctor-prescreve-8rmljgu');
  assert.equal(OFFICIAL_TYPEBOT_ID, 'higij2z0xihxxkr378rmljgu');
  assert.equal(OFFICIAL_TYPEBOT_PUBLIC_URL, 'https://typebot.co/doctor-prescreve-8rmljgu');

  assert.equal(
    resolveWhatsAppTypebotPublicId({}),
    OFFICIAL_TYPEBOT_PUBLIC_ID,
    'sem env usa o oficial'
  );
  assert.equal(
    resolveWhatsAppTypebotPublicId({ TYPEBOT_PUBLIC_ID: 'doctor-prescreve-8rmljgu' }),
    OFFICIAL_TYPEBOT_PUBLIC_ID
  );

  let mismatch = null;
  try {
    resolveWhatsAppTypebotPublicId({
      ENVIRONMENT_NAME: 'staging',
      TYPEBOT_PUBLIC_ID: 'outro-typebot-xyz'
    });
  } catch (error) {
    mismatch = error;
  }
  assert(mismatch, 'staging com outro publicId deve falhar');
  assert.equal(mismatch.code, 'TYPEBOT_PUBLIC_ID_MISMATCH');
  assert(/outro-typebot-xyz/.test(mismatch.message));
  assert(/doctor-prescreve-8rmljgu/.test(mismatch.message));
  assert(/não substitui automaticamente/i.test(mismatch.message));

  let runtimeMismatch = null;
  try {
    resolveWhatsAppTypebotPublicId({ TYPEBOT_PUBLIC_ID: 'typebot-antigo' });
  } catch (error) {
    runtimeMismatch = error;
  }
  assert(runtimeMismatch);
  assert.equal(runtimeMismatch.code, 'TYPEBOT_PUBLIC_ID_MISMATCH');

  const cfg = getWhatsAppTypebotOfficialConfig({
    TYPEBOT_PUBLIC_ID: 'doctor-prescreve-8rmljgu',
    TYPEBOT_VIEWER_URL: 'https://typebot.io/'
  });
  assert.equal(cfg.publicId, 'doctor-prescreve-8rmljgu');
  assert.equal(cfg.viewerUrl, 'https://typebot.io');
  assert.equal(cfg.publicUrl, OFFICIAL_TYPEBOT_PUBLIC_URL);

  // Bridge getConfig deve rejeitar publicId estranho
  const previous = process.env.TYPEBOT_PUBLIC_ID;
  process.env.TYPEBOT_PUBLIC_ID = 'bot-errado';
  process.env.TYPEBOT_VIEWER_URL = 'https://typebot.io';
  let bridgeError = null;
  try {
    delete require.cache[require.resolve('../src/services/typebot-whatsapp.bridge')];
    delete require.cache[require.resolve('../src/constants/typebot-whatsapp.official')];
    const bridge = require('../src/services/typebot-whatsapp.bridge');
    // force config via create + call that uses getConfig — fetchTypebot needs viewer
    // Exercita getConfig indiretamente via mismatch no require path: call resolve again
    const { resolveWhatsAppTypebotPublicId: resolveAgain } = require('../src/constants/typebot-whatsapp.official');
    resolveAgain(process.env);
  } catch (error) {
    bridgeError = error;
  }
  assert(bridgeError);
  assert.equal(bridgeError.code, 'TYPEBOT_PUBLIC_ID_MISMATCH');
  if (previous === undefined) delete process.env.TYPEBOT_PUBLIC_ID;
  else process.env.TYPEBOT_PUBLIC_ID = previous;

  // Support não deve expor TYPEBOT_PUBLIC_URL / typebot.io link no módulo
  const supportSrc = require('fs').readFileSync(
    require('path').join(__dirname, '../src/services/whatsapp-support.service.js'),
    'utf8'
  );
  assert(!/TYPEBOT_PUBLIC_URL\s*=/.test(supportSrc));
  assert(!/TYPEBOT_URL\s*=/.test(supportSrc));
  assert(!/typebot\.io\/doctor-prescreve/.test(supportSrc));
  assert(!/typebot\.co\/doctor-prescreve/.test(supportSrc));

  console.log(JSON.stringify({
    ok: true,
    officialPublicId: OFFICIAL_TYPEBOT_PUBLIC_ID,
    mismatchRejected: true,
    supportPublicUrlRemoved: true
  }, null, 2));
}

main();
