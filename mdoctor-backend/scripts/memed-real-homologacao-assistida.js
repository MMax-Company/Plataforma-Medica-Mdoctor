#!/usr/bin/env node
/**
 * Homologação Memed real assistida — cria atendimento, approve, URLs.
 * Uso: LOAD_RAILWAY_VARS=0 node scripts/memed-real-homologacao-assistida.js
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const lib = require('./homologacao-clinica-fase2-lib');

const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const REPORT_PATH =
  process.env.REPORT_PATH ||
  path.join(__dirname, '../../docs/MEMED-REAL-HOMOLOGACAO-ASSISTIDA.json');

async function main() {
  const correlationId = `memed-real-assistida-${Date.now()}`;
  const report = {
    executed_at: new Date().toISOString(),
    backend: lib.BACKEND_URL,
    panel: PANEL,
    correlationId,
    steps: []
  };

  function step(name, ok, extra = {}) {
    report.steps.push({ name, ok, ...extra });
  }

  const readyz = await lib.requestJson(`${lib.BACKEND_URL}/readyz`);
  step('readyz', readyz.ok, {
    memed: readyz.data?.memed,
    storage: readyz.data?.storage?.mode
  });

  const config = await lib.requestJson(`${lib.BACKEND_URL}/api/memed/config`);
  step('memed_config', config.ok && config.data?.config?.enabled, {
    realMode: config.data?.config?.realMode,
    mockFallbackAllowed: config.data?.config?.mockFallbackAllowed,
    emissionMode: config.data?.config?.emissionMode,
    environment: config.data?.config?.environment
  });

  const created = await lib.createAtendimentoViaTriagem(correlationId);
  step('triagem', created.ok, { atendimentoId: created.atendimentoId });
  if (!created.atendimentoId) {
    report.error = 'triagem_failed';
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const atendimentoId = created.atendimentoId;
  report.atendimentoId = atendimentoId;

  const login = await lib.loginMedico(correlationId);
  step('medico_login', login.ok);
  if (!login.token) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const approve = await lib.clinicalApprove(login.token, atendimentoId, correlationId);
  step('clinical_approve', approve.ok, { status: approve.data?.atendimento?.status });

  const detail = await lib.getAtendimento(login.token, atendimentoId, correlationId);
  const at = detail.data?.atendimento || {};
  step('atendimento_approved', String(at.status || '').toLowerCase() === 'approved', {
    status: at.status,
    paciente_nome: at.paciente_nome,
    medicacao: at.medicacao_em_uso || at.dados_clinicos?.medicacao_em_uso
  });

  const token = await lib.requestJson(`${lib.BACKEND_URL}/api/memed/token`, {
    headers: lib.authHeaders(login.token, correlationId)
  });
  step('memed_token', token.ok && Boolean(token.data?.token));

  report.urls = {
    receita: `${PANEL}/receita?atendimentoId=${atendimentoId}`,
    atendimento: `${PANEL}/atendimento/${atendimentoId}`,
    prontuario: `${PANEL}/prontuario/${atendimentoId}`,
    fila: `${PANEL}/fila`
  };
  report.mock_blocked =
    config.data?.config?.realMode === true && config.data?.config?.mockFallbackAllowed === false;
  report.medico_emitir_agora = true;
  report.ok = report.steps.every((s) => s.ok);

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
