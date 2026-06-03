/** Sync workflow_history.nodes from workflow_entity for active production workflow */
const { Client } = require('pg');
const ID = 'P7qhHC4iNgW8sxDJ';
const dbUrl = process.env.N8N_PROD_DATABASE_URL;
if (!dbUrl) {
  console.error('N8N_PROD_DATABASE_URL required');
  process.exit(1);
}
(async () => {
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const wf = await c.query('SELECT nodes FROM workflow_entity WHERE id = $1', [ID]);
  const nodes = wf.rows[0].nodes;
  const r = await c.query(
    'UPDATE workflow_history SET nodes = $1::json WHERE "workflowId" = $2',
    [JSON.stringify(nodes), ID]
  );
  console.log(JSON.stringify({ workflowId: ID, historyRowsUpdated: r.rowCount }));
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
