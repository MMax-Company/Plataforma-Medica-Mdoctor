const assert = require('assert');
const { convertTypebotResponse, createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');
const { validatePersonalInput } = require('../src/services/typebot-personal-data.validation');

process.env.TYPEBOT_VIEWER_URL = 'https://viewer.example.test';
process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
process.env.TYPEBOT_RETRY_ATTEMPTS = '4';
process.env.TYPEBOT_RETRY_BASE_DELAY_MS = '300';
process.env.TYPEBOT_RETRY_MAX_DELAY_MS = '2500';

const uploadBridgeMocks = {
  findPendingUploadContext: async () => null,
  findUploadContextForPhone: async () => null,
  persistUploadContext: async () => {},
  uploadContextFromSession: () => null,
  augmentOutputsWithUploadLink: (outputs) => outputs,
  responseLooksLikeUploadStage: () => false,
  isUploadChoiceInput: () => false,
  isUploadConfirmationText: () => false,
  getUploadStatus: async () => ({ upload_completed: false })
};

async function main() {
  const calls = [];
  const sent = [];
  const receipts = new Set();
  let savedSessionId = null;
  let storedSessionId = null;
  let storedExpectedInputId = null;
  const bridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
    findPendingUploadContext: async () => null,
    persistUploadContext: async () => {},
    uploadContextFromSession: () => null,
    augmentOutputsWithUploadLink: (outputs) => outputs,
    responseLooksLikeUploadStage: () => false,
    isUploadChoiceInput: () => false,
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
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
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
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
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
    { id: 'q78qjnk6ticwkeifl7xe2rju', invalid: 'Rua A', valid: 'Rua Aurora, 965, República, São Paulo, SP' },
    { id: 'blk_0oydu2f7', invalid: '123', valid: '01209003' }
  ];
  const validationResults = [];
  for (const [index, testCase] of validationCases.entries()) {
    const validationReceipts = new Set();
    const validationCalls = [];
    const validationSent = [];
    let expectedInputId = testCase.id;
    const validationBridge = createTypebotWhatsAppBridge({
      ...uploadBridgeMocks,
      resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
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
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
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
  const paymentIntros = [];
  const paymentReceipts = new Set();
  const paymentBridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
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
    // Checkout Stripe (Fase 2 pedido 2): createPaymentLink não recebe mais
    // PaymentIntent do Typebot (runtimeOptions vazio) e devolve checkoutRedirectUrl.
    createPaymentLink: async (args) => {
      paymentLinks.push(args);
      return { token: 'tok', checkoutRedirectUrl: 'https://staging.example/api/typebot-payment/tok/checkout', amountLabel: 'R$69.90' };
    },
    sendPaymentIntro: async ({ session, checkoutRedirectUrl, correlationId, provider, idempotencyPrefix }) => {
      paymentIntros.push({ session, checkoutRedirectUrl, correlationId });
      const sent = await provider.sendTextMessage({
        to: session.phone,
        bsuid: session.bsuid,
        correlationId,
        idempotencyKey: `${idempotencyPrefix}:0`,
        text: `Pagamento: ${checkoutRedirectUrl}`
      });
      return sent?.providerMessageId ? [sent.providerMessageId] : [];
    },
    callTypebot: async () => ({
      sessionId: 'pay-session',
      messages: [{ type: 'text', content: { plainText: 'Termos aceitos. Você será direcionado ao pagamento.' } }],
      input: { id: 'rapfykn1f1uno89ypqmwi43f', type: 'payment input' }
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
  assert.equal(payResult.responsesSent, 2, 'texto do bot + convite de pagamento (Checkout)');
  assert.equal(paymentLinks.length, 1);
  assert.equal(paymentLinks[0].typebotSessionId, 'pay-session');
  assert.deepEqual(paymentLinks[0].runtimeOptions, {}, 'Typebot não fornece mais PaymentIntent — Checkout é só do Backend');
  assert.equal(paymentLinks[0].existingSession.id, 'wa-pay', 'Checkout reaproveita a sessão clínica existente');
  assert(paymentSent[1].text.includes('https://staging.example/api/typebot-payment/tok/checkout'));
  assert.equal(paymentSent[1].idempotencyKey, 'pay-1:payment-intro:0');

  // Retomada quando o pagamento já foi confirmado (ex.: paciente reenvia
  // resposta antes do webhook resolver, ou reabre o link já pago): não
  // reabre Checkout nem reenvia o convite — só retoma o fluxo uma vez.
  const alreadyPaidSent = [];
  const alreadyPaidCompletions = [];
  const alreadyPaidBridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => whatsappSession,
    persistExpectedInput: async () => {},
    createIntegrationError: async () => {},
    createPaymentLink: async () => ({ alreadyPaid: true, token: 'tok-paid' }),
    completePaymentByToken: async (token, args) => {
      alreadyPaidCompletions.push({ token, session: args.session });
      return { ok: true, responsesSent: 1 };
    },
    callTypebot: async () => ({
      sessionId: 'pay-session-2',
      messages: [{ type: 'text', content: { plainText: 'Confirme os termos.' } }],
      input: { id: 'rapfykn1f1uno89ypqmwi43f', type: 'payment input' }
    }),
    provider: {
      sendTextMessage: async (payload) => { alreadyPaidSent.push(payload); return { providerMessageId: `already-${alreadyPaidSent.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    }
  });
  const alreadyPaidResult = await alreadyPaidBridge({
    messageId: 'pay-already-1',
    text: 'oi',
    identity,
    whatsappSession: { id: 'wa-pay-2', typebot_session_id: 'pay-session-2' }
  });
  assert.equal(alreadyPaidResult.paymentAlreadyPaid, true);
  assert.equal(alreadyPaidCompletions.length, 1, 'retomada acionada exatamente uma vez');
  assert.equal(alreadyPaidCompletions[0].token, 'tok-paid');
  assert.equal(alreadyPaidResult.responsesSent, 1 + 1, 'texto do bot + retomada');

  const menuSent = [];
  let menuCleared = false;
  const menuBridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    clearTypebotSession: async () => { menuCleared = true; return { id: 'wa-menu', typebot_session_id: null, metadata: {} }; },
    reloadSession: async ({ whatsappSession }) => whatsappSession,
    persistExpectedInput: async () => {},
    createIntegrationError: async () => {},
    resolveMetaInboundRouting: async ({ text }) => {
      const norm = String(text || '').trim();
      if (norm === '1') return { handled: true, action: 'typebot_clean' };
      if (norm === '2') return { handled: true, action: 'reply', reply: 'Aguarde suporte.' };
      return { handled: true, action: 'reply', reply: 'Menu inicial' };
    },
    callTypebot: async (path) => {
      assert(path.includes('/startChat'));
      return {
        sessionId: 'menu-session',
        messages: [{ type: 'text', content: { plainText: 'Typebot iniciado.' } }],
        input: { id: 'choice-1', type: 'choice input', items: [{ content: 'Sim' }] }
      };
    },
    provider: {
      sendTextMessage: async (payload) => { menuSent.push(payload); return { providerMessageId: `menu-${menuSent.length}` }; },
      sendButtonMessage: async (payload) => { menuSent.push(payload); return { providerMessageId: `menu-${menuSent.length}` }; },
      sendListMessage: async () => ({})
    }
  });

  const menuOi = await menuBridge({
    messageId: 'menu-oi',
    text: 'Oi',
    identity,
    whatsappSession: { id: 'wa-menu', typebot_session_id: null }
  });
  assert.equal(menuOi.menuHandled, true);
  assert.equal(menuSent.length, 1);
  assert.equal(menuSent[0].text, 'Menu inicial');
  assert.equal(menuCleared, false);

  const menuInvalid = await menuBridge({
    messageId: 'menu-invalid',
    text: 'xyz',
    identity,
    whatsappSession: { id: 'wa-menu', typebot_session_id: null }
  });
  assert.equal(menuInvalid.menuHandled, true);
  assert.equal(menuSent[menuSent.length - 1].text, 'Menu inicial');

  const menuStart = await menuBridge({
    messageId: 'menu-start',
    text: '1',
    identity,
    whatsappSession: { id: 'wa-menu', typebot_session_id: 'stale-session' }
  });
  assert.equal(menuStart.menuHandled, undefined);
  assert.equal(menuCleared, true);
  assert(menuSent.some((item) => item.text === 'Typebot iniciado.' || item.body));

  const supportChoiceCalls = [];
  let supportSessionCleared = false;
  const supportBridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    clearTypebotSession: async () => { supportSessionCleared = true; return { id: 'wa-support', typebot_session_id: null, metadata: {} }; },
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'support-session',
      metadata: { typebot_expected_input_id: 'blk_pos_atend_choice' }
    }),
    persistExpectedInput: async () => {},
    createIntegrationError: async () => {},
    handleTypebotSupportChoice: async (args) => {
      supportChoiceCalls.push(args);
      if (args.text === 'Falar com o suporte') return { action: 'support_created' };
      if (args.text === 'Encerrar atendimento') return { action: 'clear_session' };
      return null;
    },
    callTypebot: async () => ({
      messages: [{ type: 'text', content: { plainText: 'Você será atendido pela equipe de suporte.' } }],
      input: { id: 'blk_suporte_choice', type: 'choice input', items: [{ content: 'Voltar ao menu principal' }, { content: 'Encerrar' }] }
    }),
    provider: {
      sendTextMessage: async () => ({ providerMessageId: 'support-1' }),
      sendButtonMessage: async () => ({ providerMessageId: 'support-1' }),
      sendListMessage: async () => ({})
    }
  });

  const supportChosen = await supportBridge({
    messageId: 'support-suporte',
    text: 'Falar com o suporte',
    identity,
    whatsappSession: { id: 'wa-support', typebot_session_id: 'support-session' }
  });
  assert.equal(supportChosen.duplicate, false);
  assert.equal(supportChoiceCalls[0].expectedInputId, 'blk_pos_atend_choice');
  assert.equal(supportChoiceCalls[0].text, 'Falar com o suporte');
  assert.equal(supportSessionCleared, false, '"Falar com o suporte" não deve limpar a sessão do Typebot');

  const supportEncerrar = await supportBridge({
    messageId: 'support-encerrar',
    text: 'Encerrar atendimento',
    identity,
    whatsappSession: { id: 'wa-support', typebot_session_id: 'support-session' }
  });
  assert.equal(supportEncerrar.duplicate, false);
  assert.equal(supportSessionCleared, true, '"Encerrar atendimento" deve limpar a sessão do Typebot');

  let supportErrorLogged = false;
  const supportErrorBridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'support-session-2',
      metadata: { typebot_expected_input_id: 'blk_pos_atend_choice' }
    }),
    persistExpectedInput: async () => {},
    createIntegrationError: async ({ integration }) => { if (integration === 'whatsapp_support') supportErrorLogged = true; },
    handleTypebotSupportChoice: async () => { throw new Error('falha ao criar ticket'); },
    callTypebot: async () => ({ messages: [{ type: 'text', content: { plainText: 'ok' } }] }),
    provider: {
      sendTextMessage: async () => ({ providerMessageId: 'support-err-1' }),
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    }
  });
  const supportErrorResult = await supportErrorBridge({
    messageId: 'support-error-1',
    text: 'Falar com o suporte',
    identity,
    whatsappSession: { id: 'wa-support-2', typebot_session_id: 'support-session-2' }
  });
  assert.equal(supportErrorResult.duplicate, false, 'falha ao criar o ticket de suporte não pode quebrar a resposta ao paciente');
  assert.equal(supportErrorLogged, true);

  // Documentos jurídicos (LGPD/Telemedicina/Termos): o Typebot manda um
  // parágrafo por documento com um link (type:'a', url + rótulo). WhatsApp
  // não consegue esconder a URL numa mensagem de texto — precisa virar botão
  // de URL (sendCtaUrlMessage): abre o link externamente, sem baixar PDF
  // nenhum no WhatsApp e sem mostrar a URL em lugar nenhum.
  const legalDocsSent = [];
  const legalTextsSent = [];
  const legalReceipts = new Set();
  const legalBridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
    claimMetaMessage: async ({ messageId }) => {
      if (legalReceipts.has(messageId)) return { claimed: false };
      legalReceipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async ({ whatsappSession }) => whatsappSession,
    persistExpectedInput: async () => {},
    createIntegrationError: async () => {},
    callTypebot: async () => ({
      sessionId: 'legal-session',
      messages: [{
        type: 'text',
        content: {
          richText: [
            {
              type: 'p',
              children: [
                { text: '📄 ' },
                { type: 'a', url: 'https://storage.example/Consentimento_LGPD_Doctor_Prescreve.pdf', children: [{ text: 'Consentimento LGPD' }] }
              ]
            },
            {
              type: 'p',
              children: [
                { text: '📄 ' },
                { type: 'a', url: 'https://storage.example/Politica_de_Privacidade_Doctor_Prescreve.pdf', children: [{ text: 'Política de Privacidade' }] }
              ]
            }
          ]
        }
      }],
      input: { id: 'blk_lgpd_choice', type: 'choice input', items: [{ content: 'Autorizo' }, { content: 'Não autorizo' }] }
    }),
    provider: {
      sendTextMessage: async (payload) => { legalTextsSent.push(payload); return { providerMessageId: `legal-text-${legalTextsSent.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({}),
      sendDocumentMessage: async () => { throw new Error('sendDocumentMessage não deve mais ser usado para documentos jurídicos'); },
      sendCtaUrlMessage: async (payload) => { legalDocsSent.push(payload); return { providerMessageId: `legal-doc-${legalDocsSent.length}` }; }
    }
  });
  const legalResult = await legalBridge({
    messageId: 'legal-1',
    text: 'Oi',
    identity,
    whatsappSession: { id: 'wa-legal', typebot_session_id: null }
  });
  assert.equal(legalDocsSent.length, 2, 'os 2 documentos do parágrafo devem virar 2 botões de URL');
  assert(legalDocsSent.every((d) => /^https:\/\//.test(d.url)), 'a URL real vai só no campo url do botão, nunca no texto');
  assert(legalDocsSent.every((d) => d.displayText.length <= 20), 'rótulo do botão respeita o limite de 20 caracteres da Meta');
  assert.equal(legalDocsSent[0].displayText, 'Consentimento LGPD');
  assert.equal(legalDocsSent[1].displayText, 'Privacidade');
  // Nenhum texto intermediário pode aparecer antes do botão -- nem o nome do
  // documento repetido, nem o texto padrão de fallback ("Toque no botão
  // abaixo para continuar."). A introdução do grupo (enviada antes, como
  // mensagem de texto própria) já dá o contexto. A Meta exige `body.text`
  // não-vazio em toda mensagem cta_url e rejeita um corpo só de espaço em
  // branco com erro 131008 (confirmado ao vivo) -- o mínimo aceito é um
  // único ícone neutro, sem palavras.
  assert(legalDocsSent.every((d) => d.body === '📄'), 'corpo do botão deve ser só o ícone neutro, sem repetir o nome nem usar o texto padrão');
  assert(legalDocsSent.every((d) => !String(d.body || '').includes('Toque no botão')), 'texto padrão de fallback não pode aparecer nos botões jurídicos');
  assert(legalTextsSent.every((t) => !String(t.text || '').includes('http')), 'nenhuma URL pode vazar para uma mensagem de texto');
  assert.equal(legalResult.responsesSent, 2);

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
    paymentAlreadyPaidResumesOnce: alreadyPaidCompletions.length === 1 && alreadyPaidResult.paymentAlreadyPaid ? 'ok' : 'failed',
    textInputWithoutMessagesSendsPlaceholder: medDoseResult.responsesSent === 1 ? 'ok' : 'failed',
    menuShowsBeforeTypebot: menuOi.menuHandled ? 'ok' : 'failed',
    menuOptionOneStartsCleanTypebot: menuStart.responsesSent >= 1 && menuCleared ? 'ok' : 'failed',
    postAttendanceSupportChoiceWiredToBackend: supportChoiceCalls.length === 2 && supportSessionCleared ? 'ok' : 'failed',
    supportChoiceFailureDoesNotBreakReply: supportErrorResult.duplicate === false && supportErrorLogged ? 'ok' : 'failed',
    legalDocsSentAsUrlButtonsNoAttachmentNoRawUrl: legalDocsSent.length === 2 && legalTextsSent.every((t) => !String(t.text || '').includes('http')) ? 'ok' : 'failed'
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });

