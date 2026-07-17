const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_API_VERSION = 'v25.0';

function getConfig() {
  return {
    accessToken: String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
    phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
    businessAccountId: String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim(),
    apiVersion: String(process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_API_VERSION).trim(),
    timeoutMs: Number(process.env.WHATSAPP_GRAPH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    appId: String(process.env.WHATSAPP_APP_ID || '').trim(),
    appSecret: String(process.env.WHATSAPP_APP_SECRET || '').trim(),
    embeddedSignupConfigId: String(process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID || '').trim()
  };
}

function getConfiguredParts(config = getConfig()) {
  return {
    accessToken: Boolean(config.accessToken),
    phoneNumberId: Boolean(config.phoneNumberId),
    businessAccountId: Boolean(config.businessAccountId),
    appId: Boolean(config.appId),
    appSecret: Boolean(config.appSecret),
    embeddedSignupConfigId: Boolean(config.embeddedSignupConfigId)
  };
}

function isConfigured() {
  const parts = getConfiguredParts();
  return parts.accessToken && parts.phoneNumberId;
}

// Troca de código do Embedded Signup (server-to-server) exige App ID + App
// Secret — credenciais diferentes das usadas para enviar mensagem/gerenciar
// templates. O config_id do Embedded Signup também é obrigatório para o SDK
// JS abrir o fluxo, mas isso é checado à parte (ver isEmbeddedSignupConfigured).
function isCoexistenceExchangeConfigured() {
  const parts = getConfiguredParts();
  return parts.appId && parts.appSecret;
}

function isEmbeddedSignupConfigured() {
  const parts = getConfiguredParts();
  return parts.appId && parts.embeddedSignupConfigId;
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

async function sendButtonMessage({ to, bsuid, recipientId, body, buttons, correlationId, idempotencyKey }) {
  const recipient = resolveRecipient({ to, bsuid, recipientId });
  return postMessage({
    ...recipient,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(body || 'Escolha uma opção:').slice(0, 1024) },
      action: {
        buttons: (buttons || []).slice(0, 3).map((item) => ({
          type: 'reply',
          reply: { id: String(item.id).slice(0, 256), title: String(item.title || item.value).slice(0, 20) }
        }))
      }
    }
  }, { correlationId, idempotencyKey });
}

async function sendListMessage({ to, bsuid, recipientId, body, button, rows, correlationId, idempotencyKey }) {
  const recipient = resolveRecipient({ to, bsuid, recipientId });
  return postMessage({
    ...recipient,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: String(body || 'Escolha uma opção:').slice(0, 1024) },
      action: {
        button: String(button || 'Ver opções').slice(0, 20),
        sections: [{
          title: 'Opções',
          rows: (rows || []).slice(0, 10).map((item) => ({
            id: String(item.id).slice(0, 200),
            title: String(item.title || item.value).slice(0, 24)
          }))
        }]
      }
    }
  }, { correlationId, idempotencyKey });
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

// --- WhatsApp Business App Coexistence (Embedded Signup v4) ---
// Capacidade mínima: trocar o authorization code (válido ~30s) do Embedded
// Signup por confirmação de acesso, e preparar as chamadas de sincronização
// smb_app_data. Nada aqui dispara onboarding real nem sincroniza dados por
// conta própria — precisa ser chamado explicitamente por um fluxo futuro.

async function exchangeEmbeddedSignupCode({ code }) {
  if (!isCoexistenceExchangeConfigured()) {
    const error = new Error('Troca de código do Embedded Signup não configurada (WHATSAPP_APP_ID/WHATSAPP_APP_SECRET ausentes)');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  if (!code) {
    const error = new Error('exchangeEmbeddedSignupCode requer code');
    error.code = 'INVALID_EXCHANGE_PAYLOAD';
    throw error;
  }

  const config = getConfig();
  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code
  });

  const { response, data } = await requestJson(
    `https://graph.facebook.com/${config.apiVersion}/oauth/access_token?${params.toString()}`,
    { method: 'GET' },
    config.timeoutMs
  );

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Falha ao trocar code do Embedded Signup (${response.status})`);
    error.code = data?.error?.code || 'PROVIDER_ERROR';
    error.providerResponse = data;
    throw error;
  }

  // O access_token retornado por essa troca nunca sai desta função — nem em
  // log, nem na resposta ao chamador. Só confirmamos que a troca funcionou.
  return {
    exchanged: true,
    tokenType: data?.token_type || null,
    expiresIn: data?.expires_in ?? null
  };
}

async function requestSmbAppData({ phoneNumberId, syncType }) {
  if (!isConfigured()) {
    const error = new Error('Meta WhatsApp Cloud API não configurada (WHATSAPP_ACCESS_TOKEN ausente)');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  if (!phoneNumberId) {
    const error = new Error('smb_app_data requer phoneNumberId');
    error.code = 'INVALID_SMB_APP_DATA_PAYLOAD';
    throw error;
  }

  const config = getConfig();
  const { response, data } = await requestJson(
    `https://graph.facebook.com/${config.apiVersion}/${phoneNumberId}/smb_app_data`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_type: syncType })
    },
    config.timeoutMs
  );

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Falha smb_app_data (${syncType}) (${response.status})`);
    error.code = data?.error?.code || 'PROVIDER_ERROR';
    error.providerResponse = data;
    throw error;
  }

  return { success: data?.success !== false, syncType, raw: data };
}

// sync_type: "smb_app_state_sync" — sincroniza contatos. Só pode ser chamado
// uma vez por onboarding; falha exige offboarding e reonboarding.
async function syncSmbAppState({ phoneNumberId }) {
  return requestSmbAppData({ phoneNumberId, syncType: 'smb_app_state_sync' });
}

// sync_type: "history" — sincroniza histórico de mensagens (últimos 180
// dias). Mesma restrição de uma única chamada por onboarding.
async function syncSmbAppHistory({ phoneNumberId }) {
  return requestSmbAppData({ phoneNumberId, syncType: 'history' });
}

async function downloadMedia(mediaId) {
  if (!isConfigured()) {
    const error = new Error('Meta WhatsApp Cloud API não configurada (WHATSAPP_ACCESS_TOKEN ausente)');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  const id = String(mediaId || '').trim();
  if (!id) {
    const error = new Error('downloadMedia requer mediaId');
    error.code = 'META_MEDIA_ID_REQUIRED';
    throw error;
  }

  const config = getConfig();
  const { response, data } = await requestJson(
    `https://graph.facebook.com/${config.apiVersion}/${id}`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
    config.timeoutMs
  );
  if (!response.ok || !data?.url) {
    const error = new Error(data?.error?.message || `Falha ao obter URL da mídia Meta (${response.status})`);
    error.code = data?.error?.code || 'META_MEDIA_LOOKUP_FAILED';
    throw error;
  }

  const fileResponse = await fetch(data.url, {
    headers: { Authorization: `Bearer ${config.accessToken}` }
  });
  if (!fileResponse.ok) {
    const error = new Error(`Falha ao baixar mídia Meta (${fileResponse.status})`);
    error.code = 'META_MEDIA_DOWNLOAD_FAILED';
    throw error;
  }

  return {
    buffer: Buffer.from(await fileResponse.arrayBuffer()),
    mimeType: data.mime_type || fileResponse.headers.get('content-type') || 'application/octet-stream',
    sha256: data.sha256 || null
  };
}

module.exports = {
  getConfig,
  getConfiguredParts,
  isConfigured,
  isTemplatesConfigured,
  isCoexistenceExchangeConfigured,
  isEmbeddedSignupConfigured,
  resolveRecipient,
  listMessageTemplates,
  createMessageTemplate,
  deleteMessageTemplate,
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
  sendDocumentMessage,
  downloadMedia,
  exchangeEmbeddedSignupCode,
  syncSmbAppState,
  syncSmbAppHistory,
  normalizeResponse
};
