// Teste de integração (banco real de staging + API real do Typebot,
// telefone de teste isolado, provider falso) do incidente 2026-07-21:
// sessão parada no choice input "Vamos começar" (grupo Bem-Vindo) + "1"
// não pode mais gerar a mensagem "Invalid message. Please, try again."
// do próprio Typebot, nem reencaminhar por continueChat. Deve reiniciar
// via startChat (nova sessão) e enviar normalmente a saudação.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');

process.env.TYPEBOT_VIEWER_URL = process.env.TYPEBOT_VIEWER_URL || 'https://typebot.io';
process.env.TYPEBOT_PUBLIC_ID = process.env.TYPEBOT_PUBLIC_ID || 'doctor-prescreve-8rmljgu';

require('../src/config/supabase').initSupabase();
const { createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');
const { getSessionByPhone, upsertSessionIdentity } = require('../src/store/whatsapp-sessions.store');

const TEST_PHONE = '5511900000998'; // número fake, isolado, não usado em produção
const WELCOME_CHOICE_INPUT_ID = 'sbjZWLJGVkHAkDqS4JQeGow';

const sentTexts = [];
const fakeProvider = {
  async sendTextMessage(args) { sentTexts.push(String(args.text || '')); return { providerMessageId: 'fake-' + Date.now() }; },
  async sendButtonMessage(args) { sentTexts.push(String(args.body || '') + ' ' + JSON.stringify((args.buttons || []).map((b) => b.title))); return { providerMessageId: 'fake-' + Date.now() }; },
  async sendListMessage() { return { providerMessageId: 'fake-' + Date.now() }; },
  async sendCtaUrlMessage() { return { providerMessageId: 'fake-' + Date.now() }; },
  async sendDocumentMessage() { return { providerMessageId: 'fake-' + Date.now() }; }
};

(async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  await supabase.from('whatsapp_sessions').delete().eq('phone', TEST_PHONE);

  // Seed: sessão obsoleta parada exatamente no choice input "Vamos começar",
  // com um typebot_session_id que já não corresponde a nenhuma conversa real
  // em andamento (simula o incidente real).
  await supabase.from('whatsapp_sessions').insert({
    phone: TEST_PHONE,
    provider: 'meta',
    status: 'active',
    typebot_session_id: 'sess-obsoleta-simulada',
    metadata: { typebot_expected_input_id: WELCOME_CHOICE_INPUT_ID },
    created_at: '2026-07-21T20:00:00.000Z',
    updated_at: '2026-07-21T20:00:00.000Z',
    last_message_at: '2026-07-21T20:00:00.000Z'
  });

  const bridge = createTypebotWhatsAppBridge({ provider: fakeProvider });
  const identity = { phone: TEST_PHONE, bsuid: null, parentBsuid: null, username: 'Teste Integração' };
  const whatsappSession = await upsertSessionIdentity({ phone: identity.phone, bsuid: identity.bsuid });

  const result = await bridge({ messageId: 'welcome-stale-repro-' + Date.now(), text: '1', identity, whatsappSession });

  const combinedText = sentTexts.join(' | ');
  assert.ok(!/Invalid message/i.test(combinedText), `Não deveria conter "Invalid message". Enviado: ${combinedText}`);
  assert.equal(result.sessionIdReused, false, 'Deveria iniciar sessão nova (startChat), não reaproveitar a obsoleta');
  assert.notEqual(result.sessionId, 'sess-obsoleta-simulada', 'sessionId final não deveria ser o obsoleto');

  const finalSession = await getSessionByPhone(TEST_PHONE);
  assert.notEqual(finalSession.typebot_session_id, 'sess-obsoleta-simulada', 'sessão obsoleta deveria ter sido limpa e substituída');

  await supabase.from('whatsapp_sessions').delete().eq('phone', TEST_PHONE);

  console.log(JSON.stringify({
    semMensagemInvalidMessage: 'ok',
    reiniciouComStartChatEmVezDeContinueChat: 'ok',
    sessaoObsoletaSubstituida: 'ok',
    textosEnviados: sentTexts
  }, null, 2));
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
