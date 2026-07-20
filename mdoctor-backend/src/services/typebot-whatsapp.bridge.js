const metaProvider = require('./providers/meta.provider');
const { createIntegrationError } = require('../store/integration-logs.store');
const { claimMetaMessage, finishMetaMessage } = require('../store/whatsapp-meta-receipts.store');
const {
  getSessionByBsuid,
  getSessionByPhone,
  setTypebotSessionId,
  upsertSessionIdentity
} = require('../store/whatsapp-sessions.store');
const { validatePersonalInput } = require('./typebot-personal-data.validation');
const { getWhatsAppTypebotOfficialConfig } = require('../constants/typebot-whatsapp.official');

function getConfig() {
  const official = getWhatsAppTypebotOfficialConfig();
  return {
    viewerUrl: official.viewerUrl,
    publicId: official.publicId,
    welcomeChoiceInputId: String(process.env.TYPEBOT_WELCOME_CHOICE_INPUT_ID || 'sbjZWLJGVkHAkDqS4JQeGow').trim(),
    timeoutMs: Number(process.env.TYPEBOT_RUNTIME_TIMEOUT_MS || 12000),
    retryAttempts: Math.max(1, Number(process.env.TYPEBOT_RETRY_ATTEMPTS || 4)),
    retryBaseDelayMs: Math.max(0, Number(process.env.TYPEBOT_RETRY_BASE_DELAY_MS || 300)),
    retryMaxDelayMs: Math.max(0, Number(process.env.TYPEBOT_RETRY_MAX_DELAY_MS || 2500))
  };
}

