const axios = require('axios');

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3004').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.BACKEND_TIMEOUT_MS || 10000);

const client = axios.create({
  baseURL: BACKEND_URL,
  timeout: TIMEOUT_MS,
  validateStatus: () => true,
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'mdoctor-automation/1.0'
  }
});

function normalizeWhatsAppPayload(body = {}) {
  const from =
    body.from ||
    body.From ||
    body.phone ||
    body.sender ||
    body.remoteJid ||
    body?.message?.from ||
    body?.body?.from;

  const text =
    body.text ||
    body.Body ||
    body.message ||
    body.content ||
    body?.message?.text ||
    body?.body?.text ||
    '';

  return {
    from: typeof from === 'string' ? from.trim() : from,
    text: typeof text === 'string' ? text.trim() : text,
    rawMessage: body.rawMessage || body
  };
}

async function postBackend(path, payload, requestId) {
  const response = await client.post(path, payload, {
    headers: requestId ? { 'X-Request-Id': requestId } : undefined
  });

  if (response.status >= 500) {
    const error = new Error(`Backend retornou ${response.status}`);
    error.statusCode = 502;
    error.responseData = response.data;
    throw error;
  }

  return {
    status: response.status,
    data: response.data
  };
}

async function forwardWhatsAppWebhook(payload, requestId) {
  return postBackend('/api/whatsapp/webhook', payload, requestId);
}

async function forwardDecisionEvent(event, requestId) {
  if (!process.env.DECISION_WEBHOOK_FORWARD_URL) {
    return {
      status: 202,
      forwarded: false,
      data: {
        success: true,
        accepted: true,
        forwarded: false,
        message: 'Evento registrado pelo automation. Nenhum destino externo configurado.',
        requestId
      }
    };
  }

  const response = await axios.post(process.env.DECISION_WEBHOOK_FORWARD_URL, event, {
    timeout: TIMEOUT_MS,
    validateStatus: () => true,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId
    }
  });

  return {
    status: response.status >= 500 ? 502 : response.status,
    forwarded: response.status < 500,
    data: {
      success: response.status < 400,
      forwarded: true,
      targetStatus: response.status,
      targetData: response.data,
      requestId
    }
  };
}

async function checkBackendHealth() {
  try {
    const response = await client.get('/health', { timeout: Number(process.env.HEALTH_TIMEOUT_MS || 4000) });
    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      url: BACKEND_URL,
      data: response.data
    };
  } catch (error) {
    return {
      ok: false,
      url: BACKEND_URL,
      error: error.message
    };
  }
}

module.exports = {
  BACKEND_URL,
  checkBackendHealth,
  forwardDecisionEvent,
  forwardWhatsAppWebhook,
  normalizeWhatsAppPayload,
  postBackend
};
