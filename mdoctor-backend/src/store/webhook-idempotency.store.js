const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

function toNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function settings() {
  return {
    ttlMs: toNumber('WEBHOOK_IDEMPOTENCY_TTL_MS', 24 * 60 * 60 * 1000)
  };
}

function normalizeKey(key) {
  return String(key || '').trim();
}

async function rememberWebhookResult(key, result = {}, meta = {}) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return;

  const { ttlMs } = settings();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  await dbQuery('persistir idempotência webhook', async (supabase) =>
    supabase.from(T.N8N_EVENTS).upsert(
      {
        idempotency_key: normalizedKey,
        source: meta.source || 'unknown',
        appointment_id: result.atendimentoId || null,
        event_type: 'idempotency_cache',
        payload: {
          decision: result.decision || null,
          reply: result.reply || null
        },
        expires_at: expiresAt
      },
      { onConflict: 'idempotency_key' }
    )
  );
}

async function getRememberedWebhookResult(key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) return null;

  const data = await dbQuery('ler idempotência webhook', async (supabase) =>
    supabase
      .from(T.N8N_EVENTS)
      .select('appointment_id, payload, expires_at')
      .eq('idempotency_key', normalizedKey)
      .maybeSingle()
  );

  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await dbQuery('expirar idempotência webhook', async (supabase) =>
      supabase.from(T.N8N_EVENTS).delete().eq('idempotency_key', normalizedKey)
    );
    return null;
  }

  const payload = data.payload || {};
  return {
    atendimentoId: data.appointment_id,
    decision: payload.decision || null,
    reply: payload.reply || null
  };
}

function cleanupWebhookIdempotencyCache() {
  // Limpeza via cron Supabase ou job futuro; no-op no processo Node
}

module.exports = {
  cleanupWebhookIdempotencyCache,
  getRememberedWebhookResult,
  rememberWebhookResult
};
