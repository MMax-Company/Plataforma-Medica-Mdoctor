const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_API_VERSION = 'v21.0';

function getConfig() {
  return {
    accessToken: String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    apiVersion: String(process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_API_VERSION).trim(),
    timeoutMs: Number(process.env.WHATSAPP_GRAPH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

function getConfiguredParts(config = getConfig()) {
  return {
    accessToken: Boolean(config.accessToken),
    phoneNumberId: Boolean(config.phoneNumberId)
  };
}

function isConfigured() {
  const parts = getConfiguredParts();
  return parts.accessToken && parts.phoneNumberId;
}

// Envio por telefone usa o campo "to" (fluxo clássico da Cloud API); envio
// por BSUID usa "recipient": { id } — contatos de interoperabilidade não têm
// telefone, então a Cloud API espera o identificador opaco nesse formato.
function resolveRecipient({ to, bsuid, recipientId }) {
  const phone = to ? String(to).replace(/\D/g, '').trim() : '';
  const id = bsuid || recipientId ? String(bsuid || recipientId).trim() : '';

  if (phone) {
    return { messaging_product: 'whatsapp', to: phone };
  }
  if (id) {
    return { messaging_product: 'whatsapp', recipient: { id } };
  }

  const error = new Error('Envio Meta requer "to" (telefone) ou "bsuid"/"recipientId" (BSUID)');
  error.code = 'META_MISSING_RECIPIENT';
  throw error;
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
      const timeoutError = new Error('Timeout na chamada Meta WhatsApp Cloud API');
      timeoutError.code = 'PROVIDER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeResponse(data = {}, metadata = {}) {
  return {
    provider: 'meta',
    providerMessageId: data?.messages?.[0]?.id || null,
    providerStatus: metadata.httpStatus && metadata.httpStatus >= 200 && metadata.httpStatus < 300 ? 'sent' : 'unknown',
    raw: data
  };
}

async function postMessage(payload, { correlationId, idempotencyKey } = {}) {
  const config = getConfig();
  if (!isConfigured()) {
    const error = new Error('Meta WhatsApp Cloud API não configurada (WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID ausentes)');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  const { response, data } = await requestJson(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
        ...(correlationId ? { 'X-Correlation-Id': correlationId } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: JSON.stringify(payload)
    },
    config.timeoutMs
  );

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Falha Meta WhatsApp Cloud API sendMessage (${response.status})`);
    error.code = data?.error?.code || 'PROVIDER_ERROR';
    error.providerStatus = response.status;
    error.providerResponse = data;
    throw error;
  }

  return normalizeResponse(data, { httpStatus: response.status });
}

async function sendTextMessage({ to, bsuid, recipientId, text, correlationId, idempotencyKey }) {
  const recipient = resolveRecipient({ to, bsuid, recipientId });
  return postMessage(
    {
      ...recipient,
      type: 'text',
      text: { body: String(text || ''), preview_url: false }
    },
    { correlationId, idempotencyKey }
  );
}

async function sendDocumentMessage({ to, bsuid, recipientId, documentUrl, fileName, caption, correlationId, idempotencyKey }) {
  const recipient = resolveRecipient({ to, bsuid, recipientId });
  return postMessage(
    {
      ...recipient,
      type: 'document',
      document: {
        link: documentUrl,
        filename: fileName || undefined,
        caption: caption || undefined
      }
    },
    { correlationId, idempotencyKey }
  );
}

module.exports = {
  getConfig,
  getConfiguredParts,
  isConfigured,
  resolveRecipient,
  sendTextMessage,
  sendDocumentMessage,
  normalizeResponse
};
