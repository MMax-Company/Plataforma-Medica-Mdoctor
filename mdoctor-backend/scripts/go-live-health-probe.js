#!/usr/bin/env node
/**
 * Probe mínimo de saúde — go-live assistido (Fase 5).
 *
 * Env:
 *   BACKEND_URL (default staging)
 *   PANEL_URL
 *   N8N_URL
 *   TYPEBOT_PUBLIC_URL (opcional — só HEAD)
 *   REPORT_PATH (default docs/GO-LIVE-HEALTH-PROBE.json)
 */
const fs = require('fs');
const path = require('path');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const N8N = String(process.env.N8N_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(/\/$/, '');
const TYPEBOT = process.env.TYPEBOT_PUBLIC_URL || 'https://typebot.co/doctor-prescreve-8rmljgu';
const REPORT_PATH =
  process.env.REPORT_PATH || path.join(__dirname, '../../docs/GO-LIVE-HEALTH-PROBE.json');

async function probe(name, url, options = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: options.method || 'GET', ...options });
    const text = await res.text().catch(() => '');
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      name,
      url,
      ok: res.ok,
      status: res.status,
      latency_ms: Date.now() - started,
      snippet: json || (text ? text.slice(0, 200) : null)
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      error: error.message,
      latency_ms: Date.now() - started
    };
  }
}

async function main() {
  const report = {
    generated_at: new Date().toISOString(),
    targets: { BACKEND, PANEL, N8N, TYPEBOT },
    probes: []
  };

  report.probes.push(await probe('backend_health', `${BACKEND}/health`));
  report.probes.push(await probe('backend_readyz', `${BACKEND}/readyz`));
  report.probes.push(await probe('panel_login', `${PANEL}/login`));
  let n8nProbe = await probe('n8n_health', `${N8N}/healthz`, { method: 'GET' });
  if (!n8nProbe.ok) {
    n8nProbe = await probe('n8n_root', `${N8N}/`, { method: 'GET' });
  }
  report.probes.push(n8nProbe);
  report.probes.push(await probe('typebot_public', TYPEBOT, { method: 'HEAD' }));

  report.success = report.probes.every((p) => p.ok || p.name === 'n8n_health');
  report.failures = report.probes.filter((p) => !p.ok).map((p) => p.name);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
