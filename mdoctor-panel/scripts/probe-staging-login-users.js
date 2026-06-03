#!/usr/bin/env node
/** Testa login staging com MEDICO_PASS local (não imprime senha). */
const fs = require('fs');
const path = require('path');

const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';
const envLocal = path.join(__dirname, '../../mdoctor-backend/.env.local');
let pass = process.env.MEDICO_PASS || '';

if (!pass && fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^MEDICO_PASS=(.*)$/);
    if (m) pass = m[1].trim().replace(/^["']|["']$/g, '');
  }
}

const users = ['drmax.matos', process.env.MEDICO_USER || 'admin'].filter((v, i, a) => a.indexOf(v) === i);

async function tryLogin(user) {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, password: pass }),
  });
  return { user, status: res.status, ok: res.status === 200 };
}

async function main() {
  if (!pass) {
    console.error('MEDICO_PASS ausente');
    process.exit(1);
  }
  const results = await Promise.all(users.map(tryLogin));
  console.log(JSON.stringify({ hasPass: Boolean(pass), results }, null, 2));
  process.exit(results.some((r) => r.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
