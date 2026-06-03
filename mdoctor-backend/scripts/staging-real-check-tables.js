#!/usr/bin/env node
require('./load-dotenv');
const { initSupabase, getSupabase } = require('../src/config/supabase');
const RUN_ID = process.env.RUN_ID || 'staging-real-20260602-012050';

async function main() {
  initSupabase();
  const s = getSupabase();
  const { data: appts } = await s
    .from('appointments')
    .select('id, patient_id, paciente_nome, status')
    .ilike('paciente_nome', `%${RUN_ID}%`);
  const ids = (appts || []).map((a) => a.id);
  const patientIds = [...new Set((appts || []).map((a) => a.patient_id).filter(Boolean))];

  const counts = {};
  for (const [table, col, vals] of [
    ['patients', 'id', patientIds],
    ['appointments', 'id', ids],
    ['triage_sessions', 'appointment_id', ids],
    ['medical_records', 'appointment_id', ids],
    ['prescriptions', 'appointment_id', ids],
    ['support_tickets', 'appointment_id', ids],
    ['audit_logs', 'entity_id', ids],
  ]) {
    if (!vals.length) {
      counts[table] = 0;
      continue;
    }
    const { count, error } = await s.from(table).select(col, { count: 'exact', head: true }).in(col, vals);
    counts[table] = error ? `err:${error.message}` : count || 0;
  }
  console.log(JSON.stringify({ runId: RUN_ID, appointments: appts?.length, counts }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
