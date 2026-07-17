const assert = require('assert');
const { convertTypebotResponse, createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');
const { validatePersonalInput } = require('../src/services/typebot-personal-data.validation');

process.env.TYPEBOT_VIEWER_URL = 'https://viewer.example.test';
process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
process.env.TYPEBOT_RETRY_ATTEMPTS = '4';
process.env.TYPEBOT_RETRY_BASE_DELAY_MS = '300';
process.env.TYPEBOT_RETRY_MAX_DELAY_MS = '2500';

async function main() {
  const calls = [];
  const sent = [];
  const receipts = new Set();
  let savedSessionId = null;
  let storedSessionId = null;
  let storedExpectedInputId = null;
  const bridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async ({ messageId }) => {
      if (receipts.has(messageId)) return { claimed: false };
      receipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async (row) => calls.push({ kind: 'finish', ...row }),
    setTypebotSessionId: async ({ typebotSessionId }) => {
      savedSessionId = typebotSessionId;
      storedSessionId = typebotSessionId;
    },
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: storedSessionId,
      metadata: { typebot_expected_input_id: storedExpectedInputId }
    }),
    persistExpectedInput: async ({ inputId }) => { storedExpectedInputId = inputId; },
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

  const rapidCalls = [];
  let rapidStoredSessionId = null;
  let releaseStart;
  const startGate = new Promise((resolve) => { releaseStart = resolve; });
  const rapidBridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async ({ typebotSessionId }) => { rapidStoredSessionId = typebotSessionId; },
    reloadSession: async ({ whatsappSession }) => ({ ...whatsappSession, typebot_session_id: rapidStoredSessionId }),
    persistExpectedInput: async () => {},
    createIntegrationError: async () => {},
    callTypebot: async (path, body) => {
      rapidCalls.push({ path, body });
      if (path.includes('/startChat')) {
        await startGate;
        return { sessionId: 'rapid-session', messages: [] };
      }
      return { messages: [] };
    },
    provider: {
      sendTextMessage: async () => ({}),
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    }
  });
  const emptySession = { id: 'wa-rapid', typebot_session_id: null };
  const rapidFirst = rapidBridge({ messageId: 'rapid-1', text: 'sim', identity, whatsappSession: emptySession });
  const rapidSecond = rapidBridge({ messageId: 'rapid-2', text: 'Max Vinicius Ferreira Matos', identity, whatsappSession: emptySession });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rapidCalls.length, 1, 'a segunda mensagem deve aguardar a primeira');
  releaseStart();
  await Promise.all([rapidFirst, rapidSecond]);
  assert.deepEqual(rapidCalls.map((call) => call.body.message.text), ['sim', 'Max Vinicius Ferreira Matos']);
  assert.deepEqual(rapidCalls.map((call) => call.body.message.metadata.replyId), ['rapid-1', 'rapid-2']);
  assert(rapidCalls[0].path.includes('/startChat'));
  assert(rapidCalls[1].path.includes('/sessions/rapid-session/continueChat'));

  const retryCalls = [];
  const retryFinishes = [];
  const retryLogs = [];
  const retryDelays = [];
  const retryReceipts = new Set();
  let retryStoredSessionId = null;
  const retryBridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async ({ messageId }) => {
      if (retryReceipts.has(messageId)) return { claimed: false };
      retryReceipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async (row) => retryFinishes.push(row),
    setTypebotSessionId: async ({ typebotSessionId }) => { retryStoredSessionId = typebotSessionId; },
    reloadSession: async ({ whatsappSession }) => ({ ...whatsappSession, typebot_session_id: retryStoredSessionId }),
    persistExpectedInput: async () => {},
    createIntegrationError: async (row) => retryLogs.push(row),
    sleep: async (delayMs) => { retryDelays.push(delayMs); },
    callTypebot: async (path, body) => {
      retryCalls.push({ path, body });
      if (retryCalls.length === 1) {
        const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        throw Object.assign(new TypeError('fetch failed'), { cause });
      }
      if (retryCalls.length === 2) {
        const cause = Object.assign(new Error('DNS temporário'), { code: 'EAI_AGAIN' });
        throw Object.assign(new TypeError('fetch failed'), { cause });
      }
      return {
        sessionId: 'retry-session',
        messages: [{ type: 'text', content: { plainText: 'Recuperado.' } }],
        input: { id: 'ds9z9lnz3yayokyy8d81fudj', type: 'text input' }
      };
    },
    provider: {
      sendTextMessage: async () => ({ providerMessageId: 'meta-retry-1' }),
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    }
  });
  const retryPayload = {
    messageId: 'retry-1',
    text: 'Oi',
    identity,
    whatsappSession: { id: 'wa-retry', typebot_session_id: null }
  };
  const recovered = await retryBridge(retryPayload);
  const retryDuplicate = await retryBridge(retryPayload);
  assert.equal(recovered.duplicate, false);
  assert.equal(retryDuplicate.duplicate, true);
  assert.equal(retryCalls.length, 3, 'deve recuperar sem reenvio manual');
  assert.deepEqual(retryDelays, [300, 600]);
  assert.deepEqual(retryFinishes.map((item) => item.status), ['processed']);
  assert.equal(retryLogs.length, 2);
  assert(retryLogs[0].error.message.includes('ECONNRESET'));
  assert(retryLogs[1].error.message.includes('EAI_AGAIN'));
  assert(retryCalls.every((call) => call.body.message.metadata.replyId === 'retry-1'));

  const fixedNow = new Date('2026-07-17T12:00:00Z');
  const birthInputId = 'ar8jtu7sa8gfndqeebrvyj15';
  assert.equal(validatePersonalInput(birthInputId, '18/07/2008', { now: fixedNow }).valid, false);
  assert.equal(validatePersonalInput(birthInputId, '17/07/2008', { now: fixedNow }).valid, true);
  assert.equal(validatePersonalInput(birthInputId, '16/07/1945', { now: fixedNow }).valid, false);
  assert.equal(validatePersonalInput(birthInputId, '17/07/1946', { now: fixedNow }).valid, true);

  const validationCases = [
    { id: 'ds9z9lnz3yayokyy8d81fudj', invalid: 'Max', valid: 'Max Vinicius' },
    { id: birthInputId, invalid: '31/02/2000', valid: '09/02/1988' },
    { id: 'dein7u2qnr8q32p2lv1krd5p', invalid: '11111111111', valid: '52998224725' },
    { id: 'tbla9w2i2kbeyzun88hai3s9', invalid: '119123', valid: '11985485777' },
    { id: 'dwoaqosurlamebpra9yf7pm4', invalid: 'max@', valid: 'max@example.com' },
    { id: 'q78qjnk6ticwkeifl7xe2rju', invalid: 'Rua A', valid: 'Rua Aurora, 965' },
    { id: 'blk_0oydu2f7', invalid: '123', valid: '01209003' }
  ];
  const validationResults = [];
  for (const [index, testCase] of validationCases.entries()) {
    const validationReceipts = new Set();
    const validationCalls = [];
    const validationSent = [];
    let expectedInputId = testCase.id;
    const validationBridge = createTypebotWhatsAppBridge({
      claimMetaMessage: async ({ messageId }) => {
        if (validationReceipts.has(messageId)) return { claimed: false };
        validationReceipts.add(messageId);
        return { claimed: true };
      },
      finishMetaMessage: async () => {},
      setTypebotSessionId: async () => {},
      reloadSession: async ({ whatsappSession }) => ({
        ...whatsappSession,
        metadata: { typebot_expected_input_id: expectedInputId }
      }),
      persistExpectedInput: async ({ inputId }) => { expectedInputId = inputId; },
      createIntegrationError: async () => {},
      now: () => fixedNow,
      callTypebot: async (path, body) => {
        validationCalls.push({ path, body });
        return {
          messages: [{ type: 'text', content: { plainText: 'Próxima pergunta.' } }],
          input: { id: `next-${index}`, type: 'text input' }
        };
      },
      provider: {
        sendTextMessage: async (payload) => {
          validationSent.push(payload);
          return { providerMessageId: `validation-${validationSent.length}` };
        },
        sendButtonMessage: async () => ({}),
        sendListMessage: async () => ({})
      }
    });
    const whatsappSession = { id: `wa-validation-${index}`, typebot_session_id: 'existing-session' };
    const invalidMessageId = `validation-${index}-invalid`;
    const invalid = await validationBridge({ messageId: invalidMessageId, text: testCase.invalid, identity, whatsappSession });
    const duplicateInvalid = await validationBridge({ messageId: invalidMessageId, text: testCase.invalid, identity, whatsappSession });
    assert.equal(invalid.validationFailed, true);
    assert.equal(duplicateInvalid.duplicate, true);
    assert.equal(validationCalls.length, 0, 'valor inválido não pode chegar ao Typebot');
    assert.equal(expectedInputId, testCase.id, 'valor inválido deve manter o mesmo input');
    assert(validationSent[0].text.includes(validatePersonalInput(testCase.id, testCase.invalid, { now: fixedNow }).question));

    const validMessageId = `validation-${index}-valid`;
    const valid = await validationBridge({ messageId: validMessageId, text: testCase.valid, identity, whatsappSession });
    assert.equal(valid.validationFailed, undefined);
    assert.equal(validationCalls.length, 1);
    assert.equal(validationCalls[0].body.message.metadata.replyId, validMessageId);
    assert.equal(expectedInputId, `next-${index}`);
    validationResults.push('ok');
  }

  assert.deepEqual(
    convertTypebotResponse({
      messages: [],
      input: {
        id: 'blk_n5x21i7c',
        type: 'text input',
        options: { labels: { placeholder: 'Dose (ex.: 50 mg)', button: 'Enviar' } }
      }
    }),
    [{ kind: 'text', text: 'Dose (ex.: 50 mg)' }],
    'text input sem mensagem deve enviar placeholder ao WhatsApp'
  );
  assert.deepEqual(
    convertTypebotResponse({
      messages: [{ type: 'text', content: { plainText: 'Medicamento 1 de 1 — informe:' } }],
      input: {
        id: 'blk_xp763m78',
        type: 'text input',
        options: { labels: { placeholder: 'Nome do medicamento', button: 'Enviar' } }
      }
    }).map((item) => item.text),
    ['Medicamento 1 de 1 — informe:'],
    'text input com mensagem anterior não deve duplicar placeholder'
  );

  const medDoseSent = [];
  const medDoseReceipts = new Set();
  let medDoseExpectedInputId = 'blk_xp763m78';
  const medDoseBridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async ({ messageId }) => {
      if (medDoseReceipts.has(messageId)) return { claimed: false };
      medDoseReceipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'fhfy71suowpdmj4xn2kbtbqy',
      metadata: { typebot_expected_input_id: medDoseExpectedInputId }
    }),
    persistExpectedInput: async ({ inputId }) => { medDoseExpectedInputId = inputId; },
    createIntegrationError: async () => {},
    callTypebot: async (path, body) => {
      assert.equal(body.message.text, 'Captopril');
      assert(path.includes('/sessions/fhfy71suowpdmj4xn2kbtbqy/continueChat'));
      return {
        messages: [],
        input: {
          id: 'blk_n5x21i7c',
          type: 'text input',
          options: { labels: { placeholder: 'Dose (ex.: 50 mg)', button: 'Enviar' } }
        }
      };
    },
    provider: {
      sendTextMessage: async (payload) => {
        medDoseSent.push(payload);
        return { providerMessageId: `med-dose-${medDoseSent.length}` };
      },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    }
  });
  const medDoseResult = await medDoseBridge({
    messageId: 'med-dose-captopril',
    text: 'Captopril',
    identity: { phone: '5511985485777', bsuid: null },
    whatsappSession: { id: '369997bf-d103-4df9-96ae-416ff16a096d', typebot_session_id: 'fhfy71suowpdmj4xn2kbtbqy' }
  });
  assert.equal(medDoseResult.responsesSent, 1);
  assert.equal(medDoseSent[0].text, 'Dose (ex.: 50 mg)');
  assert.equal(medDoseExpectedInputId, 'blk_n5x21i7c');

  const paymentSent = [];
  const paymentLinks = [];
  const paymentReceipts = new Set();
  const paymentBridge = createTypebotWhatsAppBridge({
    claimMetaMessage: async ({ messageId }) => {
      if (paymentReceipts.has(messageId)) return { claimed: false };
      paymentReceipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => whatsappSession,
    persistExpectedInput: async () => {},
    createIntegrationError: async () => {},
    createPaymentLink: async (args) => {
      paymentLinks.push(args);
      return { token: 'tok', url: 'https://staging.example/api/typebot-payment/tok', amountLabel: 'R$69.90' };
    },
    callTypebot: async () => ({
      sessionId: 'pay-session',
      messages: [{ type: 'text', content: { plainText: 'Termos aceitos. Você será direcionado ao pagamento.' } }],
      input: {
        id: 'rapfykn1f1uno89ypqmwi43f',
        type: 'payment input',
        runtimeOptions: { paymentIntentSecret: 'pi_123_secret_abc', publicKey: 'pk_test_x', amountLabel: 'R$69.90' }
      }
    }),
    provider: {
      sendTextMessage: async (payload) => { paymentSent.push(payload); return { providerMessageId: `pay-${paymentSent.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    }
  });
  const payResult = await paymentBridge({
    messageId: 'pay-1',
    text: 'Li e concordo com os termos',
    identity,
    whatsappSession: { id: 'wa-pay', typebot_session_id: 'pay-session' }
  });
  assert.equal(payResult.responsesSent, 2, 'texto do bot + link de pagamento');
  assert.equal(paymentLinks.length, 1);
  assert.equal(paymentLinks[0].typebotSessionId, 'pay-session');
  assert.equal(paymentLinks[0].runtimeOptions.paymentIntentSecret, 'pi_123_secret_abc');
  assert(paymentSent[1].text.includes('https://staging.example/api/typebot-payment/tok'));
  assert.equal(paymentSent[1].idempotencyKey, 'pay-1:payment-link');

  console.log(JSON.stringify({
    patientSendsOi: 'ok',
    typebotRepliesOnWhatsApp: sent.some((item) => item.type === 'text') && sent.some((item) => item.type === 'buttons') ? 'ok' : 'failed',
    nextReplyReusesSessionId: second.sessionIdReused ? 'ok' : 'failed',
    duplicateDoesNotDoubleReply: sent.length === sentBeforeDuplicate ? 'ok' : 'failed',
    rapidMessagesStayOrdered: rapidCalls[1].path.includes('/sessions/rapid-session/continueChat') ? 'ok' : 'failed',
    transientFailureRecoveredWithoutManualResend: retryCalls.length === 3 && retryFinishes[0]?.status === 'processed' ? 'ok' : 'failed',
    retryCauseIsExact: retryLogs.every((item) => /ECONNRESET|EAI_AGAIN/.test(item.error.message)) ? 'ok' : 'failed',
    invalidThenValidForEveryPersonalField: validationResults.length === 7 && validationResults.every((item) => item === 'ok') ? 'ok' : 'failed',
    paymentLinkSentOnPaymentInput: payResult.responsesSent === 2 && paymentLinks.length === 1 ? 'ok' : 'failed',
    textInputWithoutMessagesSendsPlaceholder: medDoseResult.responsesSent === 1 ? 'ok' : 'failed'
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });

