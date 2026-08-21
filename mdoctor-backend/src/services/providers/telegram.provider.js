const DEFAULT_TIMEOUT_MS = 12000;

function getConfig() {
  return {
    botToken: String(process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: String(process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim(),
    timeoutMs: Number(process.env.TELEGRAM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.botToken && config.chatId);
}

async function requestJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { response, data: parsed };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timeoutError = new Error('Timeout na chamada Telegram Bot API');
      timeoutError.code = 'PROVIDER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTextMessage({ text }) {
  const config = getConfig();
  if (!isConfigured()) {
    const error = new Error('Telegram Bot API não configurada (TELEGRAM_BOT_TOKEN/TELEGRAM_ADMIN_CHAT_ID ausentes)');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const { response, data } = await requestJson(
    `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text: String(text || '') })
    },
    config.timeoutMs
  );

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.description || `Falha Telegram Bot API sendMessage (${response.status})`);
    error.code = data?.error_code || 'PROVIDER_ERROR';
    error.providerStatus = response.status;
    error.providerResponse = data;
    throw error;
  }

  return {
    provider: 'telegram',
    providerMessageId: data?.result?.message_id ?? null,
    providerStatus: 'sent',
    raw: data
  };
}

module.exports = {
  getConfig,
  isConfigured,
  sendTextMessage
};
