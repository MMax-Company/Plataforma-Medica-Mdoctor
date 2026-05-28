const buckets = new Map();

function toNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function makeRateLimit(options = {}) {
  const windowMs = options.windowMs || toNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
  const max = options.max || toNumber('RATE_LIMIT_MAX', 300);
  const maxBuckets = options.maxBuckets || toNumber('RATE_LIMIT_MAX_BUCKETS', 10000);
  const name = options.name || 'default';

  return async function rateLimit(req, res, next) {
    if (req.method === 'OPTIONS') return next();
    if (options.skip?.(req)) return next();

    const now = Date.now();
    const key = `${name}:${req.ip || req.headers['x-forwarded-for'] || 'unknown'}`;
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      if (buckets.size >= maxBuckets) {
        cleanupRateLimitBuckets();
      }
      if (buckets.size >= maxBuckets) {
        pruneOldestRateLimitBucket();
      }
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
      if (typeof options.onLimit === 'function') {
        try {
          await options.onLimit(req, {
            name,
            max,
            windowMs,
            key
          });
        } catch {
          // Do not block the rate-limit response when side effects fail.
        }
      }
      return res.status(429).json({
        success: false,
        error: options.errorMessage || 'Muitas requisicoes. Tente novamente em instantes.'
      });
    }

    return next();
  };
}

function pruneOldestRateLimitBucket() {
  let oldestKey = null;
  let oldestResetAt = Number.POSITIVE_INFINITY;
  for (const [bucketKey, bucket] of buckets.entries()) {
    if (bucket.resetAt < oldestResetAt) {
      oldestResetAt = bucket.resetAt;
      oldestKey = bucketKey;
    }
  }
  if (oldestKey) buckets.delete(oldestKey);
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
