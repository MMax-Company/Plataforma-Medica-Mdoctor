const T = require('./tables');
const { requireSupabaseClient } = require('./persistence');

let appointmentTable = process.env.SUPABASE_APPOINTMENTS_TABLE || null;
let resolved = false;

async function probeTable(supabase, table) {
  const { error } = await supabase.from(table).select('id').limit(1);
  return !error;
}

async function getAppointmentTable() {
  if (appointmentTable && resolved) return appointmentTable;
  if (process.env.SUPABASE_APPOINTMENTS_TABLE) {
    appointmentTable = process.env.SUPABASE_APPOINTMENTS_TABLE;
    resolved = true;
    return appointmentTable;
  }

  const supabase = requireSupabaseClient('resolver tabela appointments');
  if (await probeTable(supabase, T.APPOINTMENTS)) {
    appointmentTable = T.APPOINTMENTS;
  } else if (await probeTable(supabase, 'atendimentos')) {
    appointmentTable = 'atendimentos';
  } else {
    throw new Error(
      'Nenhuma tabela appointments/atendimentos encontrada. Execute npm run supabase:migrate com SUPABASE_DB_URL.'
    );
  }
  resolved = true;
  return appointmentTable;
}

module.exports = {
  getAppointmentTable
};
