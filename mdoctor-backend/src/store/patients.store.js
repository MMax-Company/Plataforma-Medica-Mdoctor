const { randomUUID } = require('crypto');
const { getSupabase } = require('../config/supabase');

const seedPatients = [
  {
    id: randomUUID(),
    nome: 'Paciente Demo',
    name: 'Paciente Demo',
    telefone: '+5511999999999',
    phone: '+5511999999999',
    condition: 'hipertensao',
    status: 'pending',
    last_prescription: true,
    flags: [],
    source: 'demo',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

let patients = [...seedPatients];

function hasSupabase() {
  try {
    getSupabase();
    return true;
  } catch {
    return false;
  }
}

function normalizePatient(input = {}) {
  const now = new Date().toISOString();
  const name = input.name || input.nome || input.patientName || 'Paciente sem nome';
  const phone = input.phone || input.telefone || input.from || input.patientPhone || '';

  return {
    id: input.id || randomUUID(),
    nome: name,
    name,
    telefone: phone,
    phone,
    cpf: input.cpf || input.patientDocument || '',
    email: input.email || input.patientEmail || '',
    condition: input.condition || input.condicao || 'renovacao_receita',
    status: input.status || 'pending',
    last_prescription: Boolean(input.last_prescription || input.previous_prescription),
    continuous_use_proof: Boolean(input.continuous_use_proof),
    flags: Array.isArray(input.flags) ? input.flags : [],
    notes: input.notes || '',
    source: input.source || 'panel',
    created_at: input.created_at || now,
    updated_at: now
  };
}

async function listPatients() {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) return data;
    console.warn('Supabase patients fallback:', error?.message);
  }

  return [...patients].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function getPatient(id) {
  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('patients').select('*').eq('id', id).single();
    if (!error && data) return data;
  }

  return patients.find((patient) => patient.id === id) || null;
}

async function createPatient(input) {
  const patient = normalizePatient(input);

  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('patients').insert(patient).select('*').single();
    if (!error && data) return data;
    console.warn('Supabase insert fallback:', error?.message);
  }

  patients.unshift(patient);
  return patient;
}

async function updatePatientStatus(id, status, meta = {}) {
  const updates = {
    status,
    doctor_id: meta.doctorId || meta.doctor_id || null,
    notes: meta.notes || '',
    updated_at: new Date().toISOString()
  };

  if (hasSupabase()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('patients')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (!error && data) return data;
    console.warn('Supabase update fallback:', error?.message);
  }

  const index = patients.findIndex((patient) => patient.id === id);
  if (index === -1) return null;

  patients[index] = { ...patients[index], ...updates };
  return patients[index];
}

module.exports = {
  listPatients,
  getPatient,
  createPatient,
  updatePatientStatus
};
