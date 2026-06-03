#!/usr/bin/env node
/**
 * Obtém N8N_API_KEY válida para n8n-staging (login owner → criar API key).
 * Não imprime senhas. Grava em docker/n8n.staging.env (gitignored) se CREATE_ENV=1.
 */
const fs = require('fs');
const path = require('path');

const base = String(process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(
  /\/$/,
  ''
);

const emails = [
  process.env.N8N_OWNER_EMAIL,
  process.env.N8N_BASIC_AUTH_USER && process.env.N8N_BASIC_AUTH_USER.includes('@')
    ? process.env.N8N_BASIC_AUTH_USER
    : null,
  'marketing.cvl.ia@gmail.com',
  'staging-n8n@example.com',
  'admin@doctorprescreve.com'
].filter(Boolean);

const passwords = [
  process.env.N8N_OWNER_PASSWORD,
  process.env.N8N_BASIC_AUTH_PASSWORD,
  'Mais@m0r',
  'TempPass123!',
  'Gr@tid@0'
].filter(Boolean);

function unique(arr) {
  return [...new Set(arr)];
}

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw
    .split(',')
    .map((p) => p.trim().split(';')[0])
    .filter(Boolean)
    .join('; ');
}

async function tryLogin(email, password) {
  const res = await fetch(`${base}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrLdapLoginId: email, password })
  });
  const cookie = cookieFrom(res);
  if (!cookie || res.status >= 400) return null;
  return cookie;
}

async function createApiKey(cookie) {
  const attempts = [
    { url: `${base}/api/v1/api-keys`, body: { label: `deploy-staging-${Date.now()}` } },
    { url: `${base}/rest/api-keys`, body: { label: `deploy-staging-${Date.now()}` } }
  ];
  for (const { url, body } of attempts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    const key =
      data?.data?.apiKey ||
      data?.apiKey ||
      data?.data?.rawApiKey ||
      data?.rawApiKey ||
      data?.key;
    if (res.ok && key) return key;
  }
  return null;
}

async function verifyKey(apiKey) {
  const res = await fetch(`${base}/api/v1/workflows?limit=1`, {
    headers: { 'X-N8N-API-KEY': apiKey }
  });
  return res.ok;
}

async function main() {
  const existing = String(process.env.N8N_API_KEY || '').trim();
  if (existing && (await verifyKey(existing))) {
    console.log(JSON.stringify({ ok: true, source: 'env', verified: true }, null, 2));
    return;
  }

  for (const email of unique(emails)) {
    for (const password of unique(passwords)) {
      const cookie = await tryLogin(email, password);
      if (!cookie) continue;
      const key = await createApiKey(cookie);
      if (key && (await verifyKey(key))) {
        const outPath = path.join(__dirname, '../../docker/n8n.staging.env');
        if (process.env.WRITE_N8N_STAGING_ENV === '1') {
          fs.writeFileSync(
            outPath,
            `# gerado ${new Date().toISOString()} — não commitar\nN8N_BASE_URL=${base}\nN8N_API_KEY=${key}\n`,
            'utf8'
          );
        }
        console.log(
          JSON.stringify(
            { ok: true, source: 'created', email, written: process.env.WRITE_N8N_STAGING_ENV === '1' ? outPath : false },
            null,
            2
          )
        );
        console.log(key);
        return;
      }
    }
  }

  console.error(
    JSON.stringify(
      {
        ok: false,
        error: 'Não foi possível obter N8N_API_KEY. Defina N8N_API_KEY ou N8N_OWNER_EMAIL/N8N_OWNER_PASSWORD válidos.'
      },
      null,
      2
    )
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
