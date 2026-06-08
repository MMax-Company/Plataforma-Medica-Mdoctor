const { randomUUID } = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');
const { SURVEY_VERSION } = require('../constants/patient-outcome-survey');

function rowToOutcome(row = {}) {
  return {
    id: row.id,
    attendance_id: row.attendance_id,
    patient_id: row.patient_id || null,
    created_at: row.created_at,
    survey_version: row.survey_version || SURVEY_VERSION,
    q1_access_alternative: row.q1_access_alternative || null,
    q2_avoided_interruption: row.q2_avoided_interruption || null,
    q3_would_use_again: row.q3_would_use_again || null
  };
}

async function getOutcomeByAttendance(attendanceId, surveyVersion = SURVEY_VERSION) {
  if (!attendanceId) return null;
  const data = await dbQuery('buscar patient outcome por attendance', async (supabase) =>
    supabase
      .from(T.PATIENT_OUTCOMES)
      .select('*')
      .eq('attendance_id', attendanceId)
      .eq('survey_version', surveyVersion)
      .maybeSingle()
  );
  return data ? rowToOutcome(data) : null;
}

async function getOutcomeById(outcomeId) {
  if (!outcomeId) return null;
  const data = await dbQuery('buscar patient outcome por id', async (supabase) =>
    supabase.from(T.PATIENT_OUTCOMES).select('*').eq('id', outcomeId).maybeSingle()
  );
  return data ? rowToOutcome(data) : null;
}

async function createPendingOutcome({ attendanceId, patientId, surveyVersion = SURVEY_VERSION }) {
  const row = {
    id: randomUUID(),
    attendance_id: attendanceId,
    patient_id: patientId || null,
    survey_version: surveyVersion,
    q1_access_alternative: null,
    q2_avoided_interruption: null,
    q3_would_use_again: null
  };

  const data = await dbQuery('criar patient outcome pendente', async (supabase) =>
    supabase.from(T.PATIENT_OUTCOMES).insert(row).select('*').single()
  );
  return rowToOutcome(data);
}

async function updateOutcomeFields(outcomeId, fields = {}) {
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(fields, 'q1_access_alternative')) {
    patch.q1_access_alternative = fields.q1_access_alternative;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'q2_avoided_interruption')) {
    patch.q2_avoided_interruption = fields.q2_avoided_interruption;
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'q3_would_use_again')) {
    patch.q3_would_use_again = fields.q3_would_use_again;
  }
  if (!Object.keys(patch).length) {
    return getOutcomeById(outcomeId);
  }

  const data = await dbQuery('atualizar patient outcome', async (supabase) =>
    supabase.from(T.PATIENT_OUTCOMES).update(patch).eq('id', outcomeId).select('*').single()
  );
  return rowToOutcome(data);
}

async function upsertOutcome(input = {}) {
  const attendanceId = input.attendance_id || input.attendanceId;
  const surveyVersion = input.survey_version || input.surveyVersion || SURVEY_VERSION;
  if (!attendanceId) {
    const error = new Error('attendance_id obrigatório');
    error.statusCode = 400;
    throw error;
  }

  const existing = await getOutcomeByAttendance(attendanceId, surveyVersion);
  const payload = {
    attendance_id: attendanceId,
    patient_id: input.patient_id || input.patientId || existing?.patient_id || null,
    survey_version: surveyVersion,
    q1_access_alternative: input.q1_access_alternative ?? input.q1 ?? existing?.q1_access_alternative ?? null,
    q2_avoided_interruption: input.q2_avoided_interruption ?? input.q2 ?? existing?.q2_avoided_interruption ?? null,
    q3_would_use_again: input.q3_would_use_again ?? input.q3 ?? existing?.q3_would_use_again ?? null
  };

  if (existing?.id) {
    const data = await dbQuery('upsert patient outcome update', async (supabase) =>
      supabase.from(T.PATIENT_OUTCOMES).update(payload).eq('id', existing.id).select('*').single()
    );
    return rowToOutcome(data);
  }

  const data = await dbQuery('upsert patient outcome insert', async (supabase) =>
    supabase
      .from(T.PATIENT_OUTCOMES)
      .insert({ id: randomUUID(), ...payload })
      .select('*')
      .single()
  );
  return rowToOutcome(data);
}

module.exports = {
  createPendingOutcome,
  getOutcomeByAttendance,
  getOutcomeById,
  updateOutcomeFields,
  upsertOutcome
};
