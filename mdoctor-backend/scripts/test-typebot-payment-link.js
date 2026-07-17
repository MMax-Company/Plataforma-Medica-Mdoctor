const assert = require('assert');
const {
  PAYMENT_SUCCESS_REPLY,
  completePaymentByToken,
  extractIntentId
} = require('../src/services/typebot-payment-link.service');

function makeSession(paymentPatch = {}) {
  return {
    id: 'wa-1',
    phone: '5511985485777',
    bsuid: null,
    metadata: {
      typebot_payment: {
        token: 'tok-1',
        status: 'pending',
        intent_id: 'pi_test_123',
        client_secret: 'pi_test_123_secret_abc',
        public_key: 'pk_test_x',
        amount_label: 'R$69.90',
        typebot_session_id: 'tb-session-1',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ...paymentPatch
      }
    }
  };
}

async function main() {
  assert.equal(extractIntentId('pi_3TuDxg_secret_xyz'), 'pi_3TuDxg');
  assert.equal(extractIntentId('seti_123_secret_x'), null);
  assert.equal(extractIntentId(''), null);

  // 1) Stripe ainda não confirmou: não pode reclamar conclusão nem continuar o flow
  let claimCalls = 0;
  const notPaid = await completePaymentByToken('tok-1', {
    session: makeSession(),
    retrieveIntent: async () => ({ status: 'requires_payment_method' }),
    claimCompletion: async () => { claimCalls += 1; return true; },
    callTypebot: async () => { throw new Error('não deveria continuar sem pagamento'); }
  });
  assert.deepEqual({ ok: notPaid.ok, code: notPaid.code }, { ok: false, code: 'NOT_PAID' });
  assert.equal(claimCalls, 0);

  // 2) Pagamento aprovado: continua a MESMA sessão Typebot com a resposta esperada
  const typebotCalls = [];
  const sent = [];
  const persisted = [];
  const success = await completePaymentByToken('tok-1', {
    session: makeSession(),
    retrieveIntent: async (intentId) => {
      assert.equal(intentId, 'pi_test_123');
      return { status: 'succeeded' };
    },
    claimCompletion: async () => true,
    callTypebot: async (path, body) => {
      typebotCalls.push({ path, body });
      return {
        sessionId: 'tb-session-1',
        messages: [{ type: 'text', content: { plainText: 'Pagamento confirmado! Vamos continuar.' } }],
        input: { id: 'next-input', type: 'text input' }
      };
    },
    provider: {
      sendTextMessage: async (payload) => { sent.push(payload); return { providerMessageId: `m-${sent.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    },
    upsertSessionIdentity: async (args) => { persisted.push(args); return {}; }
  });
  assert.equal(success.ok, true);
  assert.equal(success.responsesSent, 1);
  assert.equal(typebotCalls.length, 1);
  assert(typebotCalls[0].path.includes('/sessions/tb-session-1/continueChat'));
  assert.equal(typebotCalls[0].body.message.text, PAYMENT_SUCCESS_REPLY);
  assert.equal(sent[0].to, '5511985485777');
  assert.equal(persisted[0].metadataPatch.typebot_expected_input_id, 'next-input');

  // 3) Já concluído: idempotente, sem novo continueChat (sem duplicidade)
  const already = await completePaymentByToken('tok-1', {
    session: makeSession({ status: 'completed' }),
    retrieveIntent: async () => { throw new Error('não deveria consultar Stripe de novo'); },
    callTypebot: async () => { throw new Error('não deveria continuar de novo'); }
  });
  assert.deepEqual({ ok: already.ok, alreadyCompleted: already.alreadyCompleted }, { ok: true, alreadyCompleted: true });

  // 4) Corrida: outro request ganhou o claim → idempotente
  const raced = await completePaymentByToken('tok-1', {
    session: makeSession(),
    retrieveIntent: async () => ({ status: 'succeeded' }),
    claimCompletion: async () => false,
    callTypebot: async () => { throw new Error('perdedor da corrida não continua o flow'); }
  });
  assert.deepEqual({ ok: raced.ok, alreadyCompleted: raced.alreadyCompleted }, { ok: true, alreadyCompleted: true });

  // 5) Falha após o claim: reverte para pending (permite retry) e propaga erro
  let reverted = 0;
  const logged = [];
  await assert.rejects(
    completePaymentByToken('tok-1', {
      session: makeSession(),
      retrieveIntent: async () => ({ status: 'succeeded' }),
      claimCompletion: async () => true,
      revertToPending: async () => { reverted += 1; },
      createIntegrationError: async (row) => { logged.push(row); },
      callTypebot: async () => { throw new Error('viewer indisponível'); }
    }),
    /viewer indisponível/
  );
  assert.equal(reverted, 1);
  assert.equal(logged.length, 1);

  // 6) Link expirado
  const expired = await completePaymentByToken('tok-1', {
    session: makeSession({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    retrieveIntent: async () => ({ status: 'succeeded' })
  });
  assert.deepEqual({ ok: expired.ok, code: expired.code }, { ok: false, code: 'EXPIRED' });

  console.log(JSON.stringify({
    intentIdExtraction: 'ok',
    unpaidIntentBlocksContinuation: 'ok',
    paidIntentContinuesSameTypebotSession: 'ok',
    completedIsIdempotent: 'ok',
    raceLoserDoesNotDuplicate: 'ok',
    failureAfterClaimRevertsToPending: 'ok',
    expiredLinkRejected: 'ok'
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });
