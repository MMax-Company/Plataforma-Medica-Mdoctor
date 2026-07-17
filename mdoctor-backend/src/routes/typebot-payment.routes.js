const express = require('express');
const path = require('path');
const logger = require('../config/logger');
const {
  completePaymentByToken,
  getPaymentConfigByToken
} = require('../services/typebot-payment-link.service');

const router = express.Router();

// CSP restrito desta página: precisa do Stripe.js (js.stripe.com) e das
// chamadas do Payment Element (api.stripe.com / hooks.stripe.com). O CSP
// global do helmet() (script-src 'self') bloquearia tudo silenciosamente —
// mesmo padrão já usado na página de coexistência WhatsApp.
const PAYMENT_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com",
  "connect-src 'self' https://api.stripe.com",
  'frame-src https://js.stripe.com https://hooks.stripe.com',
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

router.get('/page.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, '..', 'views', 'typebot-payment.js'));
});

router.get('/:token/config', async (req, res) => {
  try {
    const config = await getPaymentConfigByToken(req.params.token);
    if (!config.found) return res.status(404).json({ success: false, error: 'Link de pagamento não encontrado' });
    if (config.expired) return res.status(410).json({ success: false, error: 'Link de pagamento expirado' });
    return res.json({
      success: true,
      status: config.status,
      amountLabel: config.amountLabel,
      publicKey: config.publicKey,
      clientSecret: config.clientSecret
    });
  } catch (error) {
    logger.error('typebot_payment_config_failed', { error: error.message });
    return res.status(500).json({ success: false, error: 'Erro ao carregar pagamento' });
  }
});

router.post('/:token/complete', async (req, res) => {
  try {
    const result = await completePaymentByToken(req.params.token);
    if (!result.ok) {
      const statusByCode = { NOT_FOUND: 404, EXPIRED: 410, NOT_PAID: 409 };
      return res.status(statusByCode[result.code] || 400).json({ success: false, code: result.code });
    }
    logger.info('typebot_payment_completed', {
      alreadyCompleted: Boolean(result.alreadyCompleted),
      responsesSent: result.responsesSent ?? 0
    });
    return res.json({ success: true, alreadyCompleted: Boolean(result.alreadyCompleted) });
  } catch (error) {
    logger.error('typebot_payment_complete_failed', { error: error.message });
    return res.status(500).json({ success: false, error: 'Erro ao confirmar pagamento' });
  }
});

router.get('/:token', (_req, res) => {
  res.setHeader('Content-Security-Policy', PAYMENT_PAGE_CSP);
  res.sendFile(path.join(__dirname, '..', 'views', 'typebot-payment.html'));
});

module.exports = router;
