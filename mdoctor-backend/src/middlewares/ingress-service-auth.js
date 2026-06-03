const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { getJwtSecret } = require('../auth/auth.middleware');

function isStrictIngressEnv() {
  return process.env.NODE_ENV === 'production' || process.env.ENVIRONMENT_NAME === 'staging';
}

function getIngressSecret() {
  return String(process.env.INGRESS_SERVICE_SECRET || process.env.N8N_WEBHOOK_SECRET || '').trim();
}

function verifyIngressServiceSecret(req) {
  const configuredSecret = getIngressSecret();
  const providedSecret = String(
    req.get('X-MDoctor-Service-Secret') || req.get('X-MDoctor-Webhook-Secret') || ''
  ).trim();
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || req.requestId || 'unknown';

  if (configuredSecret) {
    if (!providedSecret || providedSecret !== configuredSecret) {
      return { ok: false, status: 401, body: { success: false, error: 'Ingress não autorizado', correlationId } };
    }
    return { ok: true, correlationId };
  }

  if (!isStrictIngressEnv()) {
    return { ok: true, correlationId, devFallback: true };
  }

  return {
    ok: false,
    status: 401,
    body: { success: false, error: 'INGRESS_SERVICE_SECRET ou N8N_WEBHOOK_SECRET não configurado', correlationId }
  };
}

function attachUserFromBearer(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  try {
    req.user = jwt.verify(token, getJwtSecret());
    return true;
  } catch {
    return false;
  }
}

function requireIngressOrAuth(req, res, next) {
  if (attachUserFromBearer(req) || req.user) {
    return next();
  }

  const auth = verifyIngressServiceSecret(req);
  if (!auth.ok) {
    return res.status(auth.status).json(auth.body);
  }

  if (auth.devFallback) {
    logger.warn('ingress_service_secret_dev_fallback', {
      path: req.originalUrl || req.url,
      correlationId: auth.correlationId
    });
  }

  return next();
}

module.exports = {
  getIngressSecret,
  isStrictIngressEnv,
  requireIngressOrAuth,
  verifyIngressServiceSecret
};
