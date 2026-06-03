#!/usr/bin/env node
const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';
const PANEL = 'https://painel-medico-staging-staging.up.railway.app';

async function corsPreflight() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: PANEL,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,authorization',
    },
  });
  console.log('OPTIONS status:', res.status);
  console.log('ACAO:', res.headers.get('access-control-allow-origin'));
  console.log('ACAM:', res.headers.get('access-control-allow-methods'));
}

async function loginWithOrigin() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: PANEL,
    },
    body: JSON.stringify({
      user: process.env.MEDICO_USER || 'drmax.matos',
      username: process.env.MEDICO_USER || 'drmax.matos',
      password: process.env.MEDICO_PASS || '',
    }),
  });
  console.log('\nPOST status:', res.status);
  console.log('ACAO:', res.headers.get('access-control-allow-origin'));
  console.log('Body:', await res.text());
}

Promise.all([corsPreflight(), loginWithOrigin()]).catch(console.error);
