const logger = require('../config/logger');

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  const requestId =
    req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1000000;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('http_request', {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  });

  next();
}

module.exports = requestLogger;
