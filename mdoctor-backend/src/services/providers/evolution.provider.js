const DEFAULT_TIMEOUT_MS = 12000;

function trimTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function getConfig() {
  return {
    baseUrl: trimTrailingSlash(process.env.EVOLUTION_API_URL || ''),
    apiKey: String(process.env.EVOLUTION_API_KEY || '').trim(),
    instance: String(process.env.EVOLUTION_INSTANCE || '').trim(),
    timeoutMs: Number(process.env.EVOLUTION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

function isConfigured() {
  const config = getConfig();
  return Boolean(config.baseUrl && config.apiKey && config.instance);
}

function authHeaders(apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`
  };
}

async function requestJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { response, data: parsed };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeResponse(data = {}, metadata = {}) {
  const messageId =
    data?.key?.id ||
    data?.id ||
    data?.messageId ||
    data?.data?.key?.id ||
    data?.data?.id ||
    null;

  const status =
    data?.status ||
    data?.messageStatus ||
    data?.data?.status ||
    (metadata.httpStatus && metadata.httpStatus >= 200 && metadata.httpStatus < 300 ? 'sent' : 'unknown');

  return {
    provider: 'evolution',
    providerMessageId: messageId,
    providerStatus: status,
    raw: data
  };
}

async function sendTextMessage({ to, text, correlationId, idempotencyKey }) {
  const config = getConfig();
  if (!isConfigured()) {
    const error = new Error('Evolution API não configurada');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const body = {
    number: String(to || '').replace(/\D/g, ''),
    text: String(text || ''),
    options: {
      delay: 1200,
      presence: 'composing'
    }
  };

  const { response, data } = await requestJson(
    `${config.baseUrl}/message/sendText/${encodeURIComponent(config.instance)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(config.apiKey),
        ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: JSON.stringify(body)
    },
    config.timeoutMs
  );

  if (!response.ok) {
    const error = new Error(data?.message || `Falha Evolution sendText (${response.status})`);
    error.code = 'PROVIDER_ERROR';
    error.providerStatus = response.status;
    error.providerResponse = data;
    throw error;
  }

  return normalizeResponse(data, { httpStatus: response.status });
}

async function sendDocumentMessage({ to, documentUrl, fileName = 'receita.pdf', caption = '', correlationId, idempotencyKey }) {
  const config = getConfig();
  if (!isConfigured()) {
    const error = new Error('Evolution API não configurada');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const body = {
    number: String(to || '').replace(/\D/g, ''),
    mediatype: 'document',
    media: documentUrl,
    fileName,
    caption
  };

  const { response, data } = await requestJson(
    `${config.baseUrl}/message/sendMedia/${encodeURIComponent(config.instance)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(config.apiKey),
        ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: JSON.stringify(body)
    },
    config.timeoutMs
  );

  if (!response.ok) {
    const error = new Error(data?.message || `Falha Evolution sendMedia (${response.status})`);
    error.code = 'PROVIDER_ERROR';
    error.providerStatus = response.status;
    error.providerResponse = data;
    throw error;
  }

  return normalizeResponse(data, { httpStatus: response.status });
}

async function healthCheck() {
  const config = getConfig();
  if (!isConfigured()) {
    return {
      ok: false,
      configured: false,
      provider: 'evolution',
      instance: config.instance || null,
      message: 'Evolution API não configurada'
    };
  }

  const { response, data } = await requestJson(
    `${config.baseUrl}/instance/connectionState/${encodeURIComponent(config.instance)}`,
    {
      method: 'GET',
      headers: {
        ...authHeaders(config.apiKey)
      }
    },
    config.timeoutMs
  );

  const state =
    data?.instance?.state ||
    data?.state ||
    data?.status ||
    'unknown';

  return {
    ok: response.ok,
    configured: true,
    provider: 'evolution',
    instance: config.instance,
    state,
    httpStatus: response.status,
    data
  };
}

module.exports = {
  getConfig,
  isConfigured,
  sendTextMessage,
  sendDocumentMessage,
  healthCheck,
  normalizeResponse
};
