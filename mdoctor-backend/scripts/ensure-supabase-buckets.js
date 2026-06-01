#!/usr/bin/env node
/**
 * Cria buckets oficiais via Storage API (quando SQL migration não rodou por DB URL).
 */
require('./load-dotenv');
const { initSupabase, getSupabase } = require('../src/config/supabase');

const BUCKETS = [
  'receitas',
  'uploads',
  'prontuarios',
  'anexos',
  'receitas-antigas',
  'documentos-clinicos'
];

async function main() {
  initSupabase();
  const supabase = getSupabase();
  const results = [];

  const { data: existing, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    console.error(JSON.stringify({ ok: false, error: listError.message }));
    process.exit(1);
  }
  const names = new Set((existing || []).map((b) => b.name || b.id));

  for (const bucket of BUCKETS) {
    if (names.has(bucket)) {
      results.push({ bucket, ok: true, skipped: true });
      continue;
    }
    const { error } = await supabase.storage.createBucket(bucket, { public: false });
    results.push({ bucket, ok: !error, error: error?.message || null });
  }

  const ok = results.every((r) => r.ok);
  console.log(JSON.stringify({ ok, results }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
