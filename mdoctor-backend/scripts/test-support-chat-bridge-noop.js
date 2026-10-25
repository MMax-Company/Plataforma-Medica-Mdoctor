const assert = require('assert');
const { createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');

process.env.TYPEBOT_VIEWER_URL = 'https://viewer.example.test';
process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';

async function runScenario({ sessionId }) {
  const finishes = [];
  let typebotCalls = 0;
  let providerCalls = 0;

  const bridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async (row) => finishes.push(row),
    reloadSession: async ({ whatsappSession }) => whatsappSession,
    resolveMetaInboundRouting: async () => ({ handled: true, action: 'noop' }),
    createIntegrationError: async () => {},
    callTypebot: async () => {
      typebotCalls += 1;
      throw new Error('Typebot não pode ser chamado após handled+noop');
    },
    provider: {
      sendTextMessage: async () => {
        providerCalls += 1;
        throw new Error('provider não pode enviar resposta após handled+noop');
      },
      sendButtonMessage: async () => {
        providerCalls += 1;
        throw new Error('provider não pode enviar resposta após handled+noop');
      },
      sendListMessage: async () => {
        providerCalls += 1;
        throw new Error('provider não pode enviar resposta após handled+noop');
      },
      sendCtaUrlMessage: async () => {
        providerCalls += 1;
        throw new Error('provider não pode enviar resposta após handled+noop');
      }
    }
  });

  const result = await bridge({
    messageId: sessionId ? 'wamid-noop-com-sessao' : 'wamid-noop-sem-sessao',
    text: 'Tudo bem?',
    identity: { phone: '5511999999999', bsuid: null },
    whatsappSession: {
      id: sessionId ? 'wa-noop-com-sessao' : 'wa-noop-sem-sessao',
      typebot_session_id: sessionId,
      metadata: {}
    }
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.noopHandled, true);
  assert.equal(result.responsesSent, 0);
  assert.equal(result.sessionId, sessionId || null);
  assert.equal(result.sessionIdReused, Boolean(sessionId));
  assert.equal(typebotCalls, 0, 'handled+noop deve encerrar antes de startChat/continueChat');
  assert.equal(providerCalls, 0, 'handled+noop não deve enviar resposta automática');
  assert.equal(finishes.length, 1, 'receipt Meta deve ser finalizado exatamente uma vez');
  assert.equal(finishes[0].status, 'processed');
  assert.deepEqual(finishes[0].providerMessageIds, []);
}

async function main() {
  // Caso real que falhou em produção: suporte ativo persiste a mensagem e
  // resolveMetaInboundRouting devolve noop. O bridge não pode cair em startChat.
  await runScenario({ sessionId: null });

  // Defesa adicional: mesmo que haja um sessionId Typebot residual/concorrente,
  // o noop já decidido pelo roteador continua terminal e não pode executar
  // continueChat.
  await runScenario({ sessionId: 'typebot-session-residual' });

  console.log('support-chat bridge noop: 2/2 cenários OK');
}

main().catch((error) => {
  console.error('FALHOU:', error.message);
  console.error(error.stack);
  process.exit(1);
});
