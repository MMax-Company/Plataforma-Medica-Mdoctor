function isStrictWebhookEnv() {
  return process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT_NAME === 'staging';
}

function verifyN8nWebhookSecret(req) {
  const configuredSecret = String(process.env.N8N_WEBHOOK_SECRET || '').trim();
  const providedSecret = String(req.get('X-MDoctor-Webhook-Secret') || '').trim();
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';

  if (configuredSecret) {
    if (!providedSecret || providedSecret !== configuredSecret) {
      return { ok: false, status: 401, body: { success: false, error: 'Webhook não autorizado', correlationId } };
    }
    return { ok: true, correlationId };
  }

  if (!isStrictWebhookEnv()) {
    return { ok: true, correlationId, devFallback: true };
  }

  return {
    ok: false,
    status: 401,
    body: { success: false, error: 'Webhook secret não configurado', correlationId }
  };
}

module.exports = {
  verifyN8nWebhookSecret
};
