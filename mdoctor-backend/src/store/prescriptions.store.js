const { randomUUID } = require('crypto');
const { assertCanFallback, getSupabase, reportSupabaseError } = require('../config/supabase');
const { createAuditLog } = require('./audit.store');

const localPrescriptions = [];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasSupabase() {
  try {
    getSupabase();
    return true;
  } catch {
    return false;
  }
}

function normalizePrescription(input = {}) {
  const now = new Date().toISOString();
  return {
    id: input.id && UUID_PATTERN.test(String(input.id)) ? String(input.id) : randomUUID(),
    atendimento_id: input.atendimento_id || input.atendimentoId || null,
    patient_id: input.patient_id || input.patientId || null,
    status: input.status || 'mock',
    provider: input.provider || 'mock',
    provider_prescription_id:
      input.provider_prescription_id ||
      input.providerPrescriptionId ||
      input.prescriptionId ||
      (input.id && !UUID_PATTERN.test(String(input.id)) ? String(input.id) : null),
    pdf_url: input.pdf_url || input.pdfUrl || null,
    medications: input.medications || input.medicamentos || [],
    payload: input.payload || input.data || {},
    created_at: input.created_at || input.createdAt || now,
    updated_at: input.updated_at || input.updatedAt || now
  };
}

async function getPrescriptionByAtendimento(id) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('prescriptions')
      .select('*')
      .eq('atendimento_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return normalizePrescription(data);
    if (!error && !data) return null;

    reportSupabaseError(error);
    await createAuditLog({
      entity_type: 'prescription',
      entity_id: id,
      action: 'supabase_prescription_lookup_fallback',
      payload: { error: error.message }
    });
    assertCanFallback('buscar prescription', error);
  }

  return localPrescriptions.find((item) => item.atendimento_id === id || item.id === id) || null;
}

async function savePrescription(input = {}) {
  const prescription = normalizePrescription(input);

  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('prescriptions')
      .upsert(prescription, { onConflict: 'id' })
      .select('*')
      .single();

    if (!error && data) {
      await createAuditLog({
        entity_type: 'prescription',
        entity_id: data.id,
        action: 'prescription_saved',
        payload: { atendimento_id: data.atendimento_id, provider: data.provider, status: data.status }
      });
      return normalizePrescription(data);
    }

    reportSupabaseError(error);
    await createAuditLog({
      entity_type: 'prescription',
      entity_id: prescription.id,
      action: 'supabase_prescription_save_fallback',
      payload: { error: error.message }
    });
    assertCanFallback('salvar prescription', error);
  }

  const index = localPrescriptions.findIndex((item) => item.id === prescription.id);
  if (index >= 0) localPrescriptions[index] = prescription;
  else localPrescriptions.unshift(prescription);
  return prescription;
}

module.exports = {
  getPrescriptionByAtendimento,
  normalizePrescription,
  savePrescription
};
