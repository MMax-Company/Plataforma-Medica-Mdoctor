const { randomUUID } = require('crypto');
const { assertCanFallback, getSupabase, reportSupabaseError } = require('../config/supabase');

const localAuditLogs = [];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasSupabase() {
  try {
    getSupabase();
    return true;
  } catch {
    return false;
  }
}

function normalizeAuditLog(input = {}) {
  const rawEntityId = input.entity_id || input.entityId || null;
  return {
    id: input.id || randomUUID(),
    entity_type: input.entity_type || input.entityType || 'system',
    entity_id: rawEntityId && UUID_PATTERN.test(String(rawEntityId)) ? String(rawEntityId) : null,
    action: input.action || 'event',
    actor: input.actor || input.medico_id || input.doctorId || 'backend',
    payload: {
      ...(input.payload || input.snapshot || {}),
      ...(rawEntityId && !UUID_PATTERN.test(String(rawEntityId)) ? { entity_ref: String(rawEntityId) } : {})
    },
    created_at: input.created_at || input.criado_em || new Date().toISOString()
  };
}

async function createAuditLog(input = {}) {
  const log = normalizeAuditLog(input);

  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('audit_logs').insert(log).select('*').single();
    if (!error && data) return data;
    reportSupabaseError(error);
    assertCanFallback('registrar audit log', error);
  }

  localAuditLogs.unshift(log);
  return log;
}

async function listAuditLogs({ entityId, limit = 50 } = {}) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
    if (entityId) query = query.eq('entity_id', entityId);
    const { data, error } = await query;
    if (!error && data) return data;
    reportSupabaseError(error);
    assertCanFallback('listar audit logs', error);
  }

  return localAuditLogs
    .filter((log) => !entityId || log.entity_id === entityId)
    .slice(0, limit);
}

module.exports = {
  createAuditLog,
  listAuditLogs
};
