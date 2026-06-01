#!/usr/bin/env node
/**
 * Aplica 20260603_audit_logs_staging_align.sql no Supabase oficial (SUPABASE_DB_URL).
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATION = '20260603_audit_logs_staging_align.sql';

function supabaseProjectRef() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return m ? m[1] : 'usihurogvphtjedyhyfl';
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

function buildConnectionAttempts(dbUrl) {
  const ref = supabaseProjectRef();
  const attempts = [];
  try {
    const parsed = new URL(dbUrl);
    if (parsed.hostname.includes('pooler.supabase.com')) {
      const hosts = new Set([parsed.hostname]);
      if (ref) {
        hosts.add('aws-0-us-west-2.pooler.supabase.com');
        hosts.add('aws-1-us-west-2.pooler.supabase.com');
        hosts.add('aws-0-sa-east-1.pooler.supabase.com');
        hosts.add('aws-1-sa-east-1.pooler.supabase.com');
      }
      for (const host of hosts) {
        const u = new URL(dbUrl);
        u.hostname = host;
        u.port = '5432';
        if (ref) u.username = `postgres.${ref}`;
        attempts.push(u.toString());
      }
    } else {
      attempts.push(normalizeDbUrl(dbUrl));
    }
    if (ref) {
      const direct = new URL(dbUrl);
      direct.hostname = `db.${ref}.supabase.co`;
      direct.port = '5432';
      direct.username = 'postgres';
      attempts.push(direct.toString());
    }
  } catch {
    attempts.push(dbUrl);
  }
  return [...new Set(attempts)];
}

async function connectClient(dbUrl) {
  let lastError;
  for (const connectionString of buildConnectionAttempts(dbUrl)) {
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      return { client, connectedVia: connectionString.replace(/:[^:@]+@/, ':***@') };
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastError || new Error('connection_failed');
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(JSON.stringify({ ok: false, error: 'SUPABASE_DB_URL missing' }));
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, '../supabase/migrations', MIGRATION);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const { client, connectedVia } = await connectClient(dbUrl);

  const colsQuery = `
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'audit_logs'
    order by ordinal_position
  `;
  const before = await client.query(colsQuery);
  await client.query(sql);
  const after = await client.query(colsQuery);
  await client.end();

  console.log(
    JSON.stringify(
      {
        ok: true,
        migration: MIGRATION,
        project_ref: supabaseProjectRef(),
        connected_via: connectedVia,
        columns_before: before.rows,
        columns_after: after.rows
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
