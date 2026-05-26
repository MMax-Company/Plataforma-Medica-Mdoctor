const buckets = new Map();

function toNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function makeRateLimit(options = {}) {
  const windowMs = options.windowMs || toNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
  const max = options.max || toNumber('RATE_LIMIT_MAX', 300);
  const name = options.name || 'default';

  return function rateLimit(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    if (options.skip?.(req)) return next();

    const now = Date.now();
    const key = `${name}:${req.ip || req.headers['x-forwarded-for'] || 'unknown'}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('RateLimit-Limit', max);
      res.setHeader('RateLimit-Remaining', Math.max(max - 1, 0));
      res.setHeader('RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
      return next();
    }

    current.count += 1;
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(max - current.count, 0));
    res.setHeader('RateLimit-Reset', Math.ceil(current.resetAt / 1000));

    if (current.count > max) {
      return res.status(429).json({
        success: false,
        error: 'Muitas requisicoes. Tente novamente em instantes.'
      });
    }

    return next();
  };
}

function cleanupRateLimitBuckets() {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

module.exports = {
  cleanupRateLimitBuckets,
  makeRateLimit
};
