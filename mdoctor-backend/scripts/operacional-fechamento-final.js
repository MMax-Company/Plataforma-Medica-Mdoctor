/**
 * Fechamento operacional — probes + smoke + relatório JSON.
 * Não altera infra; usa env existentes.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '../..');
const outJson = path.join(root, 'docs/OPERACIONAL-FECHAMENTO-FINAL.json');
const outMd = path.join(root, 'docs/OPERACIONAL-FECHAMENTO-FINAL.md');

const URLS = {
  backendStaging: 'https://mdoctor-backend-staging-staging.up.railway.app',
  panelStaging: 'https://painel-medico-staging-staging.up.railway.app',
  n8nProd: 'https://n8n-node-production-f844.up.railway.app',
  n8nStaging: 'https://n8n-staging-staging-2dfe.up.railway.app',
  evolutionStaging: 'https://evolution-api-staging-staging-40d1.up.railway.app',
  typebotPublic: 'https://typebot.co/doctor-prescreve-8rmljgu',
  n8nProdTypebotWh: 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook',
  n8nProdZapiWh: 'https://n8n-node-production-f844.up.railway.app/webhook/zapi-webhook',
  n8nStagingTypebotWh: 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook',
  n8nStagingEvoWh: 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/evolution-webhook'
};

async function probe(method, url, body, headers = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, bodyPreview: text.slice(0, 200) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function tryExec(name, cmd) {
  try {
    const stdout = execSync(cmd, { cwd: root, encoding: 'utf8', env: process.env, stdio: 'pipe' });
    return { name, ok: true, stdout: stdout.slice(0, 800) };
  } catch (error) {
    return { name, ok: false, error: String(error.stdout || error.message).slice(0, 500) };
  }
}

async function n8nWorkflows(base, apiKey) {
  if (!apiKey) return { skipped: true };
  const res = await fetch(`${base}/api/v1/workflows?limit=50`, {
    headers: { 'X-N8N-API-KEY': apiKey }
  });
  const data = await res.json();
  const list = data.data || data;
  return {
    status: res.status,
    workflows: Array.isArray(list)
      ? list.map((w) => ({ id: w.id, name: w.name, active: w.active }))
      : []
  };
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    urls: URLS,
    railway: {},
    typebot: {},
    n8n: {},
    webhooks: {},
    local: [],
    smoke: {},
    blockTests: {},
    pending: []
  };

  report.railway.n8nProd = await probe('GET', `${URLS.n8nProd}/healthz`);
  report.railway.n8nStaging = await probe('GET', `${URLS.n8nStaging}/healthz`);
  report.railway.backendStaging = await probe('GET', `${URLS.backendStaging}/health`);
  report.railway.panelStaging = await probe('GET', `${URLS.panelStaging}/login`);
  report.railway.evolutionStaging = await probe('GET', URLS.evolutionStaging);
  report.railway.typebotPublic = await probe('GET', URLS.typebotPublic);

  report.webhooks.n8nProdTypebot = await probe('POST', URLS.n8nProdTypebotWh, {});
  report.webhooks.n8nProdZapi = await probe('POST', URLS.n8nProdZapiWh, {});
  report.webhooks.n8nStagingTypebot = await probe('POST', URLS.n8nStagingTypebotWh, {});
  report.webhooks.n8nStagingEvolution = await probe('POST', URLS.n8nStagingEvoWh, {});

  report.n8n.production = await n8nWorkflows(URLS.n8nProd, process.env.N8N_API_KEY);

  report.local.push(tryExec('validate_staging_safe', 'node mdoctor-backend/scripts/validate-typebot-staging-safe.js'));
  report.local.push(tryExec('validate_eligibility', 'node mdoctor-backend/scripts/test-typebot-eligibility.js'));

  if (process.env.TYPEBOT_API_TOKEN) {
    report.typebot.build = tryExec('build_prod_export', 'node mdoctor-backend/scripts/build-typebot-production-export.js');
    report.typebot.publish = tryExec('publish_prod', 'node mdoctor-backend/scripts/publish-typebot-production.js');
  } else {
    report.pending.push('TYPEBOT_API_TOKEN ausente — publish produção não executado');
  }

  if (process.env.N8N_WEBHOOK_SECRET) {
    report.smoke.staging = tryExec('smoke_fase1', 'node mdoctor-backend/scripts/smoke-fase1-staging.js');
    if (process.env.MEDICO_PASS) {
      report.smoke.e2e = tryExec('e2e_operacional', 'node mdoctor-backend/scripts/staging-e2e-operacional.js');
    }
  } else {
    report.pending.push('N8N_WEBHOOK_SECRET ausente — smoke staging backend não executado');
  }

  if (process.env.N8N_API_KEY) {
    report.n8n.exportProd = tryExec(
      'export_n8n_prod',
      'node mdoctor-backend/scripts/export-n8n-production-workflow.js'
    );
  }

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

  const md = [
    '# Fechamento operacional — Doctor Prescreve',
    '',
    `**Gerado:** ${report.generatedAt}`,
    '',
    '## URLs oficiais',
    '',
    '| Componente | URL |',
    '| --- | --- |',
    `| Typebot público | ${URLS.typebotPublic} |`,
    `| n8n produção | ${URLS.n8nProd} |`,
    `| Webhook Typebot prod | ${URLS.n8nProdTypebotWh} |`,
    `| Webhook Z-API prod | ${URLS.n8nProdZapiWh} |`,
    `| n8n staging | ${URLS.n8nStaging} |`,
    `| Backend staging | ${URLS.backendStaging} |`,
    `| Painel staging | ${URLS.panelStaging} |`,
    `| Evolution staging | ${URLS.evolutionStaging} |`,
    '',
    '## Status HTTP (probe)',
    '',
    `- n8n prod healthz: **${report.railway.n8nProd.status}**`,
    `- Webhook Typebot prod POST: **${report.webhooks.n8nProdTypebot.status}**`,
    `- Webhook Z-API prod POST: **${report.webhooks.n8nProdZapi.status}**`,
    `- Backend staging /health: **${report.railway.backendStaging.status}**`,
    `- Painel staging /login: **${report.railway.panelStaging.status}**`,
    '',
    '## Typebot',
    '',
    report.typebot.publish?.ok
      ? '- **Publicado** via API (bot `doctor-prescreve-8rmljgu`, webhook produção)'
      : `- Publish: ${report.pending.find((p) => p.includes('TYPEBOT')) || report.typebot.publish?.error || 'ver JSON'}`,
    '',
    '## n8n produção',
    '',
    ...(report.n8n.production?.workflows || []).map(
      (w) => `- ${w.active ? '✅' : '⬜'} ${w.name} (\`${w.id}\`)`
    ),
    '',
    '## Pendências reais',
    '',
    ...(report.pending.length ? report.pending.map((p) => `- ${p}`) : ['- Nenhuma bloqueadora automática']),
    '',
    `Detalhes: \`docs/OPERACIONAL-FECHAMENTO-FINAL.json\``
  ].join('\n');

  fs.writeFileSync(outMd, md);
  console.log(JSON.stringify({ saved: [outJson, outMd], pending: report.pending }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
