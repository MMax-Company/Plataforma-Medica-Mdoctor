const { randomUUID } = require('crypto');
const { assertCanFallback, getSupabase, reportSupabaseError } = require('../config/supabase');

const localAuditLogs = [];

function hasSupabase() {
  try {
    getSupabase();
    return true;
  } catch {
    return false;
  }
}

function normalizeAuditLog(input = {}) {
  return {
    id: input.id || randomUUID(),
    entity_type: input.entity_type || input.entityType || 'system',
    entity_id: input.entity_id || input.entityId || null,
    action: input.action || 'event',
    actor: input.actor || input.medico_id || input.doctorId || 'backend',
    payload: input.payload || input.snapshot || {},
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
