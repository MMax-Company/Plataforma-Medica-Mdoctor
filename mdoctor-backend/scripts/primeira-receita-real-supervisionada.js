#!/usr/bin/env node
/**
 * Primeira receita real supervisionada — staging.
 *
 * Automatiza: triagem → approve → iniciar-emissao → token Memed.
 * Com receita real (pós-widget): persist → validate → deliver.
 *
 * Env:
 *   LOAD_RAILWAY_VARS=1
 *   ATENDIMENTO_ID (opcional — pula criação)
 *   MEMED_RECEITA_ID + MEMED_PDF_URL (obrigatórios para concluir emissão REAL)
 *   SKIP_CREATE=1 — usa ATENDIMENTO_ID existente
 *   PIPELINE_MOCK_RECEIPT=1 — só homologação técnica (NÃO conta como MVP real)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPORT_PATH =
  process.env.REPORT_PATH ||
  path.join(__dirname, '../../docs/PRIMEIRA-RECEITA-REAL-RELATORIO.json');

const BACKEND_URL = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');
const PANEL_URL = String(
  process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app'
).replace(/\/$/, '');

const RAILWAY_PROJECT = process.env.RAILWAY_PROJECT_ID || 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const RAILWAY_ENV = process.env.RAILWAY_ENVIRONMENT_ID || 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const RAILWAY_SERVICE = process.env.RAILWAY_SERVICE_ID || '53960eb4-a1be-4d7c-b665-462049e52085';

const lib = require('./homologacao-clinica-fase2-lib');

function loadRailwayVars() {
  if (process.env.LOAD_RAILWAY_VARS !== '1') return;
  try {
    const out = execSync(
      `railway variable list -p ${RAILWAY_PROJECT} -e ${RAILWAY_ENV} -s ${RAILWAY_SERVICE} --json`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    for (const [key, value] of Object.entries(JSON.parse(out))) {
      if (value != null && value !== '') process.env[key] = String(value);
    }
  } catch (error) {
    console.error('LOAD_RAILWAY_VARS failed:', error.message);
  }
}

async function fetchDecisoes(token, atendimentoId, correlationId) {
  return lib.requestJson(`${BACKEND_URL}/api/atendimentos/${atendimentoId}/decisoes`, {
    headers: lib.authHeaders(token, correlationId)
  });
}

async function startMemedEmission(token, atendimentoId, correlationId) {
  return lib.requestJson(`${BACKEND_URL}/api/memed/iniciar-emissao`, {
    method: 'POST',
    headers: lib.authHeaders(token, correlationId),
    body: JSON.stringify({ atendimentoId })
  });
}

async function getMemedToken(token, correlationId) {
  return lib.requestJson(`${BACKEND_URL}/api/memed/token`, {
    headers: lib.authHeaders(token, correlationId)
  });
}

async function getMemedConfig() {
  return lib.requestJson(`${BACKEND_URL}/api/memed/config`);
}

async function getReadyz() {
  return lib.requestJson(`${BACKEND_URL}/readyz`);
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  return REPORT_PATH;
}

function step(name, ok, extra = {}) {
  return { name, ok, ...extra };
}

async function main() {
  loadRailwayVars();

  const correlationId = process.env.CORRELATION_ID || `primeira-receita-real-${Date.now()}`;
  const realReceiptId = String(process.env.MEMED_RECEITA_ID || '').trim();
  const realPdfUrl = String(process.env.MEMED_PDF_URL || process.env.MEMED_RECEITA_URL || '').trim();
  const pipelineMock = process.env.PIPELINE_MOCK_RECEIPT === '1';
  const existingId = String(process.env.ATENDIMENTO_ID || '').trim();

  const report = {
    generated_at: new Date().toISOString(),
    script: 'primeira-receita-real-supervisionada.js',
    purpose: 'Primeira emissão REAL supervisionada — staging',
    backend_url: BACKEND_URL,
    panel_url: PANEL_URL,
    correlation_id: correlationId,
    mvp_operacional_real: false,
    success: false,
    steps: [],
    atendimento_id: existingId || null,
    manual_widget_gate: null,
    receipt: null,
    audit_summary: null,
    errors: []
  };

  const readyz = await getReadyz();
  report.steps.push(
    step('readyz', readyz.ok, {
      memed: readyz.data?.memed,
      storage: readyz.data?.storage?.mode
    })
  );

  const memedConfig = await getMemedConfig();
  report.steps.push(
    step('memed_config', memedConfig.ok, {
      enabled: memedConfig.data?.config?.enabled,
      environment: memedConfig.data?.config?.environment,
      emissionMode: memedConfig.data?.config?.emissionMode
    })
  );

  const session = await lib.loginMedico(correlationId);
  report.steps.push(step('login', session.ok));
  if (!session.ok) {
    report.errors.push('login_failed');
    writeReport(report);
    console.log(JSON.stringify({ success: false, report_path: REPORT_PATH, errors: report.errors }, null, 2));
    process.exit(1);
  }

  let atendimentoId = existingId;
  if (!atendimentoId) {
    const created = await lib.createAtendimentoViaTriagem(correlationId);
    report.steps.push(
      step('create_atendimento', created.ok, {
        source: created.source,
        atendimentoId: created.atendimentoId
      })
    );
    if (!created.ok) {
      report.errors.push('create_atendimento_failed');
      writeReport(report);
      console.log(JSON.stringify({ success: false, report_path: REPORT_PATH }, null, 2));
      process.exit(1);
    }
    atendimentoId = created.atendimentoId;
  }
  report.atendimento_id = atendimentoId;

  const beforeApprove = await lib.getAtendimento(session.token, atendimentoId, correlationId);
  const preReceipt = beforeApprove.data?.atendimento?.dados_clinicos?.memed_receita;
  report.steps.push(
    step('pre_approve_state', true, {
      status: beforeApprove.data?.atendimento?.status,
      has_memed_receita: Boolean(preReceipt?.receitaId)
    })
  );

  const approve = await lib.clinicalApprove(session.token, atendimentoId, correlationId);
  let approvedStatus = approve.data?.atendimento?.status;
  if (!approvedStatus && approve.ok) {
    const afterApproveFetch = await lib.getAtendimento(session.token, atendimentoId, correlationId);
    approvedStatus = afterApproveFetch.data?.atendimento?.status;
  }
  report.steps.push(
    step('clinical_approve', approve.ok && approvedStatus === 'approved', {
      status: approvedStatus,
      memedEmission: approve.data?.memed?.emission,
      no_auto_prescription: !approve.data?.memed?.prescription
    })
  );
  if (!approve.ok || approvedStatus !== 'approved') {
    report.errors.push('approve_not_approved_status');
    writeReport(report);
    process.exit(1);
  }

  const afterApprove = await lib.getAtendimento(session.token, atendimentoId, correlationId);
  const postApproveReceipt = afterApprove.data?.atendimento?.dados_clinicos?.memed_receita;
  report.steps.push(
    step('no_auto_emission_after_approve', !postApproveReceipt?.receitaId, {
      has_memed_receita: Boolean(postApproveReceipt?.receitaId)
    })
  );

  const startEmission = await startMemedEmission(session.token, atendimentoId, correlationId);
  report.steps.push(
    step('memed_iniciar_emissao', startEmission.ok, {
      status: startEmission.data?.atendimento?.status || startEmission.data?.status
    })
  );

  const memedToken = await getMemedToken(session.token, correlationId);
  report.steps.push(
    step('memed_token', memedToken.ok && Boolean(memedToken.data?.token), {
      has_token: Boolean(memedToken.data?.token),
      prescriber_id: memedToken.data?.prescriber?.id || null
    })
  );

  report.manual_widget_gate = {
    required: !realReceiptId && !pipelineMock,
    panel_receita_url: `${PANEL_URL}/receita?atendimentoId=${atendimentoId}`,
    panel_atendimento_url: `${PANEL_URL}/atendimento/${atendimentoId}`,
    instructions: [
      'Abrir panel_receita_url com médico logado',
      'Revisar paciente/medicação no widget Sinapse',
      'Emitir e imprimir receita (ação explícita)',
      'Reexecutar script com MEMED_RECEITA_ID e MEMED_PDF_URL'
    ]
  };

  let receiptId = realReceiptId;
  let pdfUrl = realPdfUrl;
  let receiptSource = 'memed_widget_real';

  if (!receiptId && pipelineMock) {
    receiptId = `pipeline-mock-${Date.now()}`;
    pdfUrl = `https://example.invalid/pipeline-mock-${atendimentoId}.pdf`;
    receiptSource = 'pipeline_mock_not_mvp';
  }

  if (!receiptId) {
    report.success = report.steps.every((s) => s.ok);
    report.mvp_operacional_real = false;
    report.errors.push('manual_widget_pending');
    writeReport(report);
    console.log(
      JSON.stringify(
        {
          success: report.success,
          mvp_operacional_real: false,
          manual_widget_gate: report.manual_widget_gate,
          atendimento_id: atendimentoId,
          report_path: REPORT_PATH
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const persist = await lib.persistMemedReceipt(session.token, atendimentoId, correlationId, {
    receitaId: receiptId,
    pdfUrl,
    payload: { source: receiptSource, correlationId, real: receiptSource === 'memed_widget_real' }
  });
  const persistedStatus = persist.data?.atendimento?.status;
  const receipt = persist.data?.atendimento?.dados_clinicos?.memed_receita || persist.data?.receita;
  report.steps.push(
    step('memed_receita_persist', persist.ok, {
      status: persistedStatus,
      memed_id: receipt?.memed_id || receipt?.receitaId,
      pdf_url: receipt?.pdfUrl || receipt?.pdf_url,
      issued_at: receipt?.issued_at || receipt?.gerada_em
    })
  );
  report.receipt = {
    memed_id: receipt?.memed_id || receipt?.receitaId || receiptId,
    pdf_url: receipt?.pdfUrl || receipt?.pdf_url || pdfUrl,
    issued_at: receipt?.issued_at || receipt?.gerada_em || null,
    source: receiptSource
  };

  if (!persist.ok || persistedStatus !== 'receita_emitida') {
    report.errors.push('persist_failed');
    writeReport(report);
    process.exit(1);
  }

  const validate = await lib.clinicalValidate(session.token, atendimentoId, correlationId);
  report.steps.push(
    step('clinical_validate', validate.ok && validate.data?.atendimento?.status === 'ready', {
      status: validate.data?.atendimento?.status
    })
  );

  const deliver = await lib.deliverPrescription(session.token, atendimentoId, correlationId);
  report.steps.push(
    step('deliver_controlled', deliver.ok && deliver.data?.atendimento?.status === 'delivered', {
      status: deliver.data?.atendimento?.status,
      provider: deliver.data?.delivery?.provider,
      delivery_status: deliver.data?.delivery?.status
    })
  );

  const decisoes = await fetchDecisoes(session.token, atendimentoId, correlationId);
  const logs = Array.isArray(decisoes.data?.decisoes) ? decisoes.data.decisoes : [];
  report.audit_summary = {
    decisoes_count: logs.length,
    status_transitions: logs.map((d) => ({
      de: d.status_anterior,
      para: d.status_novo,
      motivo: d.motivo,
      em: d.criado_em
    })),
    actions_expected: [
      'clinical_approved',
      'memed_emission_started',
      'memed_receipt_persisted',
      'memed_prescription_validated',
      'delivery_completed'
    ]
  };

  const flowComplete =
    report.steps.every((s) => s.ok) &&
    receiptSource === 'memed_widget_real' &&
    Boolean(report.receipt?.memed_id) &&
    Boolean(report.receipt?.pdf_url);

  report.mvp_operacional_real = flowComplete;
  report.success = report.steps.every((s) => s.ok);
  writeReport(report);

  console.log(
    JSON.stringify(
      {
        success: report.success,
        mvp_operacional_real: report.mvp_operacional_real,
        atendimento_id: atendimentoId,
        final_status: deliver.data?.atendimento?.status,
        receipt: report.receipt,
        report_path: REPORT_PATH
      },
      null,
      2
    )
  );
  process.exit(report.mvp_operacional_real ? 0 : report.success ? 0 : 1);
}

main().catch((error) => {
  writeReport({
    generated_at: new Date().toISOString(),
    success: false,
    fatal_error: error.message
  });
  console.error(error);
  process.exit(1);
});
