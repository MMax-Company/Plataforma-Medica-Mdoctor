// Alertas internos passivos para o administrador, via WhatsApp (Meta Cloud
// API) e Telegram (Plano B temporário, enquanto os templates da Meta estão
// em análise). Ramificação paralela de eventos que já acontecem no fluxo
// principal — nunca deve bloquear, atrasar ou alterar esse fluxo. Não cria
// ticket, sessão Typebot ou estado novo; só envia mensagens de saída. Os
// dois canais são independentes: falha de um nunca afeta o outro, e falha
// de qualquer um deles é só logada (logger.warn), nunca propagada.

const logger = require('../config/logger');
const metaProvider = require('./providers/meta.provider');
const telegramProvider = require('./providers/telegram.provider');

const ALERT_TEXTS = {
  medical_queue: (shortId) =>
    `🔴 *ALERTA MÉDICO*\nNovo paciente aguardando atendimento médico.\nAtendimento #${shortId}`,
  support_queue: (shortId) =>
    `🔵 *ALERTA SUPORTE*\nNovo chamado aguardando atendimento no suporte.\nTicket #${shortId}`,
  medical_support_queue: (shortId) =>
    `🟢 *ALERTA SUPORTE MÉDICO*\nNovo atendimento aguardando avaliação do suporte médico.\nAtendimento #${shortId}`
};

// Telegram não usa o parse_mode Markdown do WhatsApp — texto plano, sem "*".
const TELEGRAM_ALERT_TEXTS = {
  medical_queue: (shortId) =>
    `🔴 ALERTA MÉDICO\nNovo paciente aguardando atendimento médico.\nAtendimento #${shortId}`,
  support_queue: (shortId) =>
    `🔵 ALERTA SUPORTE\nNovo chamado aguardando atendimento no suporte.\nTicket #${shortId}`,
  medical_support_queue: (shortId) =>
    `🟢 ALERTA SUPORTE MÉDICO\nNovo atendimento aguardando avaliação do suporte médico.\nAtendimento #${shortId}`
};

function shortIdFrom(id) {
  return String(id || '').replace(/-/g, '').slice(-6).toUpperCase() || '------';
}

function getAdminAlertPhone() {
  return String(process.env.ADMIN_ALERT_PHONE || '').trim();
}

async function sendWhatsAppAlert(type, shortId) {
  try {
    const phone = getAdminAlertPhone();
    if (!phone) return;

    const buildText = ALERT_TEXTS[type];
    if (!buildText) return;

    await metaProvider.sendTextMessage({ to: phone, text: buildText(shortId) });
  } catch (error) {
    logger.warn('admin_alert_send_failed', { channel: 'whatsapp', type, error });
  }
}

async function sendTelegramAlert(type, shortId) {
  try {
    if (!telegramProvider.isConfigured()) return;

    const buildText = TELEGRAM_ALERT_TEXTS[type];
    if (!buildText) return;

    await telegramProvider.sendTextMessage({ text: buildText(shortId) });
  } catch (error) {
    logger.warn('admin_alert_send_failed', { channel: 'telegram', type, error });
  }
}

async function notifyAdminAlert({ type, id }) {
  const shortId = shortIdFrom(id);
  // Diagnóstico: qual canal está configurado (sem expor segredo). Permite
  // conferir pelos logs se ADMIN_ALERT_PHONE / TELEGRAM_* estão presentes.
  logger.info('admin_alert_dispatch', {
    type,
    shortId,
    whatsappConfigured: Boolean(getAdminAlertPhone()),
    telegramConfigured: telegramProvider.isConfigured()
  });
  // Disparados em paralelo e isolados — nenhum dos dois pode esperar ou
  // derrubar o outro, e nenhum dos dois pode propagar erro ao chamador.
  await Promise.all([sendWhatsAppAlert(type, shortId), sendTelegramAlert(type, shortId)]);
}

module.exports = { notifyAdminAlert };
