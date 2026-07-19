const { sendWhatsAppText } = require('../delivery/delivery.service');

const DEFAULT_REJECT_MESSAGE = [
  'Infelizmente, neste momento não foi possível realizar a renovação da sua receita pelo Doctor Prescreve.',
  '',
  'Recomendamos que procure atendimento médico presencial para uma avaliação adequada.',
  '',
  'Caso tenha dúvidas, você pode falar com nosso suporte.',
  '',
  '*1* - Encerrar atendimento',
  '*2* - Falar com o suporte'
].join('\n');

function isDryRun() {
  return String(process.env.WHATSAPP_DRY_RUN || 'false') === 'true';
}

async function notifyClinicalRejection({ atendimentoId, phone, message, correlationId, pacienteNome }) {
  const payload = {
    atendimentoId,
    phone,
    pacienteNome: pacienteNome || null,
    message: message || DEFAULT_REJECT_MESSAGE,
    correlationId: correlationId || `reject-${Date.now()}`,
    dryRun: isDryRun()
  };

  if (!phone) {
    return { sent: false, skipped: true, reason: 'telefone_ausente', payload };
  }

  if (payload.dryRun) {
    return { sent: false, skipped: true, reason: 'dry_run', provider: 'meta', payload };
  }

  try {
    const result = await sendWhatsAppText({
      to: phone,
      text: payload.message,
      correlationId: payload.correlationId,
      idempotencyKey: `clinical-reject-notify:${atendimentoId || payload.correlationId}`
    });
    return {
      sent: true,
      provider: 'meta',
      providerMessageId: result?.providerMessageId || null,
      payload
    };
  } catch (error) {
    return {
      sent: false,
      provider: 'meta',
      error: error.message,
      payload
    };
  }
}

module.exports = {
  DEFAULT_REJECT_MESSAGE,
  notifyClinicalRejection
};
