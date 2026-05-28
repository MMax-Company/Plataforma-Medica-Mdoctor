const twilio = require('twilio');
const evolutionProvider = require('../services/providers/evolution.provider');

const CHANNEL_LABELS = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'e-mail'
};
const sandboxStore = {
  recentByNumber: new Map(),
  recentGlobal: []
};

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function canUseDevelopmentMock() {
  if (!isProduction()) return process.env.DELIVERY_MOCK_ENABLED !== 'false';
  return process.env.ALLOW_PRODUCTION_DELIVERY_MOCK === 'true' && process.env.DELIVERY_MOCK_ENABLED === 'true';
}

function isSandboxMode() {
  return String(process.env.WHATSAPP_SANDBOX_MODE || 'false') === 'true';
}

function isDryRunMode() {
  return String(process.env.WHATSAPP_DRY_RUN || 'false') === 'true';
}

function maskTarget(target = '') {
  const value = String(target);
  if (value.includes('@')) {
    const [name, domain] = value.split('@');
    return `${name.slice(0, 2)}***@${domain || '***'}`;
  }
  return value.replace(/\d(?=\d{4})/g, '*');
}

function normalizePhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
}

function buildMessage({ pacienteNome, receiptUrl, channel }) {
  const greeting = pacienteNome ? `Olá, ${pacienteNome}.` : 'Olá.';
  return `${greeting} Sua receita Doctor Prescreve foi validada pelo médico e está disponível neste link: ${receiptUrl}`;
}

function resolveWhatsAppProvider() {
  const configured = String(process.env.WHATSAPP_PROVIDER || 'mock').trim().toLowerCase();
  if (configured === 'evolution') return 'evolution';
  return 'mock';
}

function antiSpamConfig() {
  return {
    maxPerWindow: Number(process.env.WHATSAPP_SANDBOX_RATE_LIMIT_MAX || 10),
    windowMs: Number(process.env.WHATSAPP_SANDBOX_RATE_LIMIT_WINDOW_MS || 60000),
    minIntervalMs: Number(process.env.WHATSAPP_SANDBOX_MIN_INTERVAL_MS || 15000)
  };
}

function trimRecent(now, cfg) {
  sandboxStore.recentGlobal = sandboxStore.recentGlobal.filter((item) => now - item.at < cfg.windowMs);
  for (const [key, list] of sandboxStore.recentByNumber.entries()) {
    const filtered = list.filter((at) => now - at < cfg.windowMs);
    if (filtered.length === 0) {
      sandboxStore.recentByNumber.delete(key);
    } else {
      sandboxStore.recentByNumber.set(key, filtered);
    }
  }
}

function enforceAntiSpam(target, cfg) {
  const now = Date.now();
  const normalized = normalizePhone(target);
  trimRecent(now, cfg);
  const currentList = sandboxStore.recentByNumber.get(normalized) || [];
  const globalCount = sandboxStore.recentGlobal.length;

  if (globalCount >= cfg.maxPerWindow) {
    const error = new Error('Limite global de sandbox atingido para janela atual');
    error.code = 'SANDBOX_RATE_LIMIT';
    throw error;
  }

  const lastByNumber = currentList[currentList.length - 1];
  if (lastByNumber && now - lastByNumber < cfg.minIntervalMs) {
    const error = new Error('Intervalo mínimo por número ainda não atingido');
    error.code = 'SANDBOX_MIN_INTERVAL';
    throw error;
  }

  currentList.push(now);
  sandboxStore.recentByNumber.set(normalized, currentList);
  sandboxStore.recentGlobal.push({ at: now, target: normalized });
}

async function getWhatsAppProviderStatus() {
  const selected = resolveWhatsAppProvider();
  const evolutionConfigured = evolutionProvider.isConfigured();
  let evolutionHealth = null;
  const sandbox = isSandboxMode();
  const dryRun = isDryRunMode();
  const antiSpam = antiSpamConfig();

  if (selected === 'evolution' || evolutionConfigured) {
    try {
      evolutionHealth = await evolutionProvider.healthCheck();
    } catch (error) {
      evolutionHealth = {
        ok: false,
        configured: evolutionConfigured,
        provider: 'evolution',
        message: error.message
      };
    }
  }

  const fallbackActive = selected === 'mock' || !evolutionConfigured || canUseDevelopmentMock();
  const mockMode = fallbackActive || dryRun || sandbox;

  return {
    provider: selected,
    mode: mockMode ? 'mock' : 'real',
    deliveryMockEnabled: canUseDevelopmentMock(),
    sandboxMode: sandbox,
    dryRun,
    fallbackActive,
    antiSpam: {
      ...antiSpam,
      trackedNumbers: sandboxStore.recentByNumber.size,
      trackedEvents: sandboxStore.recentGlobal.length
    },
    evolution: {
      configured: evolutionConfigured,
      configuredParts: evolutionProvider.getConfiguredParts(),
      runtime: evolutionProvider.getRuntimeState(),
      safeReadEndpoints: evolutionProvider.SAFE_READ_ENDPOINTS,
      ...(evolutionHealth || {})
    }
  };
}

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

