const express = require('express');
const logger = require('../config/logger');
const { verifyN8nWebhookSecret } = require('../middlewares/n8n-webhook-auth');
const { processTriagemWebhook } = require('../services/triagem-webhook.service');

const router = express.Router();

router.post('/triagem', async (req, res) => {
  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) {
    const correlationId = auth.body?.correlationId || req.correlationId || req.requestId || 'unknown';
    logger.warn('triagem_webhook_unauthorized', { correlationId });
    return res.status(auth.status).json(auth.body);
  }

  const requestId = req.requestId || 'unknown';
  const correlationId =
    auth.correlationId || req.get('X-Correlation-Id') || req.correlationId || requestId;
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotency_key || '').trim();

  if (auth.devFallback) {
    logger.warn('triagem_webhook_secret_dev_fallback', { requestId, correlationId });
  }

  try {
    const result = await processTriagemWebhook({
      body: req.body || {},
      correlationId,
      idempotencyKey,
      requestId
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('triagem_webhook_error', {
      requestId,
      correlationId,
      error: error.message
    });
    return res.status(500).json({
      success: false,
      message: 'Erro ao processar triagem',
      correlationId
    });
  }
});

module.exports = router;
