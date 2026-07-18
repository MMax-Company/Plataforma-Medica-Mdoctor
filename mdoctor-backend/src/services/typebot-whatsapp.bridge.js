const metaProvider = require('./providers/meta.provider');
const { createIntegrationError } = require('../store/integration-logs.store');
const { claimMetaMessage, finishMetaMessage } = require('../store/whatsapp-meta-receipts.store');
const {
  getSessionByBsuid,
  getSessionByPhone,
  setTypebotSessionId,
  upsertSessionIdentity
} = require('../store/whatsapp-sessions.store');
const {
  buildPersonalDataOutputs,
  validatePersonalInput
} = require('./typebot-personal-data.validation');

function getConfig() {
  return {
    viewerUrl: String(process.env.TYPEBOT_VIEWER_URL || '').replace(/\/$/, ''),
    publicId: String(process.env.TYPEBOT_PUBLIC_ID || 'doctor-prescreve-8rmljgu').trim(),
    timeoutMs: Number(process.env.TYPEBOT_RUNTIME_TIMEOUT_MS || 12000),
    retryAttempts: Math.max(1, Number(process.env.TYPEBOT_RETRY_ATTEMPTS || 4)),
    retryBaseDelayMs: Math.max(0, Number(process.env.TYPEBOT_RETRY_BASE_DELAY_MS || 300)),
    retryMaxDelayMs: Math.max(0, Number(process.env.TYPEBOT_RETRY_MAX_DELAY_MS || 2500))
  };
}

function richTextToPlainText(nodes = []) {
  const parts = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (item?.type === 'a') {
        const labelParts = [];
        if (Array.isArray(item.children)) {
          for (const child of item.children) {
            if (typeof child?.text === 'string') labelParts.push(child.text);
          }
        }
        const label = labelParts.join('').trim() || 'Abrir link';
        const url = String(item.url || '').trim();
        if (url) {
          parts.push(label);
          parts.push(url);
        } else if (label) {
          parts.push(label);
        }
        continue;
      }
      if (typeof item?.text === 'string') parts.push(item.text);
      if (Array.isArray(item?.children)) walk(item.children);
      if (item?.type === 'p') parts.push('\n');
    }
  };
  walk(nodes);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function typebotText(message = {}) {
  if (typeof message.content === 'string') return message.content.trim();
  if (typeof message.content?.plainText === 'string') return message.content.plainText.trim();
  return richTextToPlainText(message.content?.richText || message.content || []);
}

function textInputPrompt(input = {}) {
  const labels = input.options?.labels || input.options || {};
  return String(labels.placeholder || labels.label || '').trim();
}

function convertTypebotResponse(response = {}) {
  const outputs = [];
  for (const message of response.messages || []) {
    if (message?.type !== 'text') continue;
    const text = typebotText(message);
    if (text) outputs.push({ kind: 'text', text });
  }

  const input = response.input || {};
  const items = Array.isArray(input.items) ? input.items.filter((item) => item?.content || item?.value) : [];
  if (input.type === 'choice input' && items.length) {
    const choices = items.map((item, index) => ({
      id: String(item.content || item.value || item.id || `choice-${index + 1}`).slice(0, 200),
      title: String(item.content || item.value).slice(0, 24),
      value: String(item.content || item.value)
    }));
    outputs.push(choices.length <= 3
      ? { kind: 'buttons', body: 'Escolha uma opção:', choices }
      : { kind: 'list', body: 'Escolha uma opção:', button: 'Ver opções', choices: choices.slice(0, 10) });
  }

  const hasTextOutput = outputs.some((output) => output.kind === 'text');
  if (input.type === 'text input' && !hasTextOutput) {
    const prompt = textInputPrompt(input);
    if (prompt) outputs.push({ kind: 'text', text: prompt });
  }
  return buildPersonalDataOutputs(outputs, input);
}

function errorPart(error) {
  if (!error) return '';
  const name = error.name && error.name !== 'Error' ? error.name : 'Error';
  const code = error.code ? ` [${error.code}]` : '';
  const status = error.status ? ` HTTP ${error.status}` : '';
  return `${name}${code}${status}: ${String(error.message || error)}`;
}

function describeError(error) {
  const parts = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current) && parts.length < 5) {
    seen.add(current);
    const part = errorPart(current);
    if (part && !parts.includes(part)) parts.push(part);
    current = current.cause;
  }
  return parts.join(' <- ').slice(0, 2000) || 'Erro desconhecido';
}

