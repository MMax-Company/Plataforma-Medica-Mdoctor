#!/usr/bin/env node
/**
 * Fase 2 — E2E homologação clínica (staging).
 *
 * Env:
 *   FLOW=approve|reject|ready|deliver|memed|full (default full)
 *   ATENDIMENTO_ID (opcional — pula criação n8n)
 *   N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET, BACKEND_URL
 *   MEDICO_USER, MEDICO_PASS
 */
const {
  BACKEND_URL,
  medicoPass,
  REPORT_PATH,
  VALID_REJECT_CODES,
  loginMedico,
  createAtendimentoViaN8n,
  getAtendimento,
  clinicalApprove,
  persistMemedReceipt,
  clinicalValidate,
  clinicalReject,
  deliverPrescription,
  fetchRejectReasons,
  writeReport,
  summarizeStep
} = require('./homologacao-clinica-fase2-lib');

const FLOW = String(process.env.FLOW || 'full').toLowerCase();
const EXISTING_ID = String(process.env.ATENDIMENTO_ID || '').trim();

async function runApprovePath(token, atendimentoId, correlationId, steps) {
  const approve = await clinicalApprove(token, atendimentoId, correlationId);
  steps.push(
    summarizeStep('clinical_approve', approve, {
      statusNovo: approve.data?.atendimento?.status,
      memedEmission: approve.data?.memed?.emission
    })
  );
  if (!approve.ok || approve.data?.atendimento?.status !== 'approved') return false;

  const receipt = await persistMemedReceipt(token, atendimentoId, correlationId);
  steps.push(summarizeStep('memed_receipt_persisted', receipt, { status: receipt.data?.atendimento?.status }));
  if (!receipt.ok) return false;

  const afterApprove = await getAtendimento(token, atendimentoId, correlationId);
  const memedReceipt = afterApprove.data?.atendimento?.dados_clinicos?.memed_receita;
  steps.push(
    summarizeStep('memed_receipt_loaded', afterApprove, {
      hasMemedReceipt: Boolean(memedReceipt),
      pdfUrl: memedReceipt?.pdfUrl || null
    })
  );

  if (FLOW === 'memed' || FLOW === 'approve') return approve.ok;

  const validate = await clinicalValidate(token, atendimentoId, correlationId);
  steps.push(
    summarizeStep('clinical_validate_ready', validate, {
      statusNovo: validate.data?.atendimento?.status
    })
  );
  if (!validate.ok) return false;

  if (FLOW === 'ready') return true;

  const deliver = await deliverPrescription(token, atendimentoId, correlationId);
  steps.push(
    summarizeStep('deliver_mock', deliver, {
      provider: deliver.data?.delivery?.provider,
      deliveryStatus: deliver.data?.delivery?.status,
      statusFinal: deliver.data?.atendimento?.status
    })
  );
  return deliver.ok;
}

async function runRejectPath(token, atendimentoId, correlationId, steps) {
  const reasons = await fetchRejectReasons(token, correlationId);
  steps.push(
    summarizeStep('reject_reasons_catalog', reasons, {
      count: Array.isArray(reasons.data?.reasons) ? reasons.data.reasons.length : 0
    })
  );

  const reject = await clinicalReject(
    token,
    atendimentoId,
    correlationId,
    'DOCUMENTACAO_INSUFICIENTE',
    'Homologação Fase 2 — documentação insuficiente para renovação'
  );
  steps.push(
    summarizeStep('clinical_reject', reject, {
      statusNovo: reject.data?.atendimento?.status,
      reason_code: reject.data?.reason_code,
      motivoRejeicao: reject.data?.atendimento?.dados_clinicos?.motivo_rejeicao
    })
  );
  return reject.ok;
}

async function main() {
  const correlationId = `fase2-e2e-${Date.now()}`;
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'staging',
    backend_url: BACKEND_URL,
    flow: FLOW,
    correlationId,
    steps: [],
    success: false
  };

  if (!medicoPass() && !['reject_reasons'].includes(FLOW)) {
    report.error = 'MEDICO_PASS required for authenticated clinical flows';
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const session = await loginMedico(correlationId);
  report.steps.push({ name: 'login', ok: session.ok, status: session.status });
  if (!session.ok) {
    writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  let atendimentoId = EXISTING_ID;
  if (!atendimentoId) {
    const created = await createAtendimentoViaN8n(correlationId);
    report.steps.push({
      name: 'n8n_create_atendimento',
      ok: created.ok,
      atendimentoId: created.atendimentoId,
      n8nStatus: created.n8nStatus
    });
    atendimentoId = created.atendimentoId;
    if (!created.ok) {
      writeReport(report);
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }
  } else {
    report.steps.push({ name: 'use_existing_atendimento', ok: true, atendimentoId });
  }

  report.atendimento_id = atendimentoId;

  let ok = true;
  if (FLOW === 'reject') {
    ok = await runRejectPath(session.token, atendimentoId, correlationId, report.steps);
  } else if (FLOW === 'deliver') {
    const deliver = await deliverPrescription(session.token, atendimentoId, correlationId);
    report.steps.push(summarizeStep('deliver_only', deliver));
    ok = deliver.ok;
  } else if (FLOW === 'ready') {
    const validate = await clinicalValidate(session.token, atendimentoId, correlationId);
    report.steps.push(summarizeStep('validate_only', validate));
    ok = validate.ok;
  } else if (FLOW === 'approve' || FLOW === 'memed') {
    ok = await runApprovePath(session.token, atendimentoId, correlationId, report.steps);
  } else if (FLOW === 'full') {
    ok = await runApprovePath(session.token, atendimentoId, correlationId, report.steps);
    if (ok) {
      const rejectCreated = await createAtendimentoViaN8n(`${correlationId}-reject`);
      if (rejectCreated.ok) {
        const rejectOk = await runRejectPath(
          session.token,
          rejectCreated.atendimentoId,
          `${correlationId}-reject`,
          report.steps
        );
        report.reject_flow_ok = rejectOk;
      }
    }
  } else {
    report.error = `Unknown FLOW=${FLOW}`;
    ok = false;
  }

  report.valid_reject_codes = VALID_REJECT_CODES;
  report.success = ok;
  report.report_path = writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
