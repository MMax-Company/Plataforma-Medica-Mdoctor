const cache = new Map();

function toNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function settings() {
  return {
    ttlMs: toNumber('WEBHOOK_IDEMPOTENCY_TTL_MS', 24 * 60 * 60 * 1000),
    maxEntries: toNumber('WEBHOOK_IDEMPOTENCY_MAX_ENTRIES', 5000)
  };
}

function normalizeKey(key) {
  return String(key || '').trim();
}

function rememberWebhookResult(key, result = {}) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return;

  const { ttlMs, maxEntries } = settings();
  const now = Date.now();

  if (cache.size >= maxEntries) {
    cleanupWebhookIdempotencyCache();
  }
  if (cache.size >= maxEntries) {
    pruneOldestEntry();
  }

  cache.set(normalizedKey, {
    atendimentoId: result.atendimentoId || null,
    decision: result.decision || null,
    reply: result.reply || null,
    expiresAt: now + ttlMs,
    updatedAt: now
  });
}

function getRememberedWebhookResult(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return null;
  const item = cache.get(normalizedKey);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    cache.delete(normalizedKey);
    return null;
  }
  return item;
}

function cleanupWebhookIdempotencyCache() {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now) cache.delete(key);
  }
}

function pruneOldestEntry() {
  let oldestKey = null;
  let oldestUpdatedAt = Number.POSITIVE_INFINITY;
  for (const [key, value] of cache.entries()) {
    if (value.updatedAt < oldestUpdatedAt) {
      oldestUpdatedAt = value.updatedAt;
      oldestKey = key;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

module.exports = {
  cleanupWebhookIdempotencyCache,
  getRememberedWebhookResult,
  rememberWebhookResult
};
