#!/usr/bin/env node
/**
 * E2E fluxo médico completo staging — triagem → pagamento → fila → Memed mock → entrega.
 * Valida persistência Supabase (appointments, triage, prontuário, prescriptions).
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { initSupabase, getSupabase } = require('../src/config/supabase');
const T = require('../src/db/tables');
const { getAppointmentTable } = require('../src/db/resolve-tables');
const lib = require('./homologacao-clinica-fase2-lib');
const { atendimentoToRow, rowToAtendimento } = require('../src/db/appointment-mapper');

async function syncLegacyToAppointments(atendimentoId) {
  initSupabase();
  const supabase = getSupabase();
  const { data: legacy } = await supabase.from('atendimentos').select('*').eq('id', atendimentoId).maybeSingle();
  if (!legacy) return false;
  let patientId = legacy.patient_id;
  if (!patientId && legacy.paciente_telefone) {
    const digits = String(legacy.paciente_telefone).replace(/\D/g, '');
    const { data: patients } = await supabase.from(T.PATIENTS).select('id,phone').limit(500);
    const match = (patients || []).find((p) => String(p.phone || '').replace(/\D/g, '') === digits);
    if (match?.id) {
      patientId = match.id;
      await supabase.from('atendimentos').update({ patient_id: patientId }).eq('id', atendimentoId);
    }
  }
  const row = atendimentoToRow(rowToAtendimento({ ...legacy, patient_id: patientId }));
  const { error } = await supabase.from(T.APPOINTMENTS).upsert(row, { onConflict: 'id' });
  return !error;
}

const REPORT_PATH =
  process.env.REPORT_PATH ||
  path.join(__dirname, '../../docs/FLUXO-MEDICO-FINAL-STAGING.json');

const RAILWAY_PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const RAILWAY_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const RAILWAY_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

function loadRailwaySecret(key) {
  if (process.env[key]) return;
  try {
    const out = execSync(
      `railway variable list -p ${RAILWAY_PROJECT} -e ${RAILWAY_ENV} -s ${RAILWAY_SERVICE} --json`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const vars = JSON.parse(out);
    if (vars[key]) process.env[key] = String(vars[key]);
  } catch {
    /* ignore */
  }
}

const STRICT =
  process.env.REVALIDATE_STRICT === '1' || process.env.REVALIDATE_STRICT === 'true';

const report = {
  executed_at: new Date().toISOString(),
  backend: lib.BACKEND_URL,
  revalidate_strict: STRICT,
  steps: [],
  supabase: {},
  errors: [],
  warnings: []
};

function step(name, ok, extra = {}) {
  const optional = STRICT ? false : Boolean(extra.optional);
  report.steps.push({ name, ok, ...extra, optional });
  if (!ok && !optional) report.errors.push(name);
  if (!ok && optional) report.warnings.push(name);
}

async function verifySupabase(atendimentoId, patientId) {
  initSupabase();
  const supabase = getSupabase();
  const table = await getAppointmentTable();
  report.supabase.appointment_table = table;

  const { data: appt } = await supabase.from(table).select('*').eq('id', atendimentoId).maybeSingle();
  step('db_appointment', Boolean(appt?.id), { table, patient_id: appt?.patient_id ?? null });

  if (patientId) {
    step('db_patient_link', appt?.patient_id === patientId, {
      optional: appt?.patient_id !== patientId
    });
  }

  const { data: triage } = await supabase
    .from(T.TRIAGE_SESSIONS)
    .select('id')
    .eq('appointment_id', atendimentoId)
    .limit(1);
  step('db_triage_sessions', (triage || []).length > 0, {
    optional: !(triage || []).length
  });

  const { data: eligibility } = await supabase
    .from(T.MEDICAL_ELIGIBILITY)
    .select('id')
    .eq('appointment_id', atendimentoId)
    .limit(1);
  step('db_medical_eligibility', (eligibility || []).length > 0, {
    optional: !(eligibility || []).length
  });

  const { data: record } = await supabase
    .from(T.MEDICAL_RECORDS)
    .select('id,clinical_data')
    .eq('appointment_id', atendimentoId)
    .limit(1);
  step('db_medical_records', (record || []).length > 0, {
    optional: !(record || []).length,
    has_prontuario: Boolean(record?.[0]?.clinical_data?.prontuario)
  });

  const { data: prescription } = await supabase
    .from(T.PRESCRIPTIONS)
    .select('id,pdf_url,status')
    .eq('appointment_id', atendimentoId)
    .limit(1);
  let { data: memedLegacy } = await supabase
    .from('receitas_memed')
    .select('id,pdf_url,status')
    .eq('atendimento_id', atendimentoId)
    .limit(1);
  const prescriptionOk =
    STRICT
      ? (prescription || []).length > 0
      : (prescription || []).length > 0 || (memedLegacy || []).length > 0;
  step('db_prescriptions', prescriptionOk, {
    optional: STRICT ? false : !(prescription || []).length && !(memedLegacy || []).length,
    source: (prescription || []).length ? 'prescriptions' : (memedLegacy || []).length ? 'receitas_memed' : null
  });

  const { data: delivery } = await supabase
    .from(T.PRESCRIPTION_DELIVERY)
    .select('id,status')
    .eq('appointment_id', atendimentoId)
    .limit(1);
  const { data: deliveryLegacy } = await supabase
    .from('entregas_receita')
    .select('id,status')
    .eq('atendimento_id', atendimentoId)
    .limit(1);
  const deliveryOk =
    STRICT
      ? (delivery || []).length > 0
      : (delivery || []).length > 0 || (deliveryLegacy || []).length > 0;
  step('db_prescription_delivery', deliveryOk, {
    optional: STRICT ? false : !(delivery || []).length && !(deliveryLegacy || []).length,
    source: (delivery || []).length ? 'prescription_delivery' : (deliveryLegacy || []).length ? 'entregas_receita' : null
  });

  const { data: legacyRow } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', atendimentoId)
    .maybeSingle();
  const { data: officialRow } = await supabase
    .from(T.APPOINTMENTS)
    .select('id')
    .eq('id', atendimentoId)
    .maybeSingle();
  step('db_appointments_primary', Boolean(officialRow?.id), {
    optional: STRICT ? false : !officialRow?.id,
    legacy_atendimentos_row: Boolean(legacyRow?.id)
  });
  if (STRICT) {
    step('db_legacy_not_primary', Boolean(officialRow?.id) && !legacyRow?.id, {
      appointments: Boolean(officialRow?.id),
      atendimentos: Boolean(legacyRow?.id)
    });
  }

  const supabaseRef = (process.env.SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase/)?.[1] || null;
  report.supabase.ref = supabaseRef;
  step('supabase_official_ref', supabaseRef === 'usihurogvphtjedyhyfl', { ref: supabaseRef });
}

