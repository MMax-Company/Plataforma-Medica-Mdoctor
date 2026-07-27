const express = require('express');
const path = require('path');
const logger = require('../config/logger');
const {
  completePaymentByToken,
  getPaymentConfigByToken,
  refreshPaymentStatus,
  resolveCheckoutRedirect
} = require('../services/typebot-payment-link.service');

const router = express.Router();

// Checkout Stripe é hospedado (redirect), não Elements embutido — o CSP não
// precisa mais liberar js.stripe.com/api.stripe.com nesta página.
const PAYMENT_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
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

router.get('/:token/status', async (req, res) => {
  try {
    const result = await refreshPaymentStatus(req.params.token);
    if (!result.ok && result.code === 'NOT_FOUND') {
      return res.status(404).json({ success: false, error: 'Link de pagamento não encontrado' });
    }
    if (!result.ok && result.code === 'EXPIRED') {
      return res.status(410).json({ success: false, error: 'Link de pagamento expirado', payment_status: 'failed' });
    }
    return res.json({
      success: true,
      payment_status: result.paymentStatus || 'pending'
    });
  } catch (error) {
    logger.error('typebot_payment_status_failed', { error: error.message });
    return res.status(500).json({ success: false, error: 'Erro ao consultar pagamento' });
  }
});

router.get('/:token/checkout', async (req, res) => {
  try {
    const result = await resolveCheckoutRedirect(req.params.token);
    if (!result.ok) {
      const statusByCode = { NOT_FOUND: 404, EXPIRED: 410, ALREADY_PAID: 409, STRIPE_NOT_CONFIGURED: 503 };
      return res.status(statusByCode[result.code] || 400).json({ success: false, code: result.code });
    }
    return res.redirect(303, result.url);
  } catch (error) {
    logger.error('typebot_payment_checkout_redirect_failed', { error: error.message });
    return res.status(500).json({ success: false, error: 'Erro ao abrir pagamento' });
  }
});

router.get('/:token/config', async (req, res) => {
  try {
    const config = await getPaymentConfigByToken(req.params.token);
    if (!config.found) return res.status(404).json({ success: false, error: 'Link de pagamento não encontrado' });
    if (config.expired) return res.status(410).json({ success: false, error: 'Link de pagamento expirado' });
    return res.json({
      success: true,
      payment_status: config.paymentStatus,
      amountLabel: config.amountLabel
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
      return res.status(statusByCode[result.code] || 400).json({
        success: false,
        code: result.code,
        payment_status: result.paymentStatus || undefined
      });
    }
    logger.info('typebot_payment_completed', {
      alreadyCompleted: Boolean(result.alreadyCompleted),
      responsesSent: result.responsesSent ?? 0
    });
    return res.json({ success: true, alreadyCompleted: Boolean(result.alreadyCompleted), payment_status: 'paid' });
  } catch (error) {
    logger.error('typebot_payment_complete_failed', { error: error.message });
    return res.status(500).json({ success: false, error: 'Erro ao confirmar pagamento' });
  }
});

router.get('/:token', (req, res) => {
  res.setHeader('Content-Security-Policy', PAYMENT_PAGE_CSP);
  res.sendFile(path.join(__dirname, '..', 'views', 'typebot-payment.html'));
});

module.exports = router;
