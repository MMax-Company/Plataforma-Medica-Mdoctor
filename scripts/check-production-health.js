#!/usr/bin/env node
/**
 * Healthcheck operacional — n8n / backend (produção assistida).
 *
 * Uso:
 *   node scripts/check-production-health.js
 *
 * Env (valores padrão = stack atual):
 *   N8N_BASE_URL, BACKEND_URL
 */
const N8N = String(process.env.N8N_BASE_URL || 'https://n8n-node-production-f844.up.railway.app').replace(
  /\/$/,
  ''
);
const BACKEND = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');

async function timed(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { name, ok: true, latency_ms: Date.now() - started, ...result };
  } catch (error) {
    return { name, ok: false, latency_ms: Date.now() - started, error: error.message };
  }
}

async function fetchStatus(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.status >= 200 && res.status < 400, json, text: text.slice(0, 160) };
}

async function main() {
  const checks = [];

  checks.push(
    await timed('n8n_online', async () => {
      let r = await fetchStatus(`${N8N}/healthz`);
      if (!r.ok) r = await fetchStatus(`${N8N}/`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { status: r.status };
    })
  );

  checks.push(
    await timed('backend_online', async () => {
      const r = await fetchStatus(`${BACKEND}/health`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { status: r.status };
    })
  );

  for (const path of ['typebot-webhook']) {
    checks.push(
      await timed(`webhook_${path.replace(/-/g, '_')}`, async () => {
        const r = await fetchStatus(`${N8N}/webhook/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        if (r.status === 404) throw new Error('webhook not registered (404)');
        if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
        return { status: r.status };
      })
    );
  }

  const report = {
    generated_at: new Date().toISOString(),
    targets: { N8N, BACKEND },
    checks,
    success: checks.every((c) => c.ok),
    failures: checks.filter((c) => !c.ok).map((c) => c.name)
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e.message }));
  process.exit(1);
});
