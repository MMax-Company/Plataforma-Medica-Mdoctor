#!/usr/bin/env node
/**
 * Valida painel definitivo + auth oficial (Railway staging).
 * Não imprime senha. Use MEDICO_USER + MEDICO_PASS no ambiente.
 */
const PANEL_URL = (process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const BACKEND_URL = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';

async function fetchStatus(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: response.status, data, ok: response.ok };
}

async function main() {
  const report = {
    generated_at: new Date().toISOString(),
    panel_url: PANEL_URL,
    backend_url: BACKEND_URL,
    steps: [],
    success: false,
  };

  for (const path of ['/login', '/fila', '/dashboard']) {
    const r = await fetchStatus(`${PANEL_URL}${path}`);
    report.steps.push({ name: `panel_get_${path}`, ok: r.status === 200, status: r.status });
  }

  if (!MEDICO_PASS) {
    report.steps.push({ name: 'auth_login', ok: false, error: 'MEDICO_PASS not set' });
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const login = await fetchStatus(`${BACKEND_URL}/api/auth/login`, 'POST', {
    user: MEDICO_USER,
    username: MEDICO_USER,
    password: MEDICO_PASS,
  });
  report.steps.push({
    name: 'auth_login',
    ok: login.ok && login.data?.success && Boolean(login.data?.token),
    status: login.status,
    username: login.data?.user?.username,
  });

  if (!login.data?.token) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const me = await fetchStatus(`${BACKEND_URL}/api/auth/me`, 'GET');
  const meRes = await fetch(`${BACKEND_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${login.data.token}` },
  });
  const meData = await meRes.json();
  report.steps.push({
    name: 'auth_me',
    ok: meRes.ok && meData?.success,
    status: meRes.status,
    user: meData?.user?.username,
  });

  const queue = await fetch(`${BACKEND_URL}/api/atendimentos`, {
    headers: { Authorization: `Bearer ${login.data.token}` },
  });
  const queueData = await queue.json().catch(() => ({}));
  report.steps.push({
    name: 'api_atendimentos',
    ok: queue.ok,
    status: queue.status,
    count: Array.isArray(queueData?.atendimentos) ? queueData.atendimentos.length : null,
  });

  report.success = report.steps.every((s) => s.ok);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
