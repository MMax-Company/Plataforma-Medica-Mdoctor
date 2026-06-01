#!/usr/bin/env node
/**
 * Aplica todas as migrations Supabase em ordem (requer SUPABASE_DB_URL ou DATABASE_URL).
 * Uso: LOAD_RAILWAY_VARS=1 node mdoctor-backend/scripts/apply-supabase-migrations-all.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MIGRATIONS = [
  '20260527_backend_mvp_storage.sql',
  '20260528_receitas_anteriores_bucket.sql',
  '20260529_clinical_receipt_status_flow.sql',
  '20260530_webhook_events_idempotency.sql',
  '20260601_doctor_prescreve_production_official.sql',
  '20260602_fechamento_stripe_payments_idempotency.sql'
];

const RAILWAY_PROJECT = process.env.RAILWAY_PROJECT_ID || 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const RAILWAY_ENV = process.env.RAILWAY_ENVIRONMENT_ID || 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const RAILWAY_SERVICE = process.env.RAILWAY_SERVICE_ID || '53960eb4-a1be-4d7c-b665-462049e52085';

function loadRailwayVars() {
  if (process.env.LOAD_RAILWAY_VARS !== '1') return;
  const out = execSync(
    `railway variable list -p ${RAILWAY_PROJECT} -e ${RAILWAY_ENV} -s ${RAILWAY_SERVICE} --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  for (const [key, value] of Object.entries(JSON.parse(out))) {
    if (value != null && value !== '') process.env[key] = String(value);
  }
}

async function main() {
  loadRailwayVars();
  const dbUrl =
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_DATABASE_URL;

  if (!dbUrl) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'Defina SUPABASE_DB_URL ou DATABASE_URL (Dashboard Supabase → Settings → Database → Connection string)'
      })
    );
    process.exit(1);
  }

  let Client;
  try {
    Client = require('pg').Client;
  } catch {
    console.error(JSON.stringify({ ok: false, error: 'Instale pg: npm install pg --save-dev' }));
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const applied = [];

  try {
    for (const file of MIGRATIONS) {
      const sqlPath = path.join(__dirname, '../supabase/migrations', file);
      if (!fs.existsSync(sqlPath)) {
        applied.push({ file, skipped: true, reason: 'not_found' });
        continue;
      }
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await client.query(sql);
      applied.push({ file, ok: true });
    }
    console.log(JSON.stringify({ ok: true, applied }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
