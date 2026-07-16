const metaProvider = require('./providers/meta.provider');
const { createIntegrationError } = require('../store/integration-logs.store');
const { claimMetaMessage, finishMetaMessage } = require('../store/whatsapp-meta-receipts.store');
const { setTypebotSessionId } = require('../store/whatsapp-sessions.store');

function getConfig() {
  return {
    viewerUrl: String(process.env.TYPEBOT_VIEWER_URL || '').replace(/\/$/, ''),
    publicId: String(process.env.TYPEBOT_PUBLIC_ID || 'doctor-prescreve-8rmljgu').trim(),
    timeoutMs: Number(process.env.TYPEBOT_RUNTIME_TIMEOUT_MS || 12000)
  };
}

function richTextToPlainText(nodes = []) {
  const parts = [];
  const walk = (items) => {
    for (const item of items || []) {
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
  return outputs;
}

async function fetchTypebot(path, body, { fetchImpl = fetch, config = getConfig() } = {}) {
  if (!config.viewerUrl) throw Object.assign(new Error('TYPEBOT_VIEWER_URL não configurada'), { code: 'TYPEBOT_NOT_CONFIGURED' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.viewerUrl}/api/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data?.message || `Typebot HTTP ${response.status}`), { code: 'TYPEBOT_RUNTIME_ERROR' });
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

  return async function handleInbound({ messageId, text, identity, whatsappSession }) {
    const claimed = await claim({ messageId, whatsappSessionId: whatsappSession?.id });
    if (!claimed.claimed) return { duplicate: true, responsesSent: 0, sessionIdReused: Boolean(whatsappSession?.typebot_session_id) };

    const config = getConfig();
    const existingSessionId = whatsappSession?.typebot_session_id || null;
    try {
      const typebot = existingSessionId
        ? await callTypebot(`/sessions/${encodeURIComponent(existingSessionId)}/continueChat`, { message: text }, { config })
        : await callTypebot(`/typebots/${encodeURIComponent(config.publicId)}/startChat`, { message: text }, { config });

      const sessionId = existingSessionId || typebot.sessionId;
      if (!sessionId) throw new Error('Typebot não retornou sessionId');
      if (!existingSessionId) await saveSessionId({ sessionId: whatsappSession.id, typebotSessionId: sessionId });

      const providerMessageIds = [];
      for (const output of convertTypebotResponse(typebot)) {
        const common = { to: identity.phone, bsuid: identity.bsuid, correlationId: messageId, idempotencyKey: `${messageId}:${providerMessageIds.length}` };
        let sent;
        if (output.kind === 'buttons') sent = await provider.sendButtonMessage({ ...common, body: output.body, buttons: output.choices });
        else if (output.kind === 'list') sent = await provider.sendListMessage({ ...common, body: output.body, button: output.button, rows: output.choices });
        else sent = await provider.sendTextMessage({ ...common, text: output.text });
        if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
      }

      await finish({ messageId, status: 'processed', providerMessageIds });
      return { duplicate: false, responsesSent: providerMessageIds.length, sessionId, sessionIdReused: Boolean(existingSessionId) };
    } catch (error) {
      await finish({ messageId, status: 'failed', errorMessage: error.message }).catch(() => {});
      await logError({
        integration: error.code?.startsWith('META_') || error.code === 'PROVIDER_ERROR' ? 'meta_whatsapp' : 'typebot_runtime',
        correlationId: messageId,
        error,
        request: { message_id: messageId, whatsapp_session_id: whatsappSession?.id || null }
      }).catch(() => {});
      throw error;
    }
  };
}

module.exports = { convertTypebotResponse, createTypebotWhatsAppBridge, fetchTypebot };
