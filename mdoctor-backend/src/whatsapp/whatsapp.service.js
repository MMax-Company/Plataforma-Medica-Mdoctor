// src/whatsapp/whatsapp.service.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { getSupabase } = require('../config/supabase');
const logger = require('../config/logger');

function backendWebhookUrl() {
  const baseUrl = (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 3004}`
  ).replace(/\/+$/, '');

  return `${baseUrl}/api/whatsapp/webhook`;
}

class WhatsAppService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('whatsapp_auth');
      
      this.socket = makeWASocket({
        auth: state,
        printQRInTerminal: false
      });

      this.socket.ev.on('creds.update', saveCreds);
      
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
          logger.info('whatsapp_qr_received');
          qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
          this.isConnected = false;
          const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
          logger.warn('whatsapp_connection_closed', { shouldReconnect });
          if (shouldReconnect) await this.connect();
        } else if (connection === 'open') {
          this.isConnected = true;
          logger.info('whatsapp_connected');
        }
      });

      this.socket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        logger.info('whatsapp_message_received', { from });
        
        // Enviar para backend processar
        await this.handleMessage(from, text, msg);
      });

    } catch (error) {
      logger.error('whatsapp_connect_error', { error });
    }
  }

  async handleMessage(from, text, rawMessage) {
    try {
      const supabase = getSupabase();
      
      // Salvar mensagem no Supabase
      await supabase.from('whatsapp_messages').insert([{
        phone: from,
        message: text,
        direction: 'inbound',
        created_at: new Date().toISOString()
      }]);

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Number(process.env.WHATSAPP_WEBHOOK_TIMEOUT_MS || 10000)
      );

      const response = await fetch(backendWebhookUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, text, rawMessage }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      const data = await response.json();
      
      // Responder se necessário
      if (data.reply) {
        await this.sendMessage(from, data.reply);
      }
    } catch (error) {
      logger.error('whatsapp_message_process_error', { from, error });
    }
  }

  async sendMessage(to, text) {
    try {
      await this.socket.sendMessage(to, { text });
      logger.info('whatsapp_message_sent', { to });
      
      const supabase = getSupabase();
      await supabase.from('whatsapp_messages').insert([{
        phone: to,
        message: text,
        direction: 'outbound',
        created_at: new Date().toISOString()
      }]);
      
      return { success: true };
    } catch (error) {
      logger.error('whatsapp_send_message_error', { to, error });
      return { success: false, error: error.message };
    }
  }

  async sendPDF(to, pdfBuffer, filename = 'receita.pdf') {
    try {
      await this.socket.sendMessage(to, {
        document: pdfBuffer,
        mimetype: 'application/pdf',
        fileName: filename,
        caption: '📄 Sua receita está pronta!'
      });
      logger.info('whatsapp_pdf_sent', { to, filename });
      return { success: true };
    } catch (error) {
      logger.error('whatsapp_send_pdf_error', { to, filename, error });
      return { success: false, error: error.message };
    }
  }
}

module.exports = new WhatsAppService();
