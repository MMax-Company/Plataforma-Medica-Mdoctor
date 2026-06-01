const { randomUUID } = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeAuditLog(input = {}) {
  const rawEntityId = input.entity_id || input.entityId || null;
  return {
    id: input.id || randomUUID(),
    entity_type: input.entity_type || input.entityType || 'system',
    entity_id: rawEntityId && UUID_PATTERN.test(String(rawEntityId)) ? String(rawEntityId) : null,
    action: input.action || 'event',
    actor: input.actor || input.medico_id || input.doctorId || 'backend',
    origin: input.origin || input.source || 'api',
    ip_address: input.ip_address || input.ipAddress || null,
    payload: {
      ...(input.payload || input.snapshot || {}),
      ...(rawEntityId && !UUID_PATTERN.test(String(rawEntityId)) ? { entity_ref: String(rawEntityId) } : {})
    },
    created_at: input.created_at || input.criado_em || new Date().toISOString()
  };
}

async function createAuditLog(input = {}) {
  const log = normalizeAuditLog(input);
  const data = await dbQuery('registrar audit log', async (supabase) =>
    supabase.from(T.AUDIT_LOGS).insert(log).select('*').single()
  );
  return data;
}

async function listAuditLogs({ entityId, limit = 50 } = {}) {
  const data = await dbQuery('listar audit logs', async (supabase) => {
    let q = supabase.from(T.AUDIT_LOGS).select('*').order('created_at', { ascending: false }).limit(limit);
    if (entityId) q = q.eq('entity_id', entityId);
    return q;
  });
  return data || [];
}

module.exports = {
  createAuditLog,
  listAuditLogs
};
