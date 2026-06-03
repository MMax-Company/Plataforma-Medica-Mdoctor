#!/usr/bin/env node
const PANEL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || '';

const issues = [];
const ok = [];

async function get(url, opts = {}) {
  const res = await fetch(url, { ...opts, redirect: 'manual' });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data, text };
}

async function main() {
  if (!PASS) {
    console.log(JSON.stringify({ deploy_aplicado: false, error: 'MEDICO_PASS not set' }, null, 2));
    process.exit(1);
  }

  for (const path of ['/login', '/fila', '/dashboard']) {
    const r = await get(`${PANEL}${path}`);
    if (r.status === 200) ok.push(`panel ${path} → 200`);
    else issues.push(`panel ${path} → ${r.status}`);
  }

  const login = await get(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  });
  const loginOk = login.status === 200 && login.data?.success && login.data?.token;
  if (loginOk) ok.push('login drmax.matos → OK');
  else issues.push(`login → ${login.status}`);

  const bad = await get(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'admin', password: 'admin123' }),
  });
  if (bad.status === 401 || bad.status === 503) ok.push(`admin/admin123 bloqueado (${bad.status})`);
  else issues.push(`admin/admin123 não bloqueado (status ${bad.status})`);

  const token = login.data?.token;
  if (!token) {
    console.log(JSON.stringify({ deploy_aplicado: true, login: 'FAIL', fila: 'FAIL', ok, issues }, null, 2));
    process.exit(1);
  }

  const meBackend = await get(`${BACKEND}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (meBackend.status === 200 && meBackend.data?.success) ok.push('/api/auth/me backend → OK');
  else issues.push(`/api/auth/me backend → ${meBackend.status}`);

  const mePanel = await get(`${PANEL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (mePanel.status === 200 && mePanel.data?.success) ok.push('/api/auth/me panel proxy → OK');
  else issues.push(`/api/auth/me panel → ${mePanel.status}`);

  const queueBackend = await get(`${BACKEND}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const queueCount = Array.isArray(queueBackend.data?.atendimentos) ? queueBackend.data.atendimentos.length : null;
  if (queueBackend.status === 200 && queueBackend.data?.success) ok.push(`fila backend → OK (${queueCount})`);
  else issues.push(`fila backend → ${queueBackend.status}`);

  const queuePanel = await get(`${PANEL}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (queuePanel.status === 200 && queuePanel.data?.success) ok.push('fila panel proxy → OK');
  else issues.push(`fila panel → ${queuePanel.status}`);

  const health = await get(`${BACKEND}/health`);
  if (health.status >= 500) issues.push(`health → ${health.status}`);
  else ok.push(`health → ${health.status}`);

  const dash = await get(`${PANEL}/dashboard`);
  if (dash.text.includes('Redirecionando para a fila')) ok.push('dashboard → redirect /fila (SSR hint)');
  else issues.push('dashboard sem texto de redirect para /fila');

  const loginPage = await get(`${PANEL}/login`);
  const chunks = loginPage.text.match(/\/_next\/static\/chunks\/[^"']+\.js/g) || [];
  let loginRedirectFila = false;
  let mockFlagTrue = false;
  for (const chunk of chunks.slice(0, 15)) {
    try {
      const chunkRes = await get(`${PANEL}${chunk}`);
      if (chunkRes.text.includes("replace('/fila')") || chunkRes.text.includes('replace("/fila")')) {
        loginRedirectFila = true;
      }
      if (chunkRes.text.includes('ENABLE_MOCK_FALLBACK') && /true|\"1\"/.test(chunkRes.text)) {
        mockFlagTrue = true;
      }
    } catch {
      /* ignore */
    }
  }
  if (loginRedirectFila) ok.push('login JS → redirect /fila');
  else issues.push('login JS ainda sem redirect /fila no bundle (deploy propagando?)');

  if (!mockFlagTrue) ok.push('mock fallback → desligado no bundle');
  else issues.push('mock fallback possivelmente ativo');

  const loginProxy = await get(`${PANEL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  });
  if (loginProxy.status >= 500) issues.push(`login panel proxy → ${loginProxy.status}`);

  console.log(
    JSON.stringify(
      {
        deploy_aplicado: true,
        login: loginOk && meBackend.status === 200 ? 'OK' : 'FAIL',
        fila: queueBackend.status === 200 && queuePanel.status === 200 ? 'OK' : 'FAIL',
        redirect_fila: loginRedirectFila && dash.text.includes('Redirecionando para a fila') ? 'OK' : 'PENDENTE',
        ok,
        issues,
      },
      null,
      2,
    ),
  );
  process.exit(issues.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
