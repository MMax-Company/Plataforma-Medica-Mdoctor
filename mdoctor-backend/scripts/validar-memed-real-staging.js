#!/usr/bin/env node
/**
 * Pré-voo Memed real — staging (mdoctor-backend-staging).
 * Uso: LOAD_RAILWAY_VARS=0 node scripts/validar-memed-real-staging.js
 */
require('./load-dotenv');
const lib = require('./homologacao-clinica-fase2-lib');
const { getMemedRuntimeStatus, applyMemedEnvAliases } = require('../src/config/memed-runtime');

applyMemedEnvAliases();

const report = {
  executed_at: new Date().toISOString(),
  backend: lib.BACKEND_URL,
  runtime: getMemedRuntimeStatus(),
  steps: [],
  ok: false
};

function step(name, ok, extra = {}) {
  report.steps.push({ name, ok, ...extra });
}

async function main() {
  const readyz = await lib.requestJson(`${lib.BACKEND_URL}/readyz`);
  step('readyz_memed_configured', readyz.data?.memed?.configured === true, {
    source: readyz.data?.memed?.source,
    env: readyz.data?.memed?.env
  });

  const config = await lib.requestJson(`${lib.BACKEND_URL}/api/memed/config`);
  step('memed_config_enabled', config.data?.config?.enabled === true, {
    realMode: config.data?.config?.realMode,
    emissionMode: config.data?.config?.emissionMode
  });

  const correlationId = `memed-real-preflight-${Date.now()}`;
  const login = await lib.loginMedico(correlationId);
  step('medico_login', login.ok);
  if (!login.token) {
    report.ok = false;
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const token = await lib.requestJson(`${lib.BACKEND_URL}/api/memed/token`, {
    headers: lib.authHeaders(login.token, correlationId)
  });
  step('memed_token', token.ok && Boolean(token.data?.token), {
    status: token.status,
    hasPrescriber: Boolean(token.data?.prescriber)
  });

  const mockBlocked = await lib.requestJson(`${lib.BACKEND_URL}/api/memed/receita`, {
    method: 'POST',
    headers: lib.authHeaders(login.token, correlationId),
    body: JSON.stringify({
      atendimentoId: '00000000-0000-4000-8000-000000000099',
      receitaId: 'mock-receipt-test',
      pdfUrl: 'https://example.invalid/mock.pdf'
    })
  });
  const blocked =
    report.runtime.real_enabled &&
    (mockBlocked.status === 422 || mockBlocked.data?.code?.includes('MOCK'));
  step(
    'mock_receipt_blocked_when_real',
    report.runtime.real_enabled ? blocked : mockBlocked.status !== 500,
    { status: mockBlocked.status, code: mockBlocked.data?.code }
  );

  report.ok = report.steps.every((s) => s.ok);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
