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

// WhatsApp não tem como exibir um rótulo curto escondendo uma URL longa numa
// mensagem de texto simples — o link só fica clicável se aparecer por
// extenso. Por isso, qualquer parágrafo do Typebot que contenha um link
// (ex.: os documentos jurídicos de LGPD/Telemedicina/Termos) vira um botão
// de URL (abre o link externamente, sem baixar nada no WhatsApp e sem
// mostrar a URL), em vez de texto simples.
const DOC_BUTTON_LABELS = {
  'Consentimento LGPD': 'Consentimento LGPD',
  'Política de Privacidade': 'Política Privacidade',
  'Consentimento para Telemedicina Assíncrona': 'Telemedicina',
  'Aviso Importante — Não Urgência/Emergência': 'Não Urgência',
  'Política e Termos de Uso': 'Termos de Uso'
};

function docButtonLabel(label) {
  return DOC_BUTTON_LABELS[label] || String(label || 'Abrir').slice(0, 20);
}

function richTextContainsLink(nodes = []) {
  for (const item of nodes || []) {
    if (item?.type === 'a') return true;
    if (Array.isArray(item?.children) && richTextContainsLink(item.children)) return true;
  }
  return false;
}

function richTextToOutputs(nodes = []) {
  const outputs = [];
  let buffer = [];
  let sawLink = false;
  const bufferedText = () => buffer.join('').replace(/\n{3,}/g, '\n\n').trim();
  const flushText = () => {
    const text = bufferedText();
    if (text) outputs.push({ kind: 'text', text });
    buffer = [];
  };
  for (const node of nodes || []) {
    const anchor = node?.type === 'p' && Array.isArray(node.children)
      ? node.children.find((child) => child?.type === 'a')
      : null;
    if (anchor) {
      const label = (anchor.children || []).map((c) => (typeof c?.text === 'string' ? c.text : '')).join('').trim();
      const url = String(anchor.url || '').trim();
      // Só vira botão cta_url quando o rótulo é um documento jurídico
      // conhecido (LGPD, Telemedicina, Termos). Outros links do Typebot
      // (ex.: link de upload de receita) continuam como texto simples —
      // quem decide o que fazer com eles é typebot-prescription-upload.service.js
      // (responseLooksLikeUploadStage / augmentOutputsWithUploadLink), que
      // já intercepta e reescreve esse conteúdo antes do envio.
      if (url && label && DOC_BUTTON_LABELS[label]) {
        // O primeiro link do bloco reaproveita o texto introdutório do grupo
        // (se houver) como corpo do próprio botão, em vez de mandá-lo numa
        // mensagem de texto separada. Links seguintes não repetem esse texto.
        const introText = !sawLink ? bufferedText() : null;
        buffer = [];
        outputs.push({ kind: 'document', url, label, introText: introText || null });
        sawLink = true;
        continue;
      }
    }
    buffer.push(richTextToPlainText([node]));
    buffer.push('\n');
  }
  flushText();
  return outputs;
}

/** Inputs múltiplos do Typebot oficial (fallback se a API não enviar options). */
const CHRONIC_DISEASE_MULTI_CHOICE_INPUT_ID = 'b156nm008xh7gb52n7w3egzn'; // Doença Cronica
const OFFICIAL_MULTI_CHOICE_INPUT_IDS = new Set([
  CHRONIC_DISEASE_MULTI_CHOICE_INPUT_ID,
  's5VQGsVF4hQgziQsXVdwPDW' // Sinais de Alerta
]);

const DISEASE_MULTI_CHOICE_INTRO =
  'Você pode selecionar mais de uma condição. Escolha uma doença por vez. Depois de marcar todas, toque em “Confirmo”.';

function isMultipleChoiceInput(input = {}) {
  if (input?.options?.isMultipleChoice === true) return true;
  return OFFICIAL_MULTI_CHOICE_INPUT_IDS.has(String(input?.id || '').trim());
}

