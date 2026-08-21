// Smoke test contra o banco real (staging) de clearJourneyMarkers — usa um
// telefone de teste dedicado, cria/atualiza a sessão, confirma que só as
// duas chaves de jornada são removidas e o resto do metadata é preservado.
require('dotenv').config();
const { initSupabase } = require('../src/config/supabase');
initSupabase();
const assert = require('assert');
const {
  upsertSessionMetadata,
  clearJourneyMarkers,
  getSessionByPhone
} = require('../src/store/whatsapp-sessions.store');

const TEST_PHONE = '5511900000999';

async function main() {
  await upsertSessionMetadata({
    phone: TEST_PHONE,
    metadataPatch: {
      journey_started_at: '2026-01-01T00:00:00.000Z',
      welcome_clicked_at: '2026-01-01T00:01:00.000Z',
      other_key_preserved: 'valor-que-nao-deve-sumir'
    }
  });

  const before = await getSessionByPhone(TEST_PHONE);
  assert(before.metadata.journey_started_at, 'journey_started_at foi staged');
  assert(before.metadata.welcome_clicked_at, 'welcome_clicked_at foi staged');
  assert.equal(before.metadata.other_key_preserved, 'valor-que-nao-deve-sumir');
  console.log('OK: marcadores staged');

  await clearJourneyMarkers(TEST_PHONE);

  const after = await getSessionByPhone(TEST_PHONE);
  assert.equal(after.metadata.journey_started_at, undefined, 'journey_started_at foi removido');
  assert.equal(after.metadata.welcome_clicked_at, undefined, 'welcome_clicked_at foi removido');
  assert.equal(after.metadata.other_key_preserved, 'valor-que-nao-deve-sumir', 'demais chaves preservadas');
  console.log('OK: clearJourneyMarkers remove só as 2 chaves, preserva o resto');

  console.log('TODOS OS TESTES PASSARAM');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FALHOU:', err.message, err.stack);
    process.exit(1);
  });
