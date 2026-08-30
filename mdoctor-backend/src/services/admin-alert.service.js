// Alertas internos passivos para o administrador, via WhatsApp (Meta Cloud
// API) e Telegram. Ramificação paralela de eventos que já acontecem no fluxo
// principal — nunca deve bloquear, atrasar ou alterar esse fluxo. Não cria
// ticket, sessão Typebot ou estado novo; só envia mensagens de saída. Os
// dois canais são independentes: falha de um nunca afeta o outro, e falha
// de qualquer um deles é só logada (logger.warn), nunca propagada.
//
// WhatsApp: canal PRIMÁRIO é o template Utility aprovado (ALERT_TEMPLATES) —
// entrega TAMBÉM fora da janela de atendimento de 24h (evita o Meta 131047
// "Re-engagement message"). Se o template falhar (ex.: PAUSED por queda de
// qualidade), cai no texto livre (ALERT_TEXTS), que só entrega DENTRO da
// janela de 24h.

const logger = require('../config/logger');
const metaProvider = require('./providers/meta.provider');
const telegramProvider = require('./providers/telegram.provider');

// Templates Utility aprovados na WABA de produção (pt_BR, 1 variável {{1}} =
// shortId). Corpo aprovado, p.ex. medical_queue:
//   "🔴 ALERTA MÉDICO\nNovo paciente aguardando atendimento médico.\nAtendimento #{{1}} registrado."
const ALERT_TEMPLATES = {
  medical_queue: 'doctor_admin_alerta_fila_medica_v1',
  support_queue: 'doctor_admin_alerta_suporte_v1',
  medical_support_queue: 'doctor_admin_alerta_suporte_medico_v1'
};

// Fallback (só entrega dentro da janela de 24h).
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

// true quando pelo menos um canal (WhatsApp texto livre ou Telegram) tem
// configuração para tentar o envio.
function adminAlertChannelsConfigured() {
  return Boolean(getAdminAlertPhone()) || telegramProvider.isConfigured();
}

// Retorna 'sent' | 'skipped' | 'failed' — nunca lança.
// Primário: template Utility (entrega fora da janela de 24h). Fallback:
// texto livre (só dentro da janela) se o template falhar.
async function sendWhatsAppAlert(type, shortId) {
  const phone = getAdminAlertPhone();
  if (!phone) return 'skipped';
  const templateName = ALERT_TEMPLATES[type];
  const buildText = ALERT_TEXTS[type];
  if (!templateName && !buildText) return 'skipped';

  if (templateName) {
    try {
      await metaProvider.sendTemplateMessage({
        to: phone,
        name: templateName,
        languageCode: 'pt_BR',
        bodyParameters: [shortId]
      });
      return 'sent';
    } catch (error) {
      logger.warn('admin_alert_send_failed', { channel: 'whatsapp', mode: 'template', type, error });
    }
  }

  if (!buildText) return 'failed';
  try {
    await metaProvider.sendTextMessage({ to: phone, text: buildText(shortId) });
    return 'sent';
  } catch (error) {
    logger.warn('admin_alert_send_failed', { channel: 'whatsapp', mode: 'text', type, error });
    return 'failed';
  }
}

async function sendTelegramAlert(type, shortId) {
  if (!telegramProvider.isConfigured()) return 'skipped';
  const buildText = TELEGRAM_ALERT_TEXTS[type];
  if (!buildText) return 'skipped';
  try {
    await telegramProvider.sendTextMessage({ text: buildText(shortId) });
    return 'sent';
  } catch (error) {
    logger.warn('admin_alert_send_failed', { channel: 'telegram', type, error });
    return 'failed';
  }
}

async function notifyAdminAlert({ type, id }) {
  const shortId = shortIdFrom(id);
  // Disparados em paralelo e isolados — nenhum dos dois pode esperar ou
  // derrubar o outro, e nenhum dos dois pode propagar erro ao chamador.
  const [whatsapp, telegram] = await Promise.all([
    sendWhatsAppAlert(type, shortId),
    sendTelegramAlert(type, shortId)
  ]);
  // Diagnóstico (sem expor segredo): canal configurado + resultado do envio.
  logger.info('admin_alert_dispatch', {
    type,
    shortId,
    whatsappConfigured: Boolean(getAdminAlertPhone()),
    telegramConfigured: telegramProvider.isConfigured(),
    whatsapp,
    telegram
  });
  return { whatsapp, telegram, delivered: whatsapp === 'sent' || telegram === 'sent' };
}

module.exports = { notifyAdminAlert, adminAlertChannelsConfigured };
