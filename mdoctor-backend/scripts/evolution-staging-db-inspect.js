#!/usr/bin/env node
const { Client } = require('pg');

const uri = process.env.DATABASE_PUBLIC_URL;
if (!uri) {
  console.error('DATABASE_PUBLIC_URL required');
  process.exit(1);
}

async function main() {
  const c = new Client({ connectionString: uri, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const table of ['Instance', 'Setting', 'Webhook', 'IntegrationSession']) {
    try {
      const r = await c.query(`SELECT * FROM "${table}" LIMIT 20`);
      console.log(table, r.rowCount, r.rows);
    } catch (e) {
      console.log(table, 'err', e.message);
    }
  }
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
