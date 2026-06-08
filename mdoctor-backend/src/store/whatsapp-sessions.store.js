const { randomUUID } = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').trim();
}

async function getSessionByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const data = await dbQuery('buscar whatsapp session por phone', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).select('*').eq('phone', digits).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  );
  return data || null;
}

async function upsertSessionMetadata({ phone, patientId = null, metadataPatch = {} }) {
  const digits = normalizePhone(phone);
  if (!digits) return null;

  const existing = await getSessionByPhone(digits);
  const now = new Date().toISOString();

  if (existing?.id) {
    const mergedMetadata = {
      ...(existing.metadata || {}),
      ...metadataPatch
    };
    const data = await dbQuery('atualizar whatsapp session metadata', async (supabase) =>
      supabase
        .from(T.WHATSAPP_SESSIONS)
        .update({ metadata: mergedMetadata, updated_at: now, last_message_at: now, patient_id: patientId || existing.patient_id || null })
        .eq('id', existing.id)
        .select('*')
        .single()
    );
    return data;
  }

  const row = {
    id: randomUUID(),
    phone: digits,
    patient_id: patientId || null,
    provider: 'evolution',
    status: 'active',
    metadata: metadataPatch,
    last_message_at: now,
    created_at: now,
    updated_at: now
  };

  const data = await dbQuery('criar whatsapp session', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).insert(row).select('*').single()
  );
  return data;
}

async function clearSurveySession(phone) {
  const session = await getSessionByPhone(phone);
  if (!session?.id) return null;
  const metadata = { ...(session.metadata || {}) };
  delete metadata.post_delivery_survey;
  const now = new Date().toISOString();
  const data = await dbQuery('limpar survey whatsapp session', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).update({ metadata, updated_at: now }).eq('id', session.id).select('*').single()
  );
  return data;
}

function getActiveSurveySession(session = {}) {
  return session?.metadata?.post_delivery_survey || null;
}

module.exports = {
  clearSurveySession,
  getActiveSurveySession,
  getSessionByPhone,
  normalizePhone,
  upsertSessionMetadata
};
