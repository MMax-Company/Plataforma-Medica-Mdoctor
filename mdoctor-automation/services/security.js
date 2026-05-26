function extractToken(req) {
  const headerToken = req.headers['x-automation-secret'];
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return headerToken || bearer || null;
}

function requireWebhookSecret(req, res, next) {
  const expected = process.env.AUTOMATION_WEBHOOK_SECRET;

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        error: 'AUTOMATION_WEBHOOK_SECRET ausente em producao'
      });
    }
    return next();
  }

  const received = extractToken(req);
  if (received !== expected) {
    return res.status(401).json({
      success: false,
      error: 'Webhook nao autorizado'
    });
  }

  return next();
}

module.exports = {
  requireWebhookSecret
};
