#!/usr/bin/env node
/**
 * Aplica todas as migrations Supabase em ordem (requer SUPABASE_DB_URL ou DATABASE_URL).
 * Uso: LOAD_RAILWAY_VARS=1 node mdoctor-backend/scripts/apply-supabase-migrations-all.js
 */
require('./load-dotenv');
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

function supabaseProjectRef() {
  const url = process.env.SUPABASE_URL || '';
  const m = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (m) return m[1];
  const dbUrl =
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    '';
  const userMatch = dbUrl.match(/\/\/postgres\.([a-z0-9]+):/i);
  if (userMatch) return userMatch[1];
  const hostMatch = dbUrl.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  if (hostMatch) return hostMatch[1];
  return '';
}

/** Pooler exige usuário postgres.<project_ref> — corrige URI copiada só com "postgres". */
function normalizeDbUrl(dbUrl) {
  if (!dbUrl) return dbUrl;
  const ref = supabaseProjectRef();
  if (!ref) return dbUrl;
  try {
    const url = new URL(dbUrl);
    if (
      url.hostname.includes('pooler.supabase.com') &&
      (url.username === 'postgres' || url.username === 'postgres.')
    ) {
      url.username = `postgres.${ref}`;
      return url.toString();
    }
    if (url.hostname === `db.${ref}.supabase.co` && url.username === 'postgres') {
      return url.toString();
    }
  } catch {
    return dbUrl;
  }
  return dbUrl;
}

function loadRailwayVars() {
  if (process.env.LOAD_RAILWAY_VARS !== '1') return;
  const out = execSync(
    `railway variable list -p ${RAILWAY_PROJECT} -e ${RAILWAY_ENV} -s ${RAILWAY_SERVICE} --json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  );
  for (const [key, value] of Object.entries(JSON.parse(out))) {
    if (value != null && value !== '' && !process.env[key]) process.env[key] = String(value);
  }
}

async function main() {
  loadRailwayVars();
  const dbUrl = normalizeDbUrl(
    process.env.SUPABASE_DB_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.SUPABASE_DATABASE_URL
  );

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

  const connectionAttempts = [];
  const ref = supabaseProjectRef();
  try {
    const parsed = new URL(dbUrl);
    if (parsed.hostname.includes('pooler.supabase.com')) {
      const poolerHosts = new Set([parsed.hostname]);
      if (ref) {
        poolerHosts.add('aws-0-us-west-2.pooler.supabase.com');
        poolerHosts.add('aws-1-us-west-2.pooler.supabase.com');
        poolerHosts.add('aws-0-sa-east-1.pooler.supabase.com');
        poolerHosts.add('aws-1-sa-east-1.pooler.supabase.com');
      }
      for (const host of poolerHosts) {
        const sessionPooler = new URL(dbUrl);
        sessionPooler.hostname = host;
        sessionPooler.port = '5432';
        if (ref) sessionPooler.username = `postgres.${ref}`;
        connectionAttempts.push(sessionPooler.toString());
      }
      if (parsed.port !== '5432') connectionAttempts.push(normalizeDbUrl(dbUrl));
    } else {
      connectionAttempts.push(dbUrl);
    }
    if (ref) {
      const direct = new URL(dbUrl);
      direct.hostname = `db.${ref}.supabase.co`;
      direct.port = '5432';
      direct.username = 'postgres';
      connectionAttempts.push(direct.toString());
    }
  } catch {
    connectionAttempts.push(dbUrl);
  }
  if (!connectionAttempts.length) connectionAttempts.push(dbUrl);

  let client;
  let connectedVia = null;
  let lastError = null;
  for (const connectionString of connectionAttempts) {
    const candidate = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    try {
      await candidate.connect();
      client = candidate;
      try {
        const u = new URL(connectionString);
        connectedVia = `${u.hostname}:${u.port || '5432'}`;
      } catch {
        connectedVia = 'connected';
      }
      break;
    } catch (error) {
      lastError = error;
      try {
        await candidate.end();
      } catch {
        /* ignore */
      }
    }
  }

  if (!client) {
    console.error(JSON.stringify({ ok: false, error: lastError?.message || 'connection_failed' }));
    process.exit(1);
  }

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
    console.log(JSON.stringify({ ok: true, connected_via: connectedVia, project_ref: supabaseProjectRef(), applied }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
