const logger = require('../../config/logger');

function maskedIp(ip = '') {
  return String(ip).replace(/\d+$/, 'x');
}

function legacyLog({ integration, legacyEndpoint, mappedEndpoint, mode = 'proxy' }) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const requestId =
      req.requestId ||
      req.headers['x-request-id'] ||
      `legacy-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    req.requestId = requestId;
    req.legacyCompat = {
      integration,
      legacyEndpoint,
      mappedEndpoint,
      mode
    };

    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Legacy-Compat', 'true');
    res.setHeader('X-Legacy-Endpoint', legacyEndpoint);
    res.setHeader('X-Legacy-Mapped-Endpoint', mappedEndpoint);
    res.setHeader('X-Legacy-Deprecated', 'true');

    logger.warn('legacy_compat_deprecated_endpoint', {
      requestId,
      integration,
      legacyEndpoint,
      mappedEndpoint,
      mode,
      method: req.method
    });

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;
      logger.info('legacy_compat_request', {
        requestId,
        integration,
        legacyEndpoint,
        mappedEndpoint,
        mode,
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        ip: maskedIp(req.ip),
        userAgent: req.headers['user-agent'],
        hasAuth: Boolean(req.headers.authorization)
      });
    });

    return next();
  };
}

module.exports = {
  legacyLog
};
