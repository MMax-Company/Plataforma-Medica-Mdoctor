#!/usr/bin/env node
/**
 * Alinha clientName das instâncias Evolution ao DATABASE_CONNECTION_CLIENT_NAME atual.
 */
const { Client } = require('pg');

const uri = process.env.DATABASE_PUBLIC_URL;
const targetClient = process.env.DATABASE_CONNECTION_CLIENT_NAME || 'evolution_exchange';
const keepName = process.env.EVOLUTION_INSTANCE || 'mdoctor-staging';

if (!uri) {
  console.error('DATABASE_PUBLIC_URL obrigatório');
  process.exit(1);
}

async function main() {
  const c = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const before = await c.query('SELECT id, name, "clientName" FROM "Instance"');
  console.log('before', before.rows);

  await c.query('UPDATE "Instance" SET "clientName" = $1', [targetClient]);
  console.log('updated clientName ->', targetClient);

  const remove = before.rows.filter((r) => r.name !== keepName);
  for (const row of remove) {
    await c.query('DELETE FROM "Webhook" WHERE "instanceId" = $1', [row.id]);
    await c.query('DELETE FROM "Setting" WHERE "instanceId" = $1', [row.id]);
    await c.query('DELETE FROM "Instance" WHERE id = $1', [row.id]);
    console.log('removed', row.name);
  }

  const after = await c.query('SELECT id, name, "clientName" FROM "Instance"');
  console.log('after', after.rows);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
