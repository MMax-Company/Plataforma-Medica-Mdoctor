#!/usr/bin/env node
const { execSync } = require('child_process');
const { Client } = require('pg');

const PROJECT = 'fe962e4e-4c41-4c94-9d2d-dbdfe37d0ed4';
const ENV = 'staging';
const POSTGRES_SERVICE = '526f76d8-a686-4127-b1cc-85e4f553b5b1';
const N8N_BASE = 'https://n8n-staging-staging-2dfe.up.railway.app';

async function probeWebhook(path) {
  const res = await fetch(`${N8N_BASE}/webhook/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audit: true })
  });
  let body;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { path, status: res.status, registered: res.status !== 404, message: body.message || null };
}

async function main() {
  const vars = JSON.parse(
    execSync(`railway variable list -p ${PROJECT} -e ${ENV} -s ${POSTGRES_SERVICE} --json`, { encoding: 'utf8' })
  );
  const dbUrl = vars.DATABASE_PUBLIC_URL || vars.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_PUBLIC_URL missing');

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const databases = await client.query(
    'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname'
  );
  const tables = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name ILIKE '%workflow%' OR table_name ILIKE '%webhook%'
    ORDER BY 1, 2
  `);

  let workflows = { rows: [] };
  let webhooks = { rows: [] };
  let activeWorkflows = { rows: [] };
  const hasN8nTables = tables.rows.some((row) => row.table_name === 'workflow_entity');

  if (hasN8nTables) {
    workflows = await client.query(`
      SELECT id, name, active, "createdAt", "updatedAt"
      FROM workflow_entity
      WHERE name ILIKE '%staging%'
         OR name ILIKE '%Typebot Webhook%'
         OR name ILIKE '%Evolution Webhook%'
      ORDER BY name
    `);

    webhooks = await client.query(`
      SELECT w."workflowId", w."webhookPath", w.method, w.node, e.name AS workflow_name, e.active
      FROM webhook_entity w
      JOIN workflow_entity e ON e.id = w."workflowId"
      WHERE w."webhookPath" = 'typebot-webhook'
         OR w."webhookPath" = 'evolution-webhook'
         OR w."webhookPath" LIKE 'evolution-webhook/%'
      ORDER BY w."webhookPath", e.active DESC, e.name
    `);

    activeWorkflows = await client.query(`
      SELECT id, name, active FROM workflow_entity WHERE active = true ORDER BY name
    `);
  }

  await client.end();

  const live = {
    typebot: await probeWebhook('typebot-webhook'),
    evolution: await probeWebhook('evolution-webhook')
  };

  const expected = [
    {
      endpoint: 'POST /webhook/typebot-webhook',
      workflow_esperado: 'Typebot Webhook - Staging',
      repo: 'docs/n8n-workflows/typebot-webhook-staging.json'
    },
    {
      endpoint: 'POST /webhook/evolution-webhook',
      workflow_esperado: 'Evolution Webhook - Staging',
      repo: 'docs/n8n-workflows/evolution-webhook-staging.json'
    }
  ];

  const audit = expected.map((item) => {
    const dbMatch = workflows.rows.find((w) => w.name === item.workflow_esperado);
    const hookRows = webhooks.rows.filter(
      (h) =>
        h.webhookpath === item.endpoint.split('/webhook/')[1] ||
        h.webhookPath === item.endpoint.split('/webhook/')[1]
    );
    const liveProbe = item.endpoint.includes('typebot') ? live.typebot : live.evolution;
    return {
      ...item,
      workflow_encontrado: dbMatch ? { id: dbMatch.id, name: dbMatch.name, active: dbMatch.active } : null,
      workflow_ausente: !dbMatch,
      workflow_inativo: dbMatch ? dbMatch.active === false : null,
      webhooks_no_banco: hookRows.map((h) => ({
        path: h.webhookPath || h.webhookpath,
        workflow_name: h.workflow_name,
        active: h.active,
        node: h.node
      })),
      endpoint_atual: `${N8N_BASE}${item.endpoint.replace('POST ', '')}`,
      endpoint_resposta_http: liveProbe
    };
  });

  console.log(
    JSON.stringify(
      {
        n8n_base: N8N_BASE,
        workflows_no_banco: workflows.rows,
        webhooks_no_banco: webhooks.rows,
        workflows_ativos_no_banco: activeWorkflows.rows,
        postgres_note: hasN8nTables
          ? 'tabelas n8n encontradas no Postgres staging'
          : 'workflow_entity ausente — n8n provavelmente usa armazenamento interno/SQLite no container',
        postgres_databases: databases.rows.map((row) => row.datname),
        postgres_matching_tables: tables.rows,
        audit_endpoints_criticos: audit,
        credenciais_api: {
          n8n_api_key_no_railway: 'presente_mas_401_na_api',
          owner_login: 'falhou_credenciais_conhecidas'
        },
        acao_ativacao: 'nao_executada_ausencia_credencial_owner_valida'
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
