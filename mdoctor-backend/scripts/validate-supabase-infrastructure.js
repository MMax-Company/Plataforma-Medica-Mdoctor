#!/usr/bin/env node
/**
 * Valida schema Supabase oficial: tabelas, buckets, ping.
 */
require('./load-dotenv');

const { initSupabase, pingSupabase, getSupabaseBuckets } = require('../src/config/supabase');
const T = require('../src/db/tables');

const REQUIRED_TABLES = [
  T.APPOINTMENTS,
  T.PATIENTS,
  T.TRIAGE_SESSIONS,
  T.TRIAGE_ANSWERS,
  T.MEDICAL_RECORDS,
  T.MEDICAL_DECISIONS,
  T.PAYMENTS,
  T.PAYMENT_EVENTS,
  T.PRESCRIPTIONS,
  T.PRESCRIPTION_DELIVERY,
  T.SUPPORT_TICKETS,
  T.WHATSAPP_MESSAGES,
  T.WHATSAPP_SESSIONS,
  T.N8N_EVENTS,
  T.TYPEBOT_SESSIONS,
  T.AUDIT_LOGS,
  T.INTEGRATION_LOGS,
  T.ERROR_LOGS
];

const REQUIRED_BUCKETS = [
  'receitas',
  'uploads',
  'prontuarios',
  'anexos',
  'receitas-antigas',
  'documentos-clinicos'
];

async function main() {
  initSupabase();
  const report = { ok: true, tables: [], buckets: [], ping: null, errors: [] };

  const ping = await pingSupabase();
  report.ping = ping;
  if (!ping.responding) {
    report.ok = false;
    report.errors.push('supabase_ping_failed');
  }

  const { getSupabase } = require('../src/config/supabase');
  const supabase = getSupabase();

  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select('id', { count: 'exact', head: true }).limit(1);
    const entry = { table, ok: !error, error: error?.message || null };
    report.tables.push(entry);
    if (error) {
      report.ok = false;
      report.errors.push(`table:${table}`);
    }
  }

  const { data: bucketList, error: bucketError } = await supabase.storage.listBuckets();
  if (bucketError) {
    report.ok = false;
    report.errors.push('buckets_list_failed');
    report.buckets.push({ ok: false, error: bucketError.message });
  } else {
    const names = new Set((bucketList || []).map((b) => b.name || b.id));
    for (const bucket of REQUIRED_BUCKETS) {
      const ok = names.has(bucket);
      report.buckets.push({ bucket, ok });
      if (!ok) {
        report.ok = false;
        report.errors.push(`bucket:${bucket}`);
      }
    }
  }

  report.configured_buckets = getSupabaseBuckets();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
