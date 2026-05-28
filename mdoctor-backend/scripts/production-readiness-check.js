require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { getReadinessReport } = require('../src/config/readiness');

const REQUIRED_TABLES = [
  {
    name: 'atendimentos',
    columns: 'id,status,paciente_nome,dados_clinicos,criado_em,atualizado_em'
  },
  {
    name: 'decisoes_log',
    columns: 'id,atendimento_id,status_anterior,status_novo,medico_id,criado_em'
  },
  {
    name: 'entregas_receita',
    columns: 'id,atendimento_id,canal,provider,status,criado_em'
  },
  {
    name: 'receitas_memed',
    columns: 'id,atendimento_id,receita_id,protocolo,pdf_url,status,medico_id,criado_em'
  },
  {
    name: 'medicos',
    columns: 'id,nome,role,ativo,criado_em'
  }
];

function maskUrl(url = '') {
  return url.replace(/^(https:\/\/)([^.]+)(\..+)$/, '$1$2***$3');
}

function printResult(name, ok, message) {
  const prefix = ok ? 'OK' : 'FAIL';
  console.log(`${prefix} ${name}: ${message}`);
}

function formatSupabaseError(error) {
  if (!error) return 'erro desconhecido';
  return error.message || error.details || error.hint || JSON.stringify(error);
}

async function checkTable(supabase, table) {
  const { error } = await supabase
    .from(table.name)
    .select(table.columns)
    .limit(1);

  return {
    name: table.name,
    ok: !error,
    error: formatSupabaseError(error)
  };
}

async function checkStorage(supabase) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) return { ok: false, error: error.message, buckets: [] };

  const expected = process.env.RECEITAS_BUCKET || process.env.SUPABASE_RECEITAS_BUCKET || '';
  return {
    ok: expected ? data.some((bucket) => bucket.name === expected) : true,
    error: expected ? `Bucket ${expected} nao encontrado` : null,
    buckets: data.map((bucket) => bucket.name),
    expected
  };
}

async function main() {
  const report = getReadinessReport();
  console.log(`Doctor Prescreve production check - ${new Date().toISOString()}`);
  console.log(`Readiness local: ${report.status}`);

  for (const item of report.checks) {
    printResult(`env:${item.name}`, item.ok, item.ok ? 'configurado' : item.message);
  }

  const fallbackDisabled = process.env.DISABLE_LOCAL_DB_FALLBACK === 'true';
  printResult(
    'env:disable_local_db_fallback_strict',
    fallbackDisabled,
    fallbackDisabled ? 'fallback local bloqueado explicitamente' : 'defina DISABLE_LOCAL_DB_FALLBACK=true no ambiente real'
  );

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('FAIL supabase: SUPABASE_URL e service key sao obrigatorios');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Supabase alvo: ${maskUrl(url)}`);

  let failed = report.failures.length + (fallbackDisabled ? 0 : 1);
  let schemaFailed = false;
  for (const table of REQUIRED_TABLES) {
    const result = await checkTable(supabase, table);
    printResult(`table:${table.name}`, result.ok, result.ok ? 'acessivel com colunas esperadas' : result.error);
    if (!result.ok) {
      schemaFailed = true;
      failed += 1;
    }
  }

  const storage = await checkStorage(supabase);
  printResult(
    'storage:buckets',
    storage.ok,
    storage.ok
      ? `acessivel${storage.expected ? `, bucket ${storage.expected} presente` : ''}`
      : storage.error
  );
  if (!storage.ok) {
    schemaFailed = true;
    failed += 1;
  }

  if (failed) {
    if (schemaFailed) {
      console.error('Acao recomendada: execute docs/supabase-upgrade-production.sql no SQL Editor do Supabase e rode este check novamente.');
    } else {
      console.error('Acao recomendada: corrigir variaveis de ambiente de producao e rodar este check novamente.');
    }
    console.error(`Production check falhou com ${failed} pendencia(s).`);
    process.exit(1);
  }

  console.log('Production check OK: ambiente e schema basico prontos.');
}

main().catch((error) => {
  console.error(`Production check erro: ${error.message}`);
  process.exit(1);
});