async function sendViaTwilio({ channel, target, message }) {
  const client = getTwilioClient();
  if (!client) return null;

  const from =
    channel === 'whatsapp'
      ? process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_WHATSAPP
      : process.env.TWILIO_SMS_FROM || process.env.TWILIO_PHONE_NUMBER;

  if (!from) return null;

  const to = channel === 'whatsapp' ? `whatsapp:${normalizePhone(target)}` : normalizePhone(target);
  const formattedFrom = channel === 'whatsapp' && !from.startsWith('whatsapp:') ? `whatsapp:${from}` : from;
  const result = await client.messages.create({ from: formattedFrom, to, body: message });

  return {
    provider: 'twilio',
    providerMessageId: result.sid,
    providerStatus: result.status
  };
}

async function sendViaResend({ target, message, receiptUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM;
  if (!apiKey || !from) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.DELIVERY_TIMEOUT_MS || 12000));

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [target],
      subject: 'Sua receita Doctor Prescreve está pronta',
      html: `<p>${message}</p><p><a href="${receiptUrl}">Abrir receita</a></p>`
    })
  }).finally(() => clearTimeout(timeout));

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'Falha no envio por e-mail');
    error.code = 'PROVIDER_ERROR';
    error.providerResponse = data;
    throw error;
  }

  return {
    provider: 'resend',
    providerMessageId: data.id || null,
    providerStatus: 'sent'
  };
}

async function sendPrescription({ channel, target, receiptUrl, pacienteNome, correlationId, idempotencyKey, manualTrigger = false }) {
  const message = buildMessage({ pacienteNome, receiptUrl, channel });
  let providerResult = null;
  const provider = resolveWhatsAppProvider();
  const sandbox = isSandboxMode();
  const dryRun = isDryRunMode();
  const antiSpam = antiSpamConfig();

  if (channel === 'whatsapp') {
    enforceAntiSpam(target, antiSpam);
  }

  if (channel === 'whatsapp' && dryRun) {
    providerResult = {
      provider: 'dry-run',
      providerMessageId: `dry-run-${Date.now()}`,
      providerStatus: 'simulated',
      warning: 'WHATSAPP_DRY_RUN ativo: envio apenas simulado',
      simulatedPayload: {
        provider,
        targetMasked: maskTarget(target),
        receiptUrl,
        correlationId
      }
    };
  }

  if (!providerResult && channel === 'whatsapp') {
    if (sandbox && provider === 'evolution' && !manualTrigger) {
      if (canUseDevelopmentMock()) {
        providerResult = {
          provider: 'mock-fallback',
          providerMessageId: `sandbox-fallback-${Date.now()}`,
          providerStatus: 'sent',
          warning: 'WHATSAPP_SANDBOX_MODE ativo: envio automático bloqueado, fallback mock aplicado'
        };
      } else {
        const error = new Error('Sandbox ativo: envio Evolution requer chamada manual explícita');
        error.code = 'SANDBOX_MANUAL_REQUIRED';
        throw error;
      }
    }
  }

  if (!providerResult && channel === 'whatsapp') {
    if (provider === 'evolution') {
      try {
        providerResult = await evolutionProvider.sendTextMessage({
          to: target,
          text: message,
          correlationId,
          idempotencyKey
        });
      } catch (error) {
        if (!canUseDevelopmentMock()) {
          throw error;
        }
        providerResult = {
          provider: 'mock-fallback',
          providerMessageId: `mock-fallback-${Date.now()}`,
          providerStatus: 'sent',
          warning: `Evolution indisponível (${error.code || 'PROVIDER_ERROR'}): fallback mock aplicado`
        };
      }
    }
  }

  if (!providerResult && (channel === 'whatsapp' || channel === 'sms')) {
    providerResult = await sendViaTwilio({ channel, target, message });
  }

  if (channel === 'email') {
    providerResult = await sendViaResend({ target, message, receiptUrl });
  }

  if (!providerResult && canUseDevelopmentMock()) {
    providerResult = {
      provider: 'development-mock',
      providerMessageId: `mock-${Date.now()}`,
      providerStatus: 'sent'
    };
  }

  if (!providerResult) {
    const error = new Error(`Provider real de ${CHANNEL_LABELS[channel] || channel} não configurado`);
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  return {
    id: `delivery-${Date.now()}`,
    channel,
    target,
    targetMasked: maskTarget(target),
    receiptUrl,
    status: 'sent',
    sent_at: new Date().toISOString(),
    ...providerResult
  };
}

module.exports = {
  CHANNEL_LABELS,
  maskTarget,
  sendPrescription,
  getWhatsAppProviderStatus,
  resolveWhatsAppProvider,
  isSandboxMode,
  isDryRunMode
};
