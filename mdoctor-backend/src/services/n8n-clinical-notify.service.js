const axios = require('axios');

const DEFAULT_REJECT_MESSAGE =
  'Após avaliação médica, não foi possível aprovar sua renovação de receita por teleconsulta. Recomendamos atendimento presencial para melhor avaliação.';

function resolveWebhookUrl() {
  return String(
    process.env.N8N_CLINICAL_REJECT_WEBHOOK_URL ||
      process.env.N8N_WEBHOOK_URL?.replace(/typebot-webhook\/?$/, 'clinical-rejection-notify') ||
      ''
  ).trim();
}

function isDryRun() {
  return String(process.env.WHATSAPP_DRY_RUN || 'false') === 'true';
}

async function notifyClinicalRejection({ atendimentoId, phone, message, correlationId, pacienteNome }) {
  const webhookUrl = resolveWebhookUrl();
  const secret = String(process.env.N8N_WEBHOOK_SECRET || '').trim();
  const payload = {
    atendimentoId,
    phone,
    pacienteNome: pacienteNome || null,
    message: message || DEFAULT_REJECT_MESSAGE,
    correlationId: correlationId || `reject-${Date.now()}`,
    dryRun: isDryRun()
  };

  if (!webhookUrl) {
    return {
      sent: false,
      skipped: true,
      reason: 'N8N_CLINICAL_REJECT_WEBHOOK_URL not configured',
      payload
    };
  }

  try {
    const response = await axios.post(webhookUrl, payload, {
      timeout: Number(process.env.N8N_WEBHOOK_TIMEOUT_MS || 12000),
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Webhook-Secret': secret } : {})
      },
      validateStatus: () => true
    });

    return {
      sent: response.status >= 200 && response.status < 300,
      status: response.status,
      data: response.data,
      payload
    };
  } catch (error) {
    return {
      sent: false,
      error: error.message,
      payload
    };
  }
}

module.exports = {
  DEFAULT_REJECT_MESSAGE,
  notifyClinicalRejection
};
