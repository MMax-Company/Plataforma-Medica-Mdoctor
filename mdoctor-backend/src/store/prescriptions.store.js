const { randomUUID } = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');
const { createAuditLog } = require('./audit.store');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePrescription(input = {}) {
  const now = new Date().toISOString();
  const appointmentId = input.appointment_id || input.atendimento_id || input.atendimentoId || null;
  return {
    id: input.id && UUID_PATTERN.test(String(input.id)) ? String(input.id) : randomUUID(),
    appointment_id: appointmentId,
    atendimento_id: appointmentId,
    patient_id: input.patient_id || input.patientId || null,
    status: input.status || 'draft',
    provider: input.provider || 'memed',
    provider_prescription_id:
      input.provider_prescription_id ||
      input.providerPrescriptionId ||
      input.prescriptionId ||
      (input.id && !UUID_PATTERN.test(String(input.id)) ? String(input.id) : null),
    pdf_url: input.pdf_url || input.pdfUrl || null,
    medications: input.medications || input.medicamentos || [],
    payload: input.payload || input.data || {},
    issued_by_doctor_id: input.issued_by_doctor_id || input.medico_id || null,
    issued_at: input.issued_at || input.issuedAt || null,
    created_at: input.created_at || input.createdAt || now,
    updated_at: input.updated_at || input.updatedAt || now
  };
}

async function getPrescriptionByAtendimento(id) {
  const data = await dbQuery('buscar prescription', async (supabase) =>
    supabase
      .from(T.PRESCRIPTIONS)
      .select('*')
      .or(`appointment_id.eq.${id},atendimento_id.eq.${id}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  return data ? normalizePrescription(data) : null;
}

async function savePrescription(input = {}) {
  const prescription = normalizePrescription(input);
  const row = { ...prescription };
  delete row.atendimento_id;

  const data = await dbQuery('salvar prescription', async (supabase) =>
    supabase.from(T.PRESCRIPTIONS).upsert(row, { onConflict: 'id' }).select('*').single()
  );

  await createAuditLog({
    entity_type: 'prescription',
    entity_id: data.id,
    action: 'prescription_saved',
    payload: {
      appointment_id: data.appointment_id,
      provider: data.provider,
      status: data.status
    }
  });

  return normalizePrescription(data);
}

module.exports = {
  getPrescriptionByAtendimento,
  normalizePrescription,
  savePrescription
};
