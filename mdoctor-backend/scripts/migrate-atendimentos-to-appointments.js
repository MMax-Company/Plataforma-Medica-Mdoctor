#!/usr/bin/env node
/**
 * Copia registros de public.atendimentos → public.appointments (projeto oficial).
 * Uso: LOAD_RAILWAY_VARS=0 node scripts/migrate-atendimentos-to-appointments.js
 */
require('./load-dotenv');
const { initSupabase, getSupabase } = require('../src/config/supabase');

async function main() {
  initSupabase();
  const supabase = getSupabase();
  const { data: legacy, error } = await supabase.from('atendimentos').select('*').limit(500);
  if (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }

  let migrated = 0;
  let skipped = 0;
  const errors = [];

  const { data: patients } = await supabase.from('patients').select('id,phone').limit(2000);

  for (const row of legacy || []) {
    let patientId = row.patient_id || null;
    if (!patientId && row.paciente_telefone) {
      const digits = String(row.paciente_telefone).replace(/\D/g, '');
      const match = (patients || []).find(
        (p) => String(p.phone || '').replace(/\D/g, '') === digits
      );
      patientId = match?.id || null;
      if (patientId) {
        await supabase.from('atendimentos').update({ patient_id: patientId }).eq('id', row.id);
      }
    }

    const appointment = {
      id: row.id,
      patient_id: patientId,
      patient_name: row.paciente_nome || '',
      patient_phone: row.paciente_telefone || '',
      patient_cpf: row.paciente_cpf || '',
      patient_email: row.paciente_email || '',
      condition: row.condicao || '',
      medication_in_use: row.medicacao_em_uso || '',
      source: row.origem || 'migrated',
      status: row.status || 'waiting',
      payment_status: row.pagamento_status || 'PENDENTE',
      risk_level: row.risco || 'BAIXO',
      eligibility: row.elegibilidade,
      clinical_data: row.dados_clinicos || {},
      decision_reason: row.motivo_decisao,
      doctor_id: row.medico_id ? String(row.medico_id) : null,
      created_at: row.criado_em,
      updated_at: row.atualizado_em
    };

    const { error: upsertError } = await supabase
      .from('appointments')
      .upsert(appointment, { onConflict: 'id' });
    if (upsertError) {
      errors.push({ id: row.id, error: upsertError.message });
    } else {
      migrated += 1;
    }
  }

  const { count: apptCount } = await supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true });
  const { count: legCount } = await supabase
    .from('atendimentos')
    .select('id', { count: 'exact', head: true });

  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        migrated,
        skipped,
        appointments_total: apptCount,
        atendimentos_total: legCount,
        errors: errors.slice(0, 10)
      },
      null,
      2
    )
  );
  process.exit(errors.length ? 1 : 0);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
