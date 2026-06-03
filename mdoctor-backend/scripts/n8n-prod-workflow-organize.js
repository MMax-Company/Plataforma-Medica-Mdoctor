/**
 * Organize n8n production workflows (Postgres direct — n8n Node only).
 *
 * Env: N8N_PROD_DATABASE_URL (required)
 * Flags:
 *   --dry-run  (default if --apply not passed)
 *   --apply    execute mutations
 */

const { Client } = require('pg');

const OFFICIAL_ID = 'P7qhHC4iNgW8sxDJ';
const OFFICIAL_NAME = 'Doctor Prescreve — Typebot Produção';
const APPLY = process.argv.includes('--apply');

const dbUrl = process.env.N8N_PROD_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('N8N_PROD_DATABASE_URL required');
  process.exit(1);
}

function fixWebhookPaths(nodes) {
  let changed = false;
  for (const node of nodes) {
    if (node.type !== 'n8n-nodes-base.webhook') continue;
    const path = node.parameters?.path;
    if (path === 'webhook/typebot-webhook') {
      node.parameters.path = 'typebot-webhook';
      changed = true;
    }
    if (path === 'webhook/zapi-webhook') {
      node.parameters.path = 'zapi-webhook';
      changed = true;
    }
  }
  return changed;
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const all = await client.query(
    `SELECT id, name, active, nodes FROM workflow_entity ORDER BY name`
  );

  const official = all.rows.find((r) => r.id === OFFICIAL_ID);
  if (!official) throw new Error(`Official workflow ${OFFICIAL_ID} not found`);
  if (!official.active) console.warn('WARN: official workflow not active in DB');

  const nodes = typeof official.nodes === 'string' ? JSON.parse(official.nodes) : official.nodes;
  const pathsBefore = nodes
    .filter((n) => n.type === 'n8n-nodes-base.webhook')
    .map((n) => ({ name: n.name, path: n.parameters?.path }));

  const pathChanged = fixWebhookPaths(nodes);

  const toDelete = all.rows.filter((r) => r.id !== OFFICIAL_ID);

  const plan = {
    mode: APPLY ? 'apply' : 'dry-run',
    official: {
      id: OFFICIAL_ID,
      nameBefore: official.name,
      nameAfter: OFFICIAL_NAME,
      active: official.active,
      webhookPathsBefore: pathsBefore,
      webhookPathsAfter: nodes
        .filter((n) => n.type === 'n8n-nodes-base.webhook')
        .map((n) => ({ name: n.name, path: n.parameters?.path })),
      pathChanged
    },
    deleteCount: toDelete.length,
    delete: toDelete.map((r) => ({ id: r.id, name: r.name, active: r.active }))
  };

  if (!APPLY) {
    console.log(JSON.stringify(plan, null, 2));
    await client.end();
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE workflow_entity SET name = $1, nodes = $2::json, "updatedAt" = NOW() WHERE id = $3`,
      [OFFICIAL_NAME, JSON.stringify(nodes), OFFICIAL_ID]
    );

    for (const row of toDelete) {
      await client.query(`DELETE FROM shared_workflow WHERE "workflowId" = $1`, [row.id]).catch(() => {});
      await client.query(`DELETE FROM workflow_history WHERE "workflowId" = $1`, [row.id]).catch(() => {});
      await client.query(`DELETE FROM workflow_entity WHERE id = $1`, [row.id]);
    }

    const wfNodes = await client.query('SELECT nodes FROM workflow_entity WHERE id = $1', [OFFICIAL_ID]);
    const hist = await client.query(
      'UPDATE workflow_history SET nodes = $1::json WHERE "workflowId" = $2',
      [JSON.stringify(wfNodes.rows[0].nodes), OFFICIAL_ID]
    );
    plan.historyRowsSynced = hist.rowCount;

    await client.query('COMMIT');
    console.log(JSON.stringify({ success: true, ...plan }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