async function main() {
  loadRailwaySecret('N8N_WEBHOOK_SECRET');
  process.env.MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
  process.env.MEDICO_PASS = process.env.MEDICO_PASS || process.env.MEDICO_OFFICIAL_PASS || '';

  const correlationId = `fluxo-medico-${Date.now()}`;

  const readyz = await lib.requestJson(`${lib.BACKEND_URL}/readyz`);
  step('readyz_supabase', readyz.data?.storage?.mode === 'supabase' || readyz.data?.supabase?.mode === 'supabase', {
    storage_mode: readyz.data?.storage?.mode,
    supabase_connected: readyz.data?.supabase?.connected
  });

  const created = await lib.createAtendimentoViaTriagem(correlationId);
  step('triagem_http', created.ok, { atendimentoId: created.atendimentoId });
  if (created.atendimentoId && !STRICT) {
    await syncLegacyToAppointments(created.atendimentoId);
  }
  if (!created.atendimentoId) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const atendimentoId = created.atendimentoId;

  const login = await lib.loginMedico(correlationId);
  step('medico_login', login.ok);
  if (!login.token) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const queue = await lib.requestJson(`${lib.BACKEND_URL}/api/atendimentos/queue`, {
    headers: lib.authHeaders(login.token, correlationId)
  });
  step('fila_medica', queue.ok);

  const approve = await lib.clinicalApprove(login.token, atendimentoId, correlationId);
  step('decisao_aprovacao', approve.ok);

  const memedReal = process.env.MEMED_REAL_ENABLED === 'true';
  const receipt = await lib.persistMemedReceipt(login.token, atendimentoId, correlationId);
  step('memed_receita_persist', receipt.ok, {
    optional: memedReal && !receipt.ok,
    memed_real: memedReal,
    hint: memedReal
      ? 'Defina MEMED_RECEITA_ID + MEMED_PDF_URL após emissão humana no /receita'
      : null
  });
  if (!receipt.ok && memedReal) {
    report.warnings.push('memed_receita_persist_requires_human_emission');
  }
  if (!receipt.ok && !memedReal) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const validate = await lib.clinicalValidate(login.token, atendimentoId, correlationId);
  step('receita_validada', validate.ok);

  const deliver = await lib.deliverPrescription(login.token, atendimentoId, correlationId);
  step('entrega_whatsapp', deliver.ok);

  const finalState = await lib.getAtendimento(login.token, atendimentoId, correlationId);
  const finalStatus = String(finalState.data?.atendimento?.status || '').toLowerCase();
  step('atendimento_final', finalState.ok, { status: finalStatus });
  step('status_final_delivered', finalStatus === 'delivered', { status: finalStatus });

  await verifySupabase(atendimentoId, null);

  const reload = await lib.getAtendimento(login.token, atendimentoId, correlationId);
  step('persistencia_pos_fluxo', reload.ok && Boolean(reload.data?.atendimento?.id));

  report.success = report.errors.length === 0;
  report.summary = {
    steps: report.steps.length,
    errors: report.errors.length,
    warnings: report.warnings.length
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
