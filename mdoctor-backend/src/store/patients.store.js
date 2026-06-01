const { randomUUID } = require('crypto');
const T = require('../db/tables');
const { dbQuery, throwOnDbError } = require('../db/persistence');

function rowToPatient(row = {}) {
  const name = row.full_name || row.nome || row.name || '';
  const phone = row.phone || row.telefone || '';
  return {
    id: row.id,
    nome: name,
    name,
    telefone: phone,
    phone,
    cpf: row.cpf || '',
    email: row.email || '',
    birth_date: row.birth_date || row.data_nascimento || '',
    data_nascimento: row.birth_date || row.data_nascimento || '',
    status: row.status || 'pending',
    metadata: row.metadata || {},
    source: row.source || 'panel',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function patientToRow(patient = {}) {
  const name = patient.name || patient.nome || patient.patientName || 'Paciente sem nome';
  const phone = patient.phone || patient.telefone || patient.from || patient.patientPhone || '';
  return {
    id: patient.id || randomUUID(),
    full_name: name,
    phone,
    cpf: patient.cpf || patient.patientDocument || '',
    email: patient.email || patient.patientEmail || '',
    birth_date: patient.birth_date || patient.data_nascimento || '',
    status: patient.status || 'pending',
    source: patient.source || 'panel',
    metadata: {
      condition: patient.condition || patient.condicao || null,
      flags: patient.flags || [],
      notes: patient.notes || ''
    }
  };
}

async function listPatients() {
  const data = await dbQuery('listar pacientes', async (supabase) =>
    supabase.from(T.PATIENTS).select('*').order('created_at', { ascending: false })
  );
  return (data || []).map(rowToPatient);
}

async function getPatient(id) {
  const data = await dbQuery('buscar paciente', async (supabase) =>
    supabase.from(T.PATIENTS).select('*').eq('id', id).maybeSingle()
  );
  return data ? rowToPatient(data) : null;
}

async function createPatient(input) {
  const row = patientToRow(input);
  const data = await dbQuery('criar paciente', async (supabase) =>
    supabase.from(T.PATIENTS).insert(row).select('*').single()
  );
  return rowToPatient(data);
}

async function updatePatientStatus(id, status, meta = {}) {
  const updates = {
    status,
    metadata: {
      doctor_id: meta.doctorId || meta.doctor_id || null,
      notes: meta.notes || ''
    }
  };
  const data = await dbQuery('atualizar paciente', async (supabase) =>
    supabase.from(T.PATIENTS).update(updates).eq('id', id).select('*').single()
  );
  return data ? rowToPatient(data) : null;
}

module.exports = {
  listPatients,
  getPatient,
  createPatient,
  updatePatientStatus
};
