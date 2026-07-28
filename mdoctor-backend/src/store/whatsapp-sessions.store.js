const { randomUUID } = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '').trim();
}

function normalizeIdentifier(value) {
  const str = value === null || value === undefined ? '' : String(value).trim();
  return str || '';
}

async function getSessionByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  const data = await dbQuery('buscar whatsapp session por phone', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).select('*').eq('phone', digits).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  );
  return data || null;
}

async function getSessionByBsuid(bsuid) {
  const id = normalizeIdentifier(bsuid);
  if (!id) return null;
  const data = await dbQuery('buscar whatsapp session por bsuid', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).select('*').eq('bsuid', id).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  );
  return data || null;
}

// Upsert de identidade Meta: telefone, BSUID, BSUID pai e username são
// armazenados em colunas separadas (ao contrário de upsertSessionMetadata,
// que só conhece telefone) porque contatos de interoperabilidade podem não
// ter telefone algum.
async function upsertSessionIdentity({
  phone = null,
  bsuid = null,
  parentBsuid = null,
  username = null,
  patientId = null,
  metadataPatch = {}
}) {
  const digits = phone ? normalizePhone(phone) : '';
  const bsuidId = normalizeIdentifier(bsuid);
  const parentBsuidId = normalizeIdentifier(parentBsuid);
  const usernameVal = normalizeIdentifier(username);

  if (!digits && !bsuidId) return null;

  const existing = digits ? await getSessionByPhone(digits) : await getSessionByBsuid(bsuidId);
  const now = new Date().toISOString();

  if (existing?.id) {
    const mergedMetadata = { ...(existing.metadata || {}), ...metadataPatch };
    const data = await dbQuery('atualizar identidade whatsapp session', async (supabase) =>
      supabase
        .from(T.WHATSAPP_SESSIONS)
        .update({
          phone: digits || existing.phone || null,
          bsuid: bsuidId || existing.bsuid || null,
          parent_bsuid: parentBsuidId || existing.parent_bsuid || null,
          username: usernameVal || existing.username || null,
          metadata: mergedMetadata,
          updated_at: now,
          last_message_at: now,
          patient_id: patientId || existing.patient_id || null
        })
        .eq('id', existing.id)
        .select('*')
        .single()
    );
    return data;
  }

  const row = {
    id: randomUUID(),
    phone: digits || null,
    bsuid: bsuidId || null,
    parent_bsuid: parentBsuidId || null,
    username: usernameVal || null,
    patient_id: patientId || null,
    provider: 'meta',
    status: 'active',
    metadata: metadataPatch,
    last_message_at: now,
    created_at: now,
    updated_at: now
  };

  const data = await dbQuery('criar whatsapp session (identity)', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).insert(row).select('*').single()
  );
  return data;
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
    provider: 'meta',
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

async function setTypebotSessionId({ sessionId, typebotSessionId }) {
  if (!sessionId || !typebotSessionId) return null;
  const data = await dbQuery('salvar sessão Typebot no WhatsApp', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .update({ typebot_session_id: typebotSessionId, updated_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select('*')
      .single()
  );
  return data;
}

const TYPEBOT_METADATA_KEYS = [
  'typebot_expected_input_id',
  'typebot_payment',
  'typebot_prescription_upload',
  'whatsapp_menu_state'
];

async function clearTypebotSession({ sessionId, metadataPatch = {} }) {
  if (!sessionId) return null;
  const existing = await dbQuery('buscar whatsapp session para limpar typebot', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).select('*').eq('id', sessionId).maybeSingle()
  );
  if (!existing?.id) return null;

  const metadata = { ...(existing.metadata || {}), ...metadataPatch };
  for (const key of TYPEBOT_METADATA_KEYS) delete metadata[key];

  const now = new Date().toISOString();
  const data = await dbQuery('limpar sessão Typebot no WhatsApp', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .update({
        typebot_session_id: null,
        metadata,
        updated_at: now
      })
      .eq('id', sessionId)
      .select('*')
      .single()
  );
  return data;
}

function getActiveSurveySession(session = {}) {
  return session?.metadata?.post_delivery_survey || null;
}

// Marcadores de jornada (metrica de tempo do painel admin — ver
// admin.routes.js computeTempos): staged em whatsapp_sessions.metadata no
// momento em que ocorrem (primeiro "Oi" e clique em "Vamos começar"), e
// consumidos (copiados para dados_clinicos.jornada do atendimento) no
// webhook do n8n que cria o atendimento — ver whatsapp.routes.js. Limpos
// aqui logo após o consumo para que a PRÓXIMA jornada do mesmo telefone
// (ex.: renovação) comece com marcadores zerados, em vez de herdar os
// valores da jornada anterior.
const JOURNEY_METADATA_KEYS = ['journey_started_at', 'welcome_clicked_at'];

async function clearJourneyMarkers(phone) {
  const session = await getSessionByPhone(phone);
  if (!session?.id) return null;
  const metadata = { ...(session.metadata || {}) };
  for (const key of JOURNEY_METADATA_KEYS) delete metadata[key];
  const now = new Date().toISOString();
  const data = await dbQuery('limpar marcadores de jornada whatsapp session', async (supabase) =>
    supabase.from(T.WHATSAPP_SESSIONS).update({ metadata, updated_at: now }).eq('id', session.id).select('*').single()
  );
  return data;
}

module.exports = {
  clearJourneyMarkers,
  clearSurveySession,
  clearTypebotSession,
  getActiveSurveySession,
  getSessionByBsuid,
  getSessionByPhone,
  normalizePhone,
  setTypebotSessionId,
  upsertSessionIdentity,
  upsertSessionMetadata
};
