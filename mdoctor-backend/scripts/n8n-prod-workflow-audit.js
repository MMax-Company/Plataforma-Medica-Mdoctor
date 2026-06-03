/**
 * Read-only audit of n8n production workflows via Postgres (no mutations).
 * Usage:
 *   N8N_PROD_DATABASE_URL=postgresql://... node mdoctor-backend/scripts/n8n-prod-workflow-audit.js
 */

const { Client } = require('pg');

const dbUrl = process.env.N8N_PROD_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('N8N_PROD_DATABASE_URL or DATABASE_URL required');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'workflow_entity' ORDER BY 1`
  );

  const workflows = await client.query(
    `SELECT id, name, active, "versionId", "activeVersionId", "createdAt", "updatedAt"
     FROM workflow_entity
     ORDER BY name`
  );

  const webhooks = await client.query(
    `SELECT w."workflowId", w.method, w.path, w."webhookPath", w."webhookId", wf.name AS workflow_name, wf.active
     FROM webhook_entity w
     LEFT JOIN workflow_entity wf ON wf.id = w."workflowId"
     ORDER BY wf.name, w.path`
  ).catch(async () => {
    // n8n 2.x may store webhooks only inside workflow nodes
    return { rows: [] };
  });

  const withPaths = [];
  for (const row of workflows.rows) {
    const detail = await client.query(
      `SELECT nodes FROM workflow_entity WHERE id = $1`,
      [row.id]
    );
    const nodes = detail.rows[0]?.nodes || [];
    const hookNodes = nodes.filter(
      (n) => n.type === 'n8n-nodes-base.webhook' || String(n.type || '').includes('webhook')
    );
    const paths = hookNodes.map((n) => ({
      nodeName: n.name,
      path: n.parameters?.path,
      httpMethod: n.parameters?.httpMethod,
      webhookId: n.webhookId
    }));
    withPaths.push({ ...row, webhookNodes: paths });
  }

  console.log(
    JSON.stringify(
      {
        workflowCount: workflows.rows.length,
        workflows: withPaths,
        webhookEntityRows: webhooks.rows
      },
      null,
      2
    )
  );

  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
