#!/usr/bin/env node
const { Client } = require('pg');

const url = process.env.N8N_STAGING_DATABASE_URL || process.env.DATABASE_PUBLIC_URL || '';
if (!url) {
  console.error('N8N_STAGING_DATABASE_URL or DATABASE_PUBLIC_URL required');
  process.exit(1);
}

async function main() {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const wf = await c.query(
    `SELECT id, name, active FROM workflow_entity WHERE active = true ORDER BY name`
  );

  const hooks = await c.query(
    `SELECT w."workflowId", w."webhookPath", w.method, w.node, e.name AS workflow_name, e.active
     FROM webhook_entity w
     JOIN workflow_entity e ON e.id = w."workflowId"
     WHERE w."webhookPath" = 'typebot-webhook'
     ORDER BY e.active DESC, e.name`
  );

  const stagingNamed = await c.query(
    `SELECT id, name, active FROM workflow_entity
     WHERE name ILIKE '%staging%' OR name ILIKE '%Typebot Webhook%'
     ORDER BY active DESC, name`
  );

  const activeHooks = hooks.rows.filter((r) => r.active);
  const correct = stagingNamed.rows.find((r) => r.name === 'Typebot Webhook - Staging');

  console.log(
    JSON.stringify(
      {
        active_workflows: wf.rows,
        typebot_webhook_registrations: hooks.rows,
        staging_named_workflows: stagingNamed.rows,
        duplicate_active_same_path: activeHooks.length,
        runtime_owner:
          activeHooks.length === 1
            ? { id: activeHooks[0].workflowId, name: activeHooks[0].workflow_name }
            : activeHooks,
        correct_workflow_present: Boolean(correct),
        correct_workflow_active: correct?.active === true
      },
      null,
      2
    )
  );

  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