function isConversationGreeting(text) {
  return /^(oi|olá|ola|hey|hello|bom dia|boa tarde|boa noite)$/i.test(String(text || '').trim());
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

/** Inputs múltiplos do Typebot oficial (fallback se a API não enviar options). */
const OFFICIAL_MULTI_CHOICE_INPUT_IDS = new Set([
  'b156nm008xh7gb52n7w3egzn', // Doença Cronica
  's5VQGsVF4hQgziQsXVdwPDW' // Sinais de Alerta
]);

function isMultipleChoiceInput(input = {}) {
  if (input?.options?.isMultipleChoice === true) return true;
  return OFFICIAL_MULTI_CHOICE_INPUT_IDS.has(String(input?.id || '').trim());
}

function normalizeChoiceKey(value) {
  return String(value || '').trim().toLowerCase();
}

function mapChoiceItems(items = []) {
  return (items || [])
    .filter((item) => item?.content || item?.value || item?.id)
    .map((item, index) => ({
      id: String(item.id || item.content || item.value || `choice-${index + 1}`),
      content: String(item.content || item.value || item.id || '').trim(),
      value: String(item.value ?? item.content ?? item.id ?? '').trim()
    }));
}

function findChoiceItem(items, rawText) {
  const key = normalizeChoiceKey(rawText);
  if (!key) return null;
  return (items || []).find((item) => (
    normalizeChoiceKey(item.content) === key
    || normalizeChoiceKey(item.value) === key
    || normalizeChoiceKey(item.id) === key
  )) || null;
}

function isExclusiveNoneItem(item) {
  if (!item) return false;
  if (String(item.value || '').trim().toUpperCase() === 'NAO') return true;
  return /^nenhum destes$/i.test(String(item.content || '').trim());
}

/**
 * Alterna seleção múltipla no WhatsApp.
 * "Nenhum destes" (NAO) é exclusivo e não coexiste com outros sinais.
 */
function toggleMultiChoiceSelection(state, rawText) {
  const items = mapChoiceItems(state?.items || []);
  const matched = findChoiceItem(items, rawText);
  if (!matched) {
    return { ok: false, reason: 'not_found', state };
  }

  const selected = Array.isArray(state?.selected) ? [...state.selected] : [];
  const already = selected.some((item) => item.id === matched.id || item.value === matched.value);
  let nextSelected;

  if (isExclusiveNoneItem(matched)) {
    nextSelected = already ? [] : [{ id: matched.id, content: matched.content, value: matched.value }];
  } else if (already) {
    nextSelected = selected.filter((item) => item.id !== matched.id && item.value !== matched.value);
  } else {
    nextSelected = [
      ...selected.filter((item) => !isExclusiveNoneItem(item)),
      { id: matched.id, content: matched.content, value: matched.value }
    ];
  }

  return {
    ok: true,
    state: {
      ...state,
      items,
      selected: nextSelected,
      buttonLabel: state?.buttonLabel || 'Confirmo'
    }
  };
}

/** Formato oficial do Typebot MultipleChoicesForm: values unidos por ", ". */
function buildMultiChoiceSubmitText(selected = []) {
  return (selected || [])
    .map((item) => String(item.value || item.content || '').trim())
    .filter(Boolean)
    .join(', ');
}

function multiChoiceSummary(selected = []) {
  if (!selected.length) return 'Nenhuma opção selecionada ainda.';
  return `Selecionado: ${selected.map((item) => item.content || item.value).join(', ')}`;
}

function buildMultiChoiceOutputs(input = {}, selected = []) {
  const items = mapChoiceItems(input.items || []);
  const buttonLabel = String(input.options?.buttonLabel || 'Confirmo').trim() || 'Confirmo';
  const choices = [
    ...items.map((item) => ({
      id: item.content || item.value || item.id,
      title: String(item.content || item.value).slice(0, 24),
      value: item.content || item.value
    })),
    {
      id: buttonLabel,
      title: buttonLabel.slice(0, 24),
      value: buttonLabel
    }
  ];
  const body = `${multiChoiceSummary(selected)}\n\nSelecione opções (pode mais de uma). Depois toque em ${buttonLabel}.`;
  return [{
    kind: 'list',
    body: body.slice(0, 1024),
    button: 'Ver opções',
    choices: choices.slice(0, 10)
  }];
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
    if (isMultipleChoiceInput(input)) {
      outputs.push(...buildMultiChoiceOutputs(input, []));
    } else {
      const choices = items.map((item, index) => ({
        id: String(item.content || item.value || item.id || `choice-${index + 1}`).slice(0, 200),
        title: String(item.content || item.value).slice(0, 24),
        value: String(item.content || item.value)
      }));
      outputs.push(choices.length <= 3
        ? { kind: 'buttons', body: 'Escolha uma opção:', choices }
        : { kind: 'list', body: 'Escolha uma opção:', button: 'Ver opções', choices: choices.slice(0, 10) });
    }
  }

  const hasTextOutput = outputs.some((output) => output.kind === 'text');
  if (input.type === 'text input' && !hasTextOutput) {
    const prompt = textInputPrompt(input);
    if (prompt) outputs.push({ kind: 'text', text: prompt });
  }
  return outputs;
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
  const persistExpectedInput = deps.persistExpectedInput || (async ({ identity, inputId, multiChoice }) => upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: {
      typebot_expected_input_id: inputId || null,
      ...(multiChoice !== undefined ? { typebot_multi_choice: multiChoice || null } : {})
    }
  }));
  const persistMultiChoice = deps.persistMultiChoice || (async ({ identity, multiChoice }) => upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: { typebot_multi_choice: multiChoice || null }
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
  const sendPaymentIntro = deps.sendPaymentIntro || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').sendPaymentIntro(args));
  const sendPaymentPendingMenu = deps.sendPaymentPendingMenu || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').sendPaymentPendingMenu(args));
  const handlePaymentChoice = deps.handlePaymentChoice || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').handlePaymentChoice(args));
  const isPaymentStageInput = deps.isPaymentStageInput || ((inputId) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').isPaymentStageInput(inputId));
  const sessionHasPendingPayment = deps.sessionHasPendingPayment || ((session) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').sessionHasPendingPayment(session));
  const completePaymentFlow = deps.completePaymentByToken || ((token, args) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').completePaymentByToken(token, args));
  const findUploadContext = deps.findUploadContextForPhone || deps.findPendingUploadContext || ((phone, opts) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').findUploadContextForPhone(phone, opts));
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
  const resumeTypebotAfterPrescriptionUpload = deps.resumeTypebotAfterPrescriptionUpload || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').resumeTypebotAfterPrescriptionUpload(args));
  const sessionQueues = new Map();
  const expectedInputs = new Map();

  async function processInbound({ messageId, text, identity, whatsappSession, menuBootstrap = false }, identityKey) {
    const claimed = await claim({ messageId, whatsappSessionId: whatsappSession?.id });
    if (!claimed.claimed) return { duplicate: true, responsesSent: 0, sessionIdReused: Boolean(whatsappSession?.typebot_session_id) };

    const config = getConfig();
    try {
      const currentSession = await reloadSession({ identity, whatsappSession });
      const existingSessionId = currentSession?.typebot_session_id || null;
      const expectedInputId = expectedInputs.has(identityKey)
        ? expectedInputs.get(identityKey)
        : currentSession?.metadata?.typebot_expected_input_id || null;
      let inboundText = String(text || '');
      let multiChoiceState = currentSession?.metadata?.typebot_multi_choice || null;

      // Múltipla escolha WhatsApp: acumula opções localmente até Confirmo; só então chama Typebot.
      if (
        multiChoiceState
        && expectedInputId
        && multiChoiceState.inputId === expectedInputId
        && !menuBootstrap
      ) {
        const confirmLabel = String(multiChoiceState.buttonLabel || 'Confirmo').trim();
        if (normalizeChoiceKey(inboundText) === normalizeChoiceKey(confirmLabel)) {
          if (!Array.isArray(multiChoiceState.selected) || multiChoiceState.selected.length === 0) {
            const sent = await provider.sendTextMessage({
              to: identity.phone,
              bsuid: identity.bsuid,
              correlationId: messageId,
              idempotencyKey: `${messageId}:multi-empty`,
              text: `Selecione ao menos uma opção antes de ${confirmLabel}.`
            });
            const providerMessageIds = sent?.providerMessageId ? [sent.providerMessageId] : [];
            const retryOutputs = buildMultiChoiceOutputs({
              items: multiChoiceState.items,
              options: { buttonLabel: confirmLabel, isMultipleChoice: true }
            }, multiChoiceState.selected || []);
            for (const output of retryOutputs) {
              const common = {
                to: identity.phone,
                bsuid: identity.bsuid,
                correlationId: messageId,
                idempotencyKey: `${messageId}:multi-retry:${providerMessageIds.length}`
              };
              let sentChoice;
              if (output.kind === 'list') {
                sentChoice = await provider.sendListMessage({
                  ...common,
                  body: output.body,
                  button: output.button,
                  rows: output.choices
                });
              }
              if (sentChoice?.providerMessageId) providerMessageIds.push(sentChoice.providerMessageId);
            }
            await finish({ messageId, status: 'processed', providerMessageIds });
            return {
              duplicate: false,
              responsesSent: providerMessageIds.length,
              sessionId: existingSessionId,
              sessionIdReused: Boolean(existingSessionId),
              multiChoicePending: true
            };
          }
          inboundText = buildMultiChoiceSubmitText(multiChoiceState.selected);
          multiChoiceState = null;
          await persistMultiChoice({ identity, multiChoice: null });
        } else {
          const toggled = toggleMultiChoiceSelection(multiChoiceState, inboundText);
          if (!toggled.ok) {
            const sent = await provider.sendTextMessage({
              to: identity.phone,
              bsuid: identity.bsuid,
              correlationId: messageId,
              idempotencyKey: `${messageId}:multi-invalid`,
              text: `Opção inválida. ${multiChoiceSummary(multiChoiceState.selected || [])}`
            });
            const providerMessageIds = sent?.providerMessageId ? [sent.providerMessageId] : [];
            await finish({ messageId, status: 'processed', providerMessageIds });
            return {
              duplicate: false,
              responsesSent: providerMessageIds.length,
              sessionId: existingSessionId,
              sessionIdReused: Boolean(existingSessionId),
              multiChoicePending: true
            };
          }
          multiChoiceState = toggled.state;
          await persistMultiChoice({ identity, multiChoice: multiChoiceState });
          const providerMessageIds = [];
          const summarySent = await provider.sendTextMessage({
            to: identity.phone,
            bsuid: identity.bsuid,
            correlationId: messageId,
            idempotencyKey: `${messageId}:multi-summary`,
            text: multiChoiceSummary(multiChoiceState.selected)
          });
          if (summarySent?.providerMessageId) providerMessageIds.push(summarySent.providerMessageId);
          const outputs = buildMultiChoiceOutputs({
            items: multiChoiceState.items,
            options: { buttonLabel: multiChoiceState.buttonLabel || 'Confirmo', isMultipleChoice: true }
          }, multiChoiceState.selected);
          for (const output of outputs) {
            const common = {
              to: identity.phone,
              bsuid: identity.bsuid,
              correlationId: messageId,
              idempotencyKey: `${messageId}:multi:${providerMessageIds.length}`
            };
            let sent;
            if (output.kind === 'list') {
              sent = await provider.sendListMessage({
                ...common,
                body: output.body,
                button: output.button,
                rows: output.choices
              });
            } else {
              sent = await provider.sendTextMessage({ ...common, text: output.text });
            }
            if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
          }
          await finish({ messageId, status: 'processed', providerMessageIds });
          return {
            duplicate: false,
            responsesSent: providerMessageIds.length,
            sessionId: existingSessionId,
            sessionIdReused: Boolean(existingSessionId),
            multiChoicePending: true,
            multiChoiceSelected: multiChoiceState.selected.map((item) => item.value)
          };
        }
      }

      const validation = validatePersonalInput(expectedInputId, inboundText, { now: now() });
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
        await findUploadContext(identity?.phone, { whatsappSession: currentSession })
      );
      if (
        uploadContextBeforeChat
        && isUploadConfirmationText(inboundText)
        && (isUploadChoiceInput(expectedInputId) || isUploadChoiceInput(currentSession?.metadata?.typebot_expected_input_id))
      ) {
        const uploadStatus = await getUploadStatus(uploadContextBeforeChat.token);
        if (uploadStatus.upload_completed) {
          const resume = await resumeTypebotAfterPrescriptionUpload({
            atendimentoId: uploadContextBeforeChat.atendimentoId,
            token: uploadContextBeforeChat.token,
            correlationId: messageId,
            whatsappSession: currentSession,
            phone: identity?.phone
          });
          expectedInputs.set(identityKey, null);
          await persistExpectedInput({ identity, whatsappSession: currentSession, inputId: null });
          await finish({
            messageId,
            status: resume.ok ? 'processed' : 'failed',
            providerMessageIds: [],
            errorMessage: resume.ok ? null : resume.error || resume.code
          });
          return {
            duplicate: false,
            responsesSent: resume.responsesSent || 0,
            sessionId: existingSessionId,
            sessionIdReused: Boolean(existingSessionId),
            uploadConfirmed: true,
            whatsappResume: resume
          };
        }
      }

      const paymentStageActive = isPaymentStageInput(expectedInputId)
        || isPaymentStageInput(currentSession?.metadata?.typebot_expected_input_id)
        || sessionHasPendingPayment(currentSession);
      if (paymentStageActive && existingSessionId) {
        const paymentChoice = await handlePaymentChoice({
          text: inboundText,
          session: currentSession,
          correlationId: messageId,
          provider
        });
        if (paymentChoice.handled) {
          await finish({ messageId, status: 'processed', providerMessageIds: [] });
          return {
            duplicate: false,
            responsesSent: paymentChoice.action === 'completed' || paymentChoice.action === 'already_paid' ? 2 : 1,
            sessionId: existingSessionId,
            sessionIdReused: true,
            paymentHandled: paymentChoice.action
          };
        }
        if (sessionHasPendingPayment(currentSession)) {
          const pendingSent = await sendPaymentPendingMenu({
            session: currentSession,
            correlationId: messageId,
            provider
          });
          await finish({ messageId, status: 'processed', providerMessageIds: pendingSent });
          return {
            duplicate: false,
            responsesSent: pendingSent.length,
            sessionId: existingSessionId,
            sessionIdReused: true,
            paymentPending: true
          };
        }
      }

      let typebot;
      let sessionIdForChat = existingSessionId;
      let sessionIdReused = false;
      if (menuBootstrap) {
        // Menu 1/2 é do backend. Aqui só inicia o Typebot oficial e apresenta
        // o primeiro bloco interno (Bem-Vindo / "Vamos Começar"), sem auto-avançar.
        typebot = await callWithRetry(
          () => callTypebot(
            `/typebots/${encodeURIComponent(config.publicId)}/startChat`,
            {},
            { config }
          ),
          {
            attempts: config.retryAttempts,
            baseDelayMs: config.retryBaseDelayMs,
            maxDelayMs: config.retryMaxDelayMs,
            sleep
          }
        );
        const bootstrapSessionId = typebot.sessionId;
        if (!bootstrapSessionId) throw new Error('Typebot não retornou sessionId');
        await saveSessionId({ sessionId: currentSession.id, typebotSessionId: bootstrapSessionId });
        sessionIdForChat = bootstrapSessionId;
      } else {
        if (
          sessionIdForChat
          && expectedInputId === config.welcomeChoiceInputId
          && isConversationGreeting(inboundText)
        ) {
          await saveSessionId({ sessionId: currentSession.id, typebotSessionId: null });
          sessionIdForChat = null;
          expectedInputs.set(identityKey, null);
          await persistExpectedInput({ identity, whatsappSession: currentSession, inputId: null, multiChoice: null });
        }

        const path = sessionIdForChat
          ? `/sessions/${encodeURIComponent(sessionIdForChat)}/continueChat`
          : `/typebots/${encodeURIComponent(config.publicId)}/startChat`;
        sessionIdReused = Boolean(sessionIdForChat);
        const message = {
          type: 'text',
          text: validation.isPersonal ? validation.value : String(inboundText || ''),
          metadata: { replyId: messageId }
        };
        typebot = await callWithRetry(
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
      }

      const sessionId = sessionIdForChat || typebot.sessionId;
      if (!sessionId) throw new Error('Typebot não retornou sessionId');
      if (!existingSessionId || menuBootstrap) {
        await saveSessionId({ sessionId: currentSession.id, typebotSessionId: sessionId });
      }
      const nextInputId = typebot.input?.id || null;
      expectedInputs.set(identityKey, nextInputId);
      let nextMultiChoice = null;
      if (typebot.input && isMultipleChoiceInput(typebot.input)) {
        nextMultiChoice = {
          inputId: typebot.input.id,
          items: mapChoiceItems(typebot.input.items || []),
          selected: [],
          buttonLabel: String(typebot.input.options?.buttonLabel || 'Confirmo').trim() || 'Confirmo'
        };
      }
      await persistExpectedInput({
        identity,
        whatsappSession: currentSession,
        inputId: nextInputId,
        multiChoice: nextMultiChoice
      });

      const providerMessageIds = [];
      let uploadContext = uploadContextFromSession(
        currentSession,
        await findUploadContext(identity?.phone, { whatsappSession: currentSession })
      );
      if (uploadContext) await persistUploadContext({ identity, uploadContext });

      let outputs = convertTypebotResponse(typebot);
      if (nextMultiChoice) {
        outputs = [
          ...outputs.filter((output) => output.kind === 'text'),
          ...buildMultiChoiceOutputs(typebot.input, nextMultiChoice.selected)
        ];
      }
      if (uploadContext && responseLooksLikeUploadStage(typebot, nextInputId)) {
        outputs = augmentUploadOutputs(outputs, uploadContext);
      }

      for (const output of outputs) {
        const common = { to: identity.phone, bsuid: identity.bsuid, correlationId: messageId, idempotencyKey: `${messageId}:${providerMessageIds.length}` };
        let sent;
        if (output.kind === 'buttons') sent = await provider.sendButtonMessage({ ...common, body: output.body, buttons: output.choices });
        else if (output.kind === 'list') sent = await provider.sendListMessage({ ...common, body: output.body, button: output.button, rows: output.choices });
        else sent = await provider.sendTextMessage({ ...common, text: output.text });
        if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
      }

      // Payment input no WhatsApp: mensagem institucional + botão CTA ocultando URL técnica.
      if (typebot.input?.type === 'payment input') {
        try {
          const link = await createPaymentLink({
            identity,
            typebotSessionId: sessionId,
            // FASE 4B: payment input é só gatilho — não usar PaymentIntent do Typebot.
            runtimeOptions: {},
            existingSession: currentSession
          });
          if (link.alreadyPaid) {
            const completed = await completePaymentFlow(link.token, { session: currentSession, provider });
            await finish({ messageId, status: 'processed', providerMessageIds: [] });
            return {
              duplicate: false,
              responsesSent: completed.responsesSent || 0,
              sessionId,
              sessionIdReused: Boolean(existingSessionId),
              paymentAlreadyPaid: true
            };
          }
          const introSent = await sendPaymentIntro({
            session: currentSession,
            checkoutRedirectUrl: link.checkoutRedirectUrl,
            correlationId: messageId,
            provider,
            idempotencyPrefix: `${messageId}:payment-intro`
          });
          providerMessageIds.push(...introSent);
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
        sessionIdReused: sessionIdReused && !menuBootstrap,
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
  buildMultiChoiceSubmitText,
  callWithRetry,
  convertTypebotResponse,
  createTypebotWhatsAppBridge,
  describeError,
  fetchTypebot,
  isMultipleChoiceInput,
  isRetryableTypebotError,
  textInputPrompt,
  toggleMultiChoiceSelection
};
