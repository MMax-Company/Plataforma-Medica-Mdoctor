#!/usr/bin/env node
const { Client } = require('pg');
const id = process.argv[2] || 'ECa8PdrXeVk64sml';
const url = process.env.N8N_STAGING_DATABASE_URL || process.env.N8N_PROD_DATABASE_URL;
if (!url) process.exit(1);

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(
    'SELECT id, name, active, nodes, connections FROM workflow_entity WHERE id = $1',
    [id]
  );
  const wf = r.rows[0];
  const nodes = typeof wf.nodes === 'string' ? JSON.parse(wf.nodes) : wf.nodes;
  const conn = typeof wf.connections === 'string' ? JSON.parse(wf.connections) : wf.connections;
  const wh = nodes.find((n) => n.name === 'Webhook Typebot');
  console.log(
    JSON.stringify(
      {
        id: wf.id,
        name: wf.name,
        active: wf.active,
        node_names: nodes.map((n) => n.name),
        webhook: { responseMode: wh?.parameters?.responseMode, path: wh?.parameters?.path },
        respond_nodes: nodes
          .filter((n) => (n.type || '').includes('respondToWebhook'))
          .map((n) => ({
            name: n.name,
            respondWith: n.parameters?.respondWith,
            bodyPreview: String(n.parameters?.responseBody || '').slice(0, 100)
          })),
        wrap_to: conn?.['Wrap Response']?.main?.[0]?.[0]?.node
      },
      null,
      2
    )
  );
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
