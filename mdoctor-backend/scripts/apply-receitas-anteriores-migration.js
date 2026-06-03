#!/usr/bin/env node
/**
 * Aplica bucket receitas-anteriores no Supabase atual (service role).
 * Policies SQL: executar migration no SQL Editor se listBuckets/upload falhar por policy.
 */
require('./load-dotenv');

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const PROJECT_REF = 'thbwoogytwcidxrrboym';
const BUCKET = process.env.SUPABASE_BUCKET_RECEITAS_ANTERIORES || 'receitas-anteriores';

async function main() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

  if (!url.includes(PROJECT_REF)) {
    console.error(`SUPABASE_URL deve apontar para ${PROJECT_REF}`);
    process.exit(1);
  }
  if (!key) {
    console.error('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SERVICE_KEY obrigatório');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const report = { project: PROJECT_REF, bucket: BUCKET, steps: [] };

  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    report.steps.push({ step: 'list_buckets', ok: false, error: listErr.message });
  } else {
    const exists = (buckets || []).some((b) => b.id === BUCKET || b.name === BUCKET);
    report.steps.push({ step: 'list_buckets', ok: true, exists });
    if (!exists) {
      const { error: createErr } = await supabase.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: 10485760
      });
      report.steps.push({
        step: 'create_bucket',
        ok: !createErr,
        error: createErr?.message || null
      });
    } else {
      report.steps.push({ step: 'create_bucket', ok: true, skipped: true });
    }
  }

  const testPath = `atendimentos/migration-test/receita-anterior-${Date.now()}.txt`;
  const body = Buffer.from('mdoctor migration probe');
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(testPath, body, {
    contentType: 'text/plain',
    upsert: true
  });
  report.steps.push({ step: 'upload_probe', ok: !upErr, path: testPath, error: upErr?.message || null });

  if (!upErr) {
    const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(testPath, 120);
    report.steps.push({
      step: 'signed_url_probe',
      ok: !signErr && Boolean(signed?.signedUrl),
      error: signErr?.message || null
    });
    await supabase.storage.from(BUCKET).remove([testPath]).catch(() => {});
  }

  const migrationPath = path.join(__dirname, '../supabase/migrations/20260528_receitas_anteriores_bucket.sql');
  report.migration_sql_file = migrationPath;
  report.migration_sql_present = fs.existsSync(migrationPath);
  report.policies_note =
    'Service role bypassa RLS. Para auditoria, cole o SQL da migration no SQL Editor se políticas explícitas forem exigidas.';

  const failed = report.steps.filter((s) => s.ok === false);
  report.success = failed.length === 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
