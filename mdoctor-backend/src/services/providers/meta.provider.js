const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_API_VERSION = 'v25.0';

function getConfig() {
  return {
    accessToken: String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    businessAccountId: String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim(),
    apiVersion: String(process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_API_VERSION).trim(),
    timeoutMs: Number(process.env.WHATSAPP_GRAPH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

function getConfiguredParts(config = getConfig()) {
  return {
    accessToken: Boolean(config.accessToken),
    phoneNumberId: Boolean(config.phoneNumberId),
    businessAccountId: Boolean(config.businessAccountId)
  };
}

function isConfigured() {
  const parts = getConfiguredParts();
  return parts.accessToken && parts.phoneNumberId;
}

// Gestão de templates (WhatsApp Business Management API) usa o WABA ID, não
// o phone_number_id — são credenciais/escopos diferentes na Graph API.
function isTemplatesConfigured() {
  const parts = getConfiguredParts();
  return parts.accessToken && parts.businessAccountId;
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

function requireTemplatesConfigured() {
  if (isTemplatesConfigured()) return;
  const error = new Error('WABA não configurada para templates (WHATSAPP_ACCESS_TOKEN/WHATSAPP_BUSINESS_ACCOUNT_ID ausentes)');
  error.code = 'PROVIDER_NOT_CONFIGURED';
  throw error;
}

// Capacidade mínima de "list + manage" de templates da WABA — usada para
// demonstrar o uso real da permissão whatsapp_business_management no App
// Review da Meta (ver docs/roteiro de vídeo).
async function listMessageTemplates({ limit = 20, after = null } = {}) {
  requireTemplatesConfigured();
  const config = getConfig();
  const params = new URLSearchParams({ limit: String(limit) });
  if (after) params.set('after', after);

  const { response, data } = await requestJson(
    `https://graph.facebook.com/${config.apiVersion}/${config.businessAccountId}/message_templates?${params.toString()}`,
    { method: 'GET', headers: { Authorization: `Bearer ${config.accessToken}` } },
    config.timeoutMs
  );

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Falha ao listar templates WABA (${response.status})`);
    error.code = data?.error?.code || 'PROVIDER_ERROR';
    error.providerResponse = data;
    throw error;
  }

  return {
    templates: Array.isArray(data?.data) ? data.data : [],
    paging: data?.paging || null
  };
}

async function createMessageTemplate({ name, category, language, components }) {
  requireTemplatesConfigured();
  if (!name || !category || !language || !Array.isArray(components)) {
    const error = new Error('createMessageTemplate requer name, category, language e components');
    error.code = 'INVALID_TEMPLATE_PAYLOAD';
    throw error;
  }

  const config = getConfig();
  const { response, data } = await requestJson(
    `https://graph.facebook.com/${config.apiVersion}/${config.businessAccountId}/message_templates`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, language, components })
    },
    config.timeoutMs
  );

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Falha ao criar template WABA (${response.status})`);
    error.code = data?.error?.code || 'PROVIDER_ERROR';
    error.providerResponse = data;
    throw error;
  }

  return { id: data?.id || null, status: data?.status || 'PENDING', category: data?.category || category, raw: data };
}

async function deleteMessageTemplate({ name }) {
  requireTemplatesConfigured();
  if (!name) {
    const error = new Error('deleteMessageTemplate requer name');
    error.code = 'INVALID_TEMPLATE_PAYLOAD';
    throw error;
  }

  const config = getConfig();
  const { response, data } = await requestJson(
    `https://graph.facebook.com/${config.apiVersion}/${config.businessAccountId}/message_templates?name=${encodeURIComponent(name)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${config.accessToken}` } },
    config.timeoutMs
  );

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Falha ao excluir template WABA (${response.status})`);
    error.code = data?.error?.code || 'PROVIDER_ERROR';
    error.providerResponse = data;
    throw error;
  }

  return { success: Boolean(data?.success), raw: data };
}

module.exports = {
  getConfig,
  getConfiguredParts,
  isConfigured,
  isTemplatesConfigured,
  resolveRecipient,
  listMessageTemplates,
  createMessageTemplate,
  deleteMessageTemplate,
  sendTextMessage,
  sendDocumentMessage,
  normalizeResponse
};
