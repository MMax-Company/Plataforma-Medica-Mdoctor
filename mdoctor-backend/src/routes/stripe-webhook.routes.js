const express = require('express');
const logger = require('../config/logger');
const { handleStripeWebhookEvent } = require('../services/stripe-webhook.service');

const router = express.Router();

function getStripe() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) return null;
  // eslint-disable-next-line global-require
  return require('stripe')(secretKey);
}

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  const signature = req.get('stripe-signature');

  if (!webhookSecret) {
    return res.status(503).json({ success: false, error: 'STRIPE_WEBHOOK_SECRET não configurado' });
  }

  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ success: false, error: 'STRIPE_SECRET_KEY não configurado' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    logger.warn('stripe_webhook_signature_invalid', { error: error.message });
    return res.status(400).json({ success: false, error: 'Assinatura Stripe inválida' });
  }

  try {
    const result = await handleStripeWebhookEvent(event);
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('stripe_webhook_error', { error: error.message, type: event?.type });
    return res.status(500).json({ success: false, error: 'Erro ao processar webhook Stripe' });
  }
});

module.exports = router;
