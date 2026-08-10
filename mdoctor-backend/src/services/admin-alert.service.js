// Alertas internos passivos para o celular do administrador via WhatsApp
// (Meta Cloud API). Ramificação paralela de eventos que já acontecem no
// fluxo principal — nunca deve bloquear, atrasar ou alterar esse fluxo.
// Não cria ticket, sessão Typebot ou estado novo; só envia uma mensagem de
// saída para ADMIN_ALERT_PHONE. Erros aqui são sempre engolidos e apenas
// logados (logger.warn) — nunca propagados para o chamador.

const logger = require('../config/logger');
const metaProvider = require('./providers/meta.provider');

const ALERT_TEXTS = {
  medical_queue: (shortId) =>
    `🔴 *ALERTA MÉDICO*\nNovo paciente aguardando atendimento médico.\nAtendimento #${shortId}`,
  support_queue: (shortId) =>
    `🔵 *ALERTA SUPORTE*\nNovo chamado aguardando atendimento no suporte.\nTicket #${shortId}`,
  medical_support_queue: (shortId) =>
    `🟢 *ALERTA SUPORTE MÉDICO*\nNovo atendimento aguardando avaliação do suporte médico.\nAtendimento #${shortId}`
};

function shortIdFrom(id) {
  return String(id || '').replace(/-/g, '').slice(-6).toUpperCase() || '------';
}

function getAdminAlertPhone() {
  return String(process.env.ADMIN_ALERT_PHONE || '').trim();
}

async function notifyAdminAlert({ type, id }) {
  try {
    const phone = getAdminAlertPhone();
    if (!phone) return;

    const buildText = ALERT_TEXTS[type];
    if (!buildText) return;

    const text = buildText(shortIdFrom(id));
    await metaProvider.sendTextMessage({ to: phone, text });
  } catch (error) {
    logger.warn('admin_alert_send_failed', { type, id, error });
  }
}

module.exports = { notifyAdminAlert };
