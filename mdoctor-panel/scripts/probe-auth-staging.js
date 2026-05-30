#!/usr/bin/env node
/** Probe auth endpoints on Railway staging */
const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';
const PANEL = 'https://painel-medico-staging-staging.up.railway.app';

async function probe(name, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text.slice(0, 200);
  }
  console.log(`\n=== ${name} ===`);
  console.log('URL:', url);
  console.log('Status:', res.status);
  console.log('Body:', json);
}

async function main() {
  const creds = { user: 'drmax.matos', username: 'drmax.matos', email: 'drmax.matos', password: 'Gr@tid@0' };
  await probe('Backend drmax.matos', `${BACKEND}/api/auth/login`, creds);
  await probe('Backend staging-doctor (old)', `${BACKEND}/api/auth/login`, {
    user: 'staging-doctor',
    username: 'staging-doctor',
    password: process.env.STAGING_DOCTOR_PASS || 'wrong',
  });
  await probe('Panel proxy /api/auth/login drmax', `${PANEL}/api/auth/login`, creds);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
