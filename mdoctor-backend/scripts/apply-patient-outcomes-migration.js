#!/usr/bin/env node
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATION = '20260607_patient_outcomes.sql';

function supabaseProjectRef() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return m ? m[1] : null;
}

function normalizeDbUrl(dbUrl) {
  const ref = supabaseProjectRef();
  if (!dbUrl || !ref) return dbUrl;
  try {
    const url = new URL(dbUrl);
    if (url.hostname.includes('pooler.supabase.com') && url.username === 'postgres') {
      url.username = `postgres.${ref}`;
    }
    return url.toString();
  } catch {
    return dbUrl;
  }
}

async function main() {
  const dbUrl = normalizeDbUrl(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '');
  if (!dbUrl) {
    console.error(JSON.stringify({ ok: false, error: 'SUPABASE_DB_URL missing' }));
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, '../supabase/migrations', MIGRATION);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  const columns = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'patient_outcomes'
    order by ordinal_position
  `);
  await client.end();

  console.log(
    JSON.stringify(
      {
        ok: true,
        migration: MIGRATION,
        columns: columns.rows.map((row) => row.column_name)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
