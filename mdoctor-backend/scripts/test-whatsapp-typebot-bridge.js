const assert = require('assert');
const { createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');

process.env.TYPEBOT_VIEWER_URL = 'https://viewer.example.test';
process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';

async function main() {
  const calls = [];
  const sent = [];
  const receipts = new Set();
  let savedSessionId = null;
  const bridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async ({ messageId }) => {
      if (receipts.has(messageId)) return { claimed: false };
      receipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async (row) => calls.push({ kind: 'finish', ...row }),
    setTypebotSessionId: async ({ typebotSessionId }) => { savedSessionId = typebotSessionId; },
    createIntegrationError: async () => {},
    callTypebot: async (path, body) => {
      calls.push({ kind: 'typebot', path, body });
      if (path.includes('/startChat')) return {
        sessionId: 'session-123',
        messages: [{ type: 'text', content: { richText: [{ type: 'p', children: [{ text: 'Olá! Como podemos ajudar?' }] }] } }],
        input: { type: 'choice input', items: [{ id: 'a', content: 'Continuar' }] }
      };
      return { messages: [{ type: 'text', content: { plainText: 'Sessão continuada.' } }] };
    },
    provider: {
      sendTextMessage: async (payload) => { sent.push({ type: 'text', payload }); return { providerMessageId: `meta-${sent.length}` }; },
      sendButtonMessage: async (payload) => { sent.push({ type: 'buttons', payload }); return { providerMessageId: `meta-${sent.length}` }; },
      sendListMessage: async (payload) => { sent.push({ type: 'list', payload }); return { providerMessageId: `meta-${sent.length}` }; }
    }
  });

  const identity = { phone: '5511999999999', bsuid: null };
  const first = await bridge({ messageId: 'wamid-1', text: 'Oi', identity, whatsappSession: { id: 'wa-session-1', typebot_session_id: null } });
  assert.equal(first.duplicate, false);
  assert.equal(savedSessionId, 'session-123');
  assert(calls.find((call) => call.path?.includes('/startChat')));
  assert.deepEqual(sent.map((item) => item.type), ['text', 'buttons']);

  const second = await bridge({ messageId: 'wamid-2', text: 'Continuar', identity, whatsappSession: { id: 'wa-session-1', typebot_session_id: savedSessionId } });
  assert.equal(second.sessionIdReused, true);
  assert(calls.find((call) => call.path?.includes('/sessions/session-123/continueChat')));

  const sentBeforeDuplicate = sent.length;
  const duplicate = await bridge({ messageId: 'wamid-2', text: 'Continuar', identity, whatsappSession: { id: 'wa-session-1', typebot_session_id: savedSessionId } });
  assert.equal(duplicate.duplicate, true);
  assert.equal(sent.length, sentBeforeDuplicate);

  console.log(JSON.stringify({
    patientSendsOi: 'ok',
    typebotRepliesOnWhatsApp: sent.some((item) => item.type === 'text') && sent.some((item) => item.type === 'buttons') ? 'ok' : 'failed',
    nextReplyReusesSessionId: second.sessionIdReused ? 'ok' : 'failed',
    duplicateDoesNotDoubleReply: sent.length === sentBeforeDuplicate ? 'ok' : 'failed'
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });

