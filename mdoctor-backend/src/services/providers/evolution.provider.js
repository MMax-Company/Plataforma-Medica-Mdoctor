const DEFAULT_TIMEOUT_MS = 12000;

const SAFE_READ_ENDPOINTS = [
  'GET /',
  'GET /instance/fetchInstances',
  'GET /instance/connectionState/{instanceName}'
];

const providerRuntime = {
  lastError: null,
  lastTimeoutAt: null,
  lastHealthState: 'unknown',
  lastHealthAt: null
};

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

function getConfiguredParts(config = getConfig()) {
  return {
    url: Boolean(config.baseUrl),
    apiKey: Boolean(config.apiKey),
    instance: Boolean(config.instance)
  };
}

function isConfigured() {
  const parts = getConfiguredParts();
  return parts.url && parts.apiKey && parts.instance;
}

function authHeaders(apiKey) {
  return {
    apikey: apiKey
  };
}

function normalizeInstancesList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.instances)) return data.instances;
  if (Array.isArray(data?.data)) return data.data;
  if (data?.instance) return [data];
  return [];
}

function extractInstanceRecord(item = {}) {
  const instance = item?.instance || item;
  const instanceName =
    instance?.instanceName ||
    instance?.name ||
    item?.instanceName ||
    item?.name ||
    null;

  const state =
    instance?.state ||
    instance?.status ||
    instance?.connectionStatus?.state ||
    instance?.connectionStatus ||
    item?.state ||
    item?.status ||
    'unknown';

  return {
    instanceName,
    state: String(state || 'unknown').toLowerCase()
  };
}

function findInstanceRecord(list = [], instanceName = '') {
  if (!instanceName) return null;
  return list.find((item) => extractInstanceRecord(item).instanceName === instanceName) || null;
}

function normalizeConnectionState(rawState = 'unknown') {
  const state = String(rawState || 'unknown').toLowerCase();

  return {
    instanceState: state,
    connected: state === 'open' || state.includes('connected'),
    disconnected: state === 'close' || state.includes('close') || state.includes('disconnected'),
    connecting: state === 'connecting' || state.includes('connecting')
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
    return { response, data: parsed, timeout: false };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      providerRuntime.lastTimeoutAt = new Date().toISOString();
      const timeoutError = new Error('Timeout na chamada Evolution API');
      timeoutError.code = 'PROVIDER_TIMEOUT';
      throw timeoutError;
    }
    throw error;
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

async function probeApiInfo(config) {
  if (!config.baseUrl) {
    return {
      apiReachable: false,
      skipped: true,
      reason: 'missing_base_url'
    };
  }

  try {
    const { response, data } = await requestJson(
      `${config.baseUrl}/`,
      { method: 'GET' },
      config.timeoutMs
    );

    return {
      apiReachable: response.ok,
      httpStatus: response.status,
      apiVersion: data?.version || null,
      managerUrl: data?.manager || null,
      swaggerUrl: data?.documentation || `${config.baseUrl}/docs`,
      message: data?.message || null,
      timeout: false
    };
  } catch (error) {
    return {
      apiReachable: false,
      timeout: error.code === 'PROVIDER_TIMEOUT',
      message: error.message,
      code: error.code || 'PROVIDER_ERROR'
    };
  }
}

async function probeFetchInstances(config) {
  if (!config.baseUrl || !config.apiKey) {
    return {
      skipped: true,
      reason: !config.baseUrl ? 'missing_base_url' : 'missing_api_key'
    };
  }

  try {
    const { response, data } = await requestJson(
      `${config.baseUrl}/instance/fetchInstances`,
      {
        method: 'GET',
        headers: authHeaders(config.apiKey)
      },
      config.timeoutMs
    );

    const instances = normalizeInstancesList(data);
    const matched = findInstanceRecord(instances, config.instance);
    const matchedRecord = matched ? extractInstanceRecord(matched) : null;

    return {
      ok: response.ok,
      httpStatus: response.status,
      instancesCount: instances.length,
      instanceFound: Boolean(matched),
      instanceName: config.instance || null,
      instanceState: matchedRecord?.state || null,
      timeout: false
    };
  } catch (error) {
    return {
      ok: false,
      timeout: error.code === 'PROVIDER_TIMEOUT',
      message: error.message,
      code: error.code || 'PROVIDER_ERROR'
    };
  }
}

async function probeConnectionState(config) {
  if (!config.baseUrl || !config.apiKey || !config.instance) {
    return {
      skipped: true,
      reason: 'missing_url_api_key_or_instance'
    };
  }

  try {
    const { response, data } = await requestJson(
      `${config.baseUrl}/instance/connectionState/${encodeURIComponent(config.instance)}`,
      {
        method: 'GET',
        headers: authHeaders(config.apiKey)
      },
      config.timeoutMs
    );

    const rawState =
      data?.instance?.state ||
      data?.state ||
      data?.status ||
      'unknown';

    const normalized = normalizeConnectionState(rawState);
    providerRuntime.lastHealthState = normalized.instanceState;
    providerRuntime.lastHealthAt = new Date().toISOString();

    return {
      ok: response.ok,
      httpStatus: response.status,
      instanceName: config.instance,
      ...normalized,
      timeout: false
    };
  } catch (error) {
    return {
      ok: false,
      timeout: error.code === 'PROVIDER_TIMEOUT',
      message: error.message,
      code: error.code || 'PROVIDER_ERROR',
      instanceName: config.instance,
      instanceState: providerRuntime.lastHealthState || 'unknown',
      connected: false,
      disconnected: true,
      connecting: false
    };
  }
}

async function healthCheck() {
  const config = getConfig();
  const configuredParts = getConfiguredParts(config);
  const configured = configuredParts.url && configuredParts.apiKey && configuredParts.instance;

  if (!configuredParts.url) {
    return {
      ok: false,
      configured: false,
      configuredParts,
      provider: 'evolution',
      instanceName: config.instance || null,
      apiReachable: false,
      message: 'Evolution API não configurada (EVOLUTION_API_URL ausente)',
      safeReadEndpoints: SAFE_READ_ENDPOINTS
    };
  }

  const apiInfo = await probeApiInfo(config);
  const fetchInstances = configuredParts.apiKey ? await probeFetchInstances(config) : { skipped: true, reason: 'missing_api_key' };
  const connectionState = configured ? await probeConnectionState(config) : { skipped: true, reason: 'missing_instance_or_api_key' };

  const stateFromConnection = connectionState.instanceState || fetchInstances.instanceState || providerRuntime.lastHealthState;
  const normalized = normalizeConnectionState(stateFromConnection);

  providerRuntime.lastHealthState = normalized.instanceState;
  providerRuntime.lastHealthAt = new Date().toISOString();

  const timeout = Boolean(apiInfo.timeout || fetchInstances.timeout || connectionState.timeout);
  const apiReachable = Boolean(apiInfo.apiReachable);
  const instanceFound = configuredParts.instance ? Boolean(fetchInstances.instanceFound) : false;
  const ok =
    configured &&
    apiReachable &&
    (connectionState.skipped || connectionState.ok !== false) &&
    !timeout;

  if (!ok && !providerRuntime.lastError) {
    providerRuntime.lastError = {
      message:
        connectionState.message ||
        fetchInstances.message ||
        apiInfo.message ||
        'Evolution API indisponível ou parcialmente configurada',
      code: connectionState.code || fetchInstances.code || apiInfo.code || 'PROVIDER_UNAVAILABLE',
      at: new Date().toISOString()
    };
  }

  if (ok) {
    providerRuntime.lastError = null;
  }

  return {
    ok,
    configured,
    configuredParts,
    provider: 'evolution',
    instanceName: config.instance || null,
    apiReachable,
    apiVersion: apiInfo.apiVersion || null,
    swaggerUrl: apiInfo.swaggerUrl || null,
    managerUrl: apiInfo.managerUrl || null,
    instanceFound,
    instanceState: normalized.instanceState,
    connected: normalized.connected,
    disconnected: normalized.disconnected,
    connecting: normalized.connecting,
    state: normalized.instanceState,
    timeout,
    lastError: providerRuntime.lastError,
    lastTimeoutAt: providerRuntime.lastTimeoutAt,
    safeReadEndpoints: SAFE_READ_ENDPOINTS,
    probes: {
      apiInfo,
      fetchInstances,
      connectionState
    }
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

  try {
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

    providerRuntime.lastError = null;
    return normalizeResponse(data, { httpStatus: response.status });
  } catch (error) {
    providerRuntime.lastError = {
      message: error.message,
      code: error.code || 'PROVIDER_ERROR',
      at: new Date().toISOString()
    };
    throw error;
  }
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

  try {
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

    providerRuntime.lastError = null;
    return normalizeResponse(data, { httpStatus: response.status });
  } catch (error) {
    providerRuntime.lastError = {
      message: error.message,
      code: error.code || 'PROVIDER_ERROR',
      at: new Date().toISOString()
    };
    throw error;
  }
}

function getRuntimeState() {
  return {
    ...providerRuntime
  };
}

module.exports = {
  getConfig,
  getConfiguredParts,
  isConfigured,
  sendTextMessage,
  sendDocumentMessage,
  healthCheck,
  probeApiInfo,
  probeFetchInstances,
  probeConnectionState,
  normalizeResponse,
  normalizeConnectionState,
  getRuntimeState,
  SAFE_READ_ENDPOINTS
};
