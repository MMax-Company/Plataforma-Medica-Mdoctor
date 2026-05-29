/**
 * Deploy workflow JSON to n8n production via Postgres (when Public API key unavailable).
 *
 * Usage:
 *   N8N_PROD_DATABASE_URL=... node scripts/n8n-prod-deploy-workflow-json.js \
 *     --workflow-id VUDBmF4REtrj6ZJU \
 *     --file ../docs/n8n-workflows/typebot-webhook-staging.json
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { validateWorkflowContent } = require('./lib/n8n-deploy-validate');

const args = process.argv.slice(2);
function arg(name, fallback = '') {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const workflowId = arg('--workflow-id', process.env.N8N_WORKFLOW_ID || 'VUDBmF4REtrj6ZJU');
const file = arg(
  '--file',
  process.env.N8N_WORKFLOW_FILE ||
    path.join(__dirname, '../../docs/n8n-workflows/typebot-webhook-staging.json')
);
const dbUrl = process.env.N8N_PROD_DATABASE_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('N8N_PROD_DATABASE_URL required');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

(async () => {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const before = await client.query(
    'SELECT id, name, active, nodes FROM workflow_entity WHERE id = $1',
    [workflowId]
  );
  if (!before.rows[0]) throw new Error(`Workflow ${workflowId} not found`);

  const nodes = payload.nodes;
  const connections = payload.connections;
  const settings = payload.settings || {};

  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE workflow_entity
       SET name = $1, nodes = $2::json, connections = $3::json, settings = $4::json, "updatedAt" = NOW(), active = true
       WHERE id = $5`,
      [payload.name, JSON.stringify(nodes), JSON.stringify(connections), JSON.stringify(settings), workflowId]
    );

    const hist = await client.query(
      'UPDATE workflow_history SET nodes = $1::json, connections = $2::json WHERE "workflowId" = $3',
      [JSON.stringify(nodes), JSON.stringify(connections), workflowId]
    );

    await client.query('COMMIT');

    const after = await client.query(
      'SELECT id, name, active, nodes, connections FROM workflow_entity WHERE id = $1',
      [workflowId]
    );
    const row = after.rows[0];
    const check = validateWorkflowContent(
      {
        nodes: typeof row.nodes === 'string' ? JSON.parse(row.nodes) : row.nodes,
        connections: typeof row.connections === 'string' ? JSON.parse(row.connections) : row.connections
      },
      payload
    );

    console.log(
      JSON.stringify(
        {
          success: true,
          workflowId,
          name: row.name,
          active: row.active,
          historyRowsSynced: hist.rowCount,
          validation: check
        },
        null,
        2
      )
    );

    if (!check.ok) process.exit(1);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  await client.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
