#!/usr/bin/env node
/**
 * Aplica migration de status clínico no Supabase staging (via DATABASE_URL / SUPABASE_DB_URL).
 * Não imprime secrets.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
    console.error(JSON.stringify({ ok: false, error: 'SUPABASE_DB_URL/DATABASE_URL ausente no Railway staging' }));
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, '../supabase/migrations/20260529_clinical_receipt_status_flow.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const { Client } = require('pg');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    const probe = await client.query(
      "update atendimentos set status = 'approved' where id = (select id from atendimentos limit 1) returning status"
    );
    await client.query('rollback');
    console.log(
      JSON.stringify({
        ok: true,
        migration: path.basename(sqlPath),
        probe_rows: probe.rowCount
      })
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