/** UX copy de multi-patologias — não aplicar a Sinais de Alerta. */
function isChronicDiseaseMultiChoiceInput(input = {}) {
  return String(input?.id || '').trim() === CHRONIC_DISEASE_MULTI_CHOICE_INPUT_ID;
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

/**
 * Patologias: pergunta única em texto simples, com opções numeradas.
 * O paciente digita os números (ou os nomes) separados por vírgula e conclui
 * pela seta nativa de envio do WhatsApp — sem lista interativa, sem Confirmo
 * e sem reenviar mensagem a cada escolha.
 */
function buildDiseaseChoicePrompt(items = []) {
  const mapped = mapChoiceItems(items);
  const lines = mapped.map((item, index) => `${index + 1}. ${item.content}`).join('\n');
  return [
    'Para quais destas condições você faz tratamento contínuo?',
    '',
    lines,
    '',
    'Digite os números correspondentes separados por vírgula (ex.: 1, 3). Pode escolher mais de uma opção.'
  ].join('\n');
}

/** Aceita números ("1, 3") ou os próprios nomes das condições, em uma única mensagem. */
function parseDiseaseFreeTextSelection(items = [], text = '') {
  const mapped = mapChoiceItems(items);
  const raw = String(text || '').trim();
  if (!raw) return [];
  const tokens = raw
    .replace(/\s+e\s+/gi, ',')
    .split(/[,;/]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const selected = [];
  const seen = new Set();
  for (const token of tokens) {
    let match = null;
    if (/^\d+$/.test(token)) {
      match = mapped[Number(token) - 1] || null;
    }
    if (!match) match = findChoiceItem(mapped, token);
    if (match && !seen.has(match.value)) {
      seen.add(match.value);
      selected.push(match);
    }
  }
  return selected;
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

function multiChoiceSummary(selected = [], input = {}) {
  const isDisease = isChronicDiseaseMultiChoiceInput(input);
  if (!selected.length) {
    return isDisease ? 'Nenhuma condição selecionada ainda.' : 'Nenhuma opção selecionada ainda.';
  }
  if (isDisease) {
    return `Selecionadas até agora: ${selected.map((item) => item.content || item.value).join(', ')}.`;
  }
  return `Selecionado: ${selected.map((item) => item.content || item.value).join(', ')}`;
}

function buildMultiChoiceOutputs(input = {}, selected = []) {
  const items = mapChoiceItems(input.items || []);
  const buttonLabel = String(input.options?.buttonLabel || 'Confirmo').trim() || 'Confirmo';
  const isDisease = isChronicDiseaseMultiChoiceInput(input);
  const itemChoices = items.map((item) => ({
    id: item.content || item.value || item.id,
    title: String(item.content || item.value).slice(0, 24),
    value: item.content || item.value
  }));
  const confirmChoice = { id: buttonLabel, title: buttonLabel.slice(0, 24), value: buttonLabel };
  // Patologias: Confirmo não pode ser uma 5ª linha dentro da mesma lista de
  // doenças (parece uma opção clínica a mais). A lista só traz as condições;
  // a conclusão da seleção vai numa mensagem de botão separada, o mecanismo
  // mínimo do WhatsApp para uma ação distinta de "marcar mais uma opção".
  const choices = isDisease ? itemChoices : [...itemChoices, confirmChoice];

  const outputs = [];
  if (isDisease && !selected.length) {
    outputs.push({ kind: 'text', text: DISEASE_MULTI_CHOICE_INTRO });
  }

  let body;
  if (isDisease) {
    body = selected.length
      ? multiChoiceSummary(selected, input)
      : `Escolha uma doença por vez. Depois de marcar todas, toque em ${buttonLabel}.`;
  } else {
    body = `${multiChoiceSummary(selected, input)}\n\nSelecione opções (pode mais de uma). Depois toque em ${buttonLabel}.`;
  }

  outputs.push({
    kind: 'list',
    body: body.slice(0, 1024),
    button: 'Ver opções',
    choices: choices.slice(0, 10)
  });

  if (isDisease) {
    outputs.push({
      kind: 'buttons',
      body: `Marcou todas as condições? Toque em ${buttonLabel} para concluir.`,
      choices: [confirmChoice]
    });
  }

  return outputs;
}

function convertTypebotResponse(response = {}) {
  const outputs = [];
  for (const message of response.messages || []) {
    if (message?.type !== 'text') continue;
    const richText = Array.isArray(message.content?.richText) ? message.content.richText : null;
    if (richText && richTextContainsLink(richText)) {
      const linkOutputs = richTextToOutputs(richText);
      // O Typebot manda a introdução do grupo (ex.: "Antes de continuar,
      // leia os documentos abaixo:") como uma mensagem de texto própria,
      // logo ANTES da mensagem com os links — não junto no mesmo richText.
      // Se o output anterior é só esse texto puro, ele vira o corpo do
      // primeiro botão de documento, em vez de ficar como mensagem separada.
      const previous = outputs[outputs.length - 1];
      if (previous?.kind === 'text' && linkOutputs[0]?.kind === 'document' && !linkOutputs[0].introText) {
        linkOutputs[0].introText = previous.text;
        outputs.pop();
      }
      outputs.push(...linkOutputs);
      continue;
    }
    const text = typebotText(message);
    if (text) outputs.push({ kind: 'text', text });
  }

  const input = response.input || {};
  const items = Array.isArray(input.items) ? input.items.filter((item) => item?.content || item?.value) : [];
  if (input.type === 'choice input' && items.length) {
    if (isMultipleChoiceInput(input)) {
      if (isChronicDiseaseMultiChoiceInput(input)) {
        outputs.push({ kind: 'text', text: buildDiseaseChoicePrompt(input.items) });
      } else {
        outputs.push(...buildMultiChoiceOutputs(input, []));
      }
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

      // Patologias: pergunta única, sem Confirmo — o paciente digita todas as
      // condições numa mensagem só e conclui pela seta nativa de envio do
      // WhatsApp. Não reaproveita o mecanismo de acumular-depois-Confirmo
      // usado por Sinais de Alerta (bloco abaixo, inalterado).
      if (
        multiChoiceState
        && expectedInputId
        && multiChoiceState.inputId === expectedInputId
        && !menuBootstrap
        && isChronicDiseaseMultiChoiceInput({ id: multiChoiceState.inputId })
      ) {
        const selected = parseDiseaseFreeTextSelection(multiChoiceState.items, inboundText);
        if (!selected.length) {
          const sent = await provider.sendTextMessage({
            to: identity.phone,
            bsuid: identity.bsuid,
            correlationId: messageId,
            idempotencyKey: `${messageId}:disease-invalid`,
            text: `Não entendi sua resposta. ${buildDiseaseChoicePrompt(multiChoiceState.items)}`
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
        inboundText = buildMultiChoiceSubmitText(selected);
        multiChoiceState = null;
        await persistMultiChoice({ identity, multiChoice: null });
        // Sem return: cai para o fluxo normal abaixo, que chama o Typebot com inboundText já pronto.
      }

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
              id: multiChoiceState.inputId,
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
              } else if (output.kind === 'buttons') {
                sentChoice = await provider.sendButtonMessage({
                  ...common,
                  body: output.body,
                  buttons: output.choices
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
              text: `Opção inválida. ${multiChoiceSummary(multiChoiceState.selected || [], { id: multiChoiceState.inputId })}`
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
          // Patologias: o resumo "Selecionadas até agora" já vai no corpo da
          // lista (buildMultiChoiceOutputs); mandar de novo aqui como texto
          // avulso duplicava a mesma frase em duas mensagens seguidas.
          // Sinais de alerta mantém a mensagem de texto separada, como antes.
          const isDiseaseChoice = isChronicDiseaseMultiChoiceInput({ id: multiChoiceState.inputId });
          if (!isDiseaseChoice) {
            const summarySent = await provider.sendTextMessage({
              to: identity.phone,
              bsuid: identity.bsuid,
              correlationId: messageId,
              idempotencyKey: `${messageId}:multi-summary`,
              text: multiChoiceSummary(multiChoiceState.selected, { id: multiChoiceState.inputId })
            });
            if (summarySent?.providerMessageId) providerMessageIds.push(summarySent.providerMessageId);
          }
          const outputs = buildMultiChoiceOutputs({
            id: multiChoiceState.inputId,
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
            } else if (output.kind === 'buttons') {
              sent = await provider.sendButtonMessage({
                ...common,
                body: output.body,
                buttons: output.choices
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
      // Patologias já saem prontas de convertTypebotResponse como a pergunta
      // única em texto (buildDiseaseChoicePrompt) — nada a reconstruir aqui.
      if (nextMultiChoice && !isChronicDiseaseMultiChoiceInput(typebot.input)) {
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
        // A Meta exige `body.text` não-vazio em toda mensagem cta_url (um
        // espaço em branco é rejeitado com erro 131008 "Required parameter
        // is missing" — testado ao vivo). O primeiro botão do grupo usa a
        // introdução do próprio grupo como corpo (nenhuma mensagem de texto
        // separada antes dele); os botões seguintes usam só um ícone neutro,
        // sem repetir o nome do documento nem usar frase de instrução.
        else if (output.kind === 'document') sent = await provider.sendCtaUrlMessage({ ...common, body: output.introText || '📄', displayText: docButtonLabel(output.label), url: output.url });
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
  buildMultiChoiceOutputs,
  buildDiseaseChoicePrompt,
  parseDiseaseFreeTextSelection,
  callWithRetry,
  convertTypebotResponse,
  createTypebotWhatsAppBridge,
  describeError,
  DISEASE_MULTI_CHOICE_INTRO,
  fetchTypebot,
  isChronicDiseaseMultiChoiceInput,
  isMultipleChoiceInput,
  isRetryableTypebotError,
  multiChoiceSummary,
  textInputPrompt,
  toggleMultiChoiceSelection
};
