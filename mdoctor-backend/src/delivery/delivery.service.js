const twilio = require('twilio');

const CHANNEL_LABELS = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'e-mail'
};

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function canUseDevelopmentMock() {
  if (!isProduction()) return process.env.DELIVERY_MOCK_ENABLED !== 'false';
  return process.env.ALLOW_PRODUCTION_DELIVERY_MOCK === 'true' && process.env.DELIVERY_MOCK_ENABLED === 'true';
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

async function sendPrescription({ channel, target, receiptUrl, pacienteNome }) {
  const message = buildMessage({ pacienteNome, receiptUrl, channel });
  let providerResult = null;

  if (channel === 'whatsapp' || channel === 'sms') {
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
  sendPrescription
};