function isRetryableTypebotError(error) {
  if (typeof error?.retryable === 'boolean') return error.retryable;
  const status = Number(error?.status || 0);
  if ([408, 409, 425, 429].includes(status) || status >= 500) return true;
  const codes = [];
  let current = error;
  while (current) {
    if (current.code) codes.push(String(current.code));
    current = current.cause;
  }
  if (codes.some((code) => /^(ABORT_ERR|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_)/.test(code))) return true;
  return /fetch failed|network|socket|timeout/i.test(describeError(error));
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function callWithRetry(operation, {
  attempts,
  baseDelayMs,
  maxDelayMs,
  sleep = wait,
  onRetry = async () => {}
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableTypebotError(error);
      if (!retryable || attempt >= attempts) {
        error.retryAttempts = attempt;
        error.retryExhausted = retryable && attempt >= attempts;
        throw error;
      }
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await onRetry(error, { attempt, delayMs, nextAttempt: attempt + 1 });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function fetchTypebot(path, body, { fetchImpl = fetch, config = getConfig() } = {}) {
  if (!config.viewerUrl) throw Object.assign(new Error('TYPEBOT_VIEWER_URL não configurada'), { code: 'TYPEBOT_NOT_CONFIGURED' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${config.viewerUrl}/api/v1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (cause) {
      const timeoutReached = cause?.name === 'AbortError';
      const error = new Error(timeoutReached ? 'Timeout na chamada ao Typebot' : 'Falha de rede na chamada ao Typebot', { cause });
      error.code = timeoutReached ? 'TYPEBOT_TIMEOUT' : 'TYPEBOT_FETCH_FAILED';
      error.retryable = true;
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.message || `Typebot HTTP ${response.status}`);
      error.code = 'TYPEBOT_RUNTIME_ERROR';
      error.status = response.status;
      error.retryable = [408, 409, 425, 429].includes(response.status) || response.status >= 500;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function createTypebotWhatsAppBridge(deps = {}) {
  const provider = deps.provider || metaProvider;
  const claim = deps.claimMetaMessage || claimMetaMessage;
  const finish = deps.finishMetaMessage || finishMetaMessage;
  const saveSessionId = deps.setTypebotSessionId || setTypebotSessionId;
  const logError = deps.createIntegrationError || createIntegrationError;
  const callTypebot = deps.callTypebot || fetchTypebot;
  const sleep = deps.sleep || wait;
  const now = deps.now || (() => new Date());
  const persistExpectedInput = deps.persistExpectedInput || (async ({ identity, inputId }) => upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: { typebot_expected_input_id: inputId || null }
  }));
  const reloadSession = deps.reloadSession || (async ({ identity, whatsappSession }) => {
    if (identity?.phone) return (await getSessionByPhone(identity.phone)) || whatsappSession;
    if (identity?.bsuid) return (await getSessionByBsuid(identity.bsuid)) || whatsappSession;
    return whatsappSession;
  });
  // Lazy require para evitar ciclo com typebot-payment-link.service (que usa
  // fetchTypebot/convertTypebotResponse deste módulo).
  const createPaymentLink = deps.createPaymentLink || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').createPaymentLinkForSession(args));
  const findUploadContext = deps.findUploadContextForPhone || deps.findPendingUploadContext || ((phone) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').findUploadContextForPhone(phone));
  const persistUploadContext = deps.persistUploadContext || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').persistUploadContext(args));
  const uploadContextFromSession = deps.uploadContextFromSession || ((session, fallback) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').uploadContextFromSession(session, fallback));
  const augmentUploadOutputs = deps.augmentOutputsWithUploadLink || ((outputs, ctx, options) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').augmentOutputsWithUploadLink(outputs, ctx, options));
  const responseLooksLikeUploadStage = deps.responseLooksLikeUploadStage || ((typebot, inputId) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').responseLooksLikeUploadStage(typebot, inputId));
  const isUploadChoiceInput = deps.isUploadChoiceInput || ((inputId) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').isUploadChoiceInput(inputId));
  const isUploadConfirmationText = deps.isUploadConfirmationText || ((value) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').isUploadConfirmationText(value));
  const getUploadStatus = deps.getUploadStatus || ((token) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').getUploadStatus(token));
  const sessionQueues = new Map();
  const expectedInputs = new Map();

  async function processInbound({ messageId, text, identity, whatsappSession }, identityKey) {
    const claimed = await claim({ messageId, whatsappSessionId: whatsappSession?.id });
    if (!claimed.claimed) return { duplicate: true, responsesSent: 0, sessionIdReused: Boolean(whatsappSession?.typebot_session_id) };

    const config = getConfig();
    try {
      const currentSession = await reloadSession({ identity, whatsappSession });
      const existingSessionId = currentSession?.typebot_session_id || null;
      const expectedInputId = expectedInputs.has(identityKey)
        ? expectedInputs.get(identityKey)
        : currentSession?.metadata?.typebot_expected_input_id || null;
      const validation = validatePersonalInput(expectedInputId, text, { now: now() });
      if (validation.isPersonal && !validation.valid) {
        const sent = await provider.sendTextMessage({
          to: identity.phone,
          bsuid: identity.bsuid,
          correlationId: messageId,
          idempotencyKey: `${messageId}:validation`,
          text: `${validation.error}\n\n${validation.question}`
        });
        const providerMessageIds = sent?.providerMessageId ? [sent.providerMessageId] : [];
        await finish({ messageId, status: 'processed', providerMessageIds });
        return {
          duplicate: false,
          responsesSent: providerMessageIds.length,
          sessionId: existingSessionId,
          sessionIdReused: Boolean(existingSessionId),
          validationFailed: true,
          expectedInputId
        };
      }

      const uploadContextBeforeChat = uploadContextFromSession(
        currentSession,
        await findUploadContext(identity?.phone)
      );
      if (
        uploadContextBeforeChat
        && isUploadConfirmationText(text)
        && (isUploadChoiceInput(expectedInputId) || isUploadChoiceInput(currentSession?.metadata?.typebot_expected_input_id))
      ) {
        const uploadStatus = await getUploadStatus(uploadContextBeforeChat.token);
        if (uploadStatus.upload_completed) {
          await persistUploadContext({ identity, uploadContext: uploadContextBeforeChat });
          const sent = await provider.sendTextMessage({
            to: identity.phone,
            bsuid: identity.bsuid,
            correlationId: messageId,
            idempotencyKey: `${messageId}:upload-confirmed`,
            text: '✅ Receita confirmada! Seu atendimento entrou na fila médica. Em breve um médico analisará sua solicitação.'
          });
          const providerMessageIds = sent?.providerMessageId ? [sent.providerMessageId] : [];
          expectedInputs.set(identityKey, null);
          await persistExpectedInput({ identity, whatsappSession: currentSession, inputId: null });
          await finish({ messageId, status: 'processed', providerMessageIds });
          return {
            duplicate: false,
            responsesSent: providerMessageIds.length,
            sessionId: existingSessionId,
            sessionIdReused: Boolean(existingSessionId),
            uploadConfirmed: true
          };
        }
      }

      const path = existingSessionId
        ? `/sessions/${encodeURIComponent(existingSessionId)}/continueChat`
        : `/typebots/${encodeURIComponent(config.publicId)}/startChat`;
      const message = {
        type: 'text',
        text: validation.isPersonal ? validation.value : String(text || ''),
        metadata: { replyId: messageId }
      };
      const typebot = await callWithRetry(
        () => callTypebot(path, { message }, { config }),
        {
          attempts: config.retryAttempts,
          baseDelayMs: config.retryBaseDelayMs,
          maxDelayMs: config.retryMaxDelayMs,
          sleep,
          onRetry: async (error, retry) => {
            const detailedError = Object.assign(new Error(describeError(error)), { code: error.code });
            await logError({
              integration: 'typebot_runtime',
              correlationId: messageId,
              error: detailedError,
              request: {
                message_id: messageId,
                whatsapp_session_id: currentSession?.id || null,
                phase: 'retry',
                attempt: retry.attempt,
                next_attempt: retry.nextAttempt,
                backoff_ms: retry.delayMs
              }
            }).catch(() => {});
          }
        }
      );

      const sessionId = existingSessionId || typebot.sessionId;
      if (!sessionId) throw new Error('Typebot não retornou sessionId');
      if (!existingSessionId) await saveSessionId({ sessionId: currentSession.id, typebotSessionId: sessionId });
      let nextInputId = typebot.input?.id || null;
      if (validation.isPersonal && validation.valid && nextInputId === expectedInputId) {
        const sent = await provider.sendTextMessage({
          to: identity.phone,
          bsuid: identity.bsuid,
          correlationId: messageId,
          idempotencyKey: `${messageId}:personal-resync`,
          text: `Não foi possível registrar sua resposta.\n\n${validation.question}`
        });
        const providerMessageIds = sent?.providerMessageId ? [sent.providerMessageId] : [];
        await finish({ messageId, status: 'processed', providerMessageIds });
        return {
          duplicate: false,
          responsesSent: providerMessageIds.length,
          sessionId,
          sessionIdReused: Boolean(existingSessionId),
          validationFailed: true,
          expectedInputId,
          personalResync: true
        };
      }
      expectedInputs.set(identityKey, nextInputId);
      await persistExpectedInput({ identity, whatsappSession: currentSession, inputId: nextInputId });

      const providerMessageIds = [];
      let uploadContext = uploadContextFromSession(currentSession, await findUploadContext(identity?.phone));
      if (uploadContext) await persistUploadContext({ identity, uploadContext });

      let outputs = convertTypebotResponse(typebot);
      if (uploadContext && responseLooksLikeUploadStage(typebot, nextInputId)) {
        outputs = augmentUploadOutputs(outputs, uploadContext, {
          force: isUploadChoiceInput(nextInputId) || isUploadChoiceInput(expectedInputId)
        });
      }

      for (const output of outputs) {
        const common = { to: identity.phone, bsuid: identity.bsuid, correlationId: messageId, idempotencyKey: `${messageId}:${providerMessageIds.length}` };
        let sent;
        if (output.kind === 'buttons') sent = await provider.sendButtonMessage({ ...common, body: output.body, buttons: output.choices });
        else if (output.kind === 'list') sent = await provider.sendListMessage({ ...common, body: output.body, button: output.button, rows: output.choices });
        else sent = await provider.sendTextMessage({ ...common, text: output.text });
        if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
      }

      // Payment input não tem representação nativa no WhatsApp: gera um link
      // seguro que abre o pagamento web da MESMA sessão Typebot. Best-effort —
      // se falhar, o paciente reenvia a última resposta e o link é retentado.
      if (typebot.input?.type === 'payment input' && typebot.input.runtimeOptions?.paymentIntentSecret) {
        try {
          const link = await createPaymentLink({
            identity,
            typebotSessionId: sessionId,
            runtimeOptions: typebot.input.runtimeOptions
          });
          const sent = await provider.sendTextMessage({
            to: identity.phone,
            bsuid: identity.bsuid,
            correlationId: messageId,
            idempotencyKey: `${messageId}:payment-link`,
            text: `💳 Para concluir o pagamento${link.amountLabel ? ` (${link.amountLabel})` : ''}, acesse o link seguro:\n${link.url}\n\nApós a confirmação, o atendimento continua automaticamente aqui no WhatsApp.`
          });
          if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
        } catch (error) {
          await logError({
            integration: 'typebot_payment_link',
            correlationId: messageId,
            error,
            request: { message_id: messageId, whatsapp_session_id: currentSession?.id || null, phase: 'create_link' }
          }).catch(() => {});
        }
      }

      await finish({ messageId, status: 'processed', providerMessageIds });
      return {
        duplicate: false,
        responsesSent: providerMessageIds.length,
        sessionId,
        sessionIdReused: Boolean(existingSessionId),
        retryAttempts: typebot.retryAttempts || undefined
      };
    } catch (error) {
      const exactCause = describeError(error);
      const detailedError = Object.assign(new Error(exactCause), { code: error.code });
      await finish({ messageId, status: 'failed', errorMessage: exactCause }).catch(() => {});
      await logError({
        integration: error.code?.startsWith('META_') || error.code === 'PROVIDER_ERROR' ? 'meta_whatsapp' : 'typebot_runtime',
        correlationId: messageId,
        error: detailedError,
        request: {
          message_id: messageId,
          whatsapp_session_id: whatsappSession?.id || null,
          retry_attempts: error.retryAttempts || 1,
          retry_exhausted: Boolean(error.retryExhausted)
        }
      }).catch(() => {});
      throw error;
    }
  }

  return async function handleInbound(payload) {
    const identityKey = payload.whatsappSession?.id || payload.identity?.phone || payload.identity?.bsuid || 'unknown';
    const previous = sessionQueues.get(identityKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => processInbound(payload, identityKey));
    sessionQueues.set(identityKey, current);
    try {
      return await current;
    } finally {
      if (sessionQueues.get(identityKey) === current) sessionQueues.delete(identityKey);
    }
  };
}

module.exports = {
  callWithRetry,
  convertTypebotResponse,
  createTypebotWhatsAppBridge,
  describeError,
  fetchTypebot,
  isRetryableTypebotError,
  textInputPrompt
};
