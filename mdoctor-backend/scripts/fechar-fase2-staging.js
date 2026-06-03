#!/usr/bin/env node
/**
 * Fechamento Fase 2 — carrega vars Railway (se necessário), E2E + evidências.
 * Uso local:
 *   node scripts/fechar-fase2-staging.js
 * Com vars já no ambiente:
 *   MEDICO_PASS=... N8N_WEBHOOK_SECRET=... node scripts/fechar-fase2-staging.js
 */
const { execSync } = require('child_process');

const PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

function loadRailwayVars() {
  try {
    const out = execSync(
      `railway variable list -p ${PROJECT} -e ${ENV} -s ${SERVICE} --json`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(out);
    for (const [key, value] of Object.entries(parsed)) {
      if (value != null && value !== '') process.env[key] = String(value);
    }
  } catch (error) {
    console.error('Could not load Railway variables:', error.message);
  }
}

loadRailwayVars();

const {
  BACKEND_URL,
  REPORT_PATH,
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

async function runFullE2e(report) {
  const correlationId = `fase2-close-${Date.now()}`;
  report.correlationId = correlationId;

  const session = await loginMedico(correlationId);
  report.steps.push({ name: 'login', ok: session.ok, status: session.status });
  if (!session.ok) {
    report.errors = report.errors || [];
    report.errors.push('login_failed');
    return false;
  }

  const reasons = await fetchRejectReasons(session.token, correlationId);
  const reasonList = Array.isArray(reasons.data?.reasons) ? reasons.data.reasons : [];
  report.steps.push(
    summarizeStep('reject_reasons_catalog', reasons, {
      count: reasonList.length,
      codes: reasonList.map((r) => r.code)
    })
  );
  if (!reasons.ok || reasonList.length < 8) {
    report.errors = report.errors || [];
    report.errors.push('reject_reasons_incomplete');
    return false;
  }

  const created = await createAtendimentoViaN8n(correlationId);
  report.steps.push({
    name: 'n8n_create_atendimento_approve_flow',
    ok: created.ok,
    atendimentoId: created.atendimentoId,
    n8nStatus: created.n8nStatus
  });
  if (!created.ok) return false;

  const atendimentoId = created.atendimentoId;
  report.atendimento_approve_id = atendimentoId;

  const approve = await clinicalApprove(session.token, atendimentoId, correlationId);
  report.steps.push(
    summarizeStep('clinical_approve', approve, {
      statusNovo: approve.data?.atendimento?.status,
      memedEmission: approve.data?.memed?.emission
    })
  );
  if (!approve.ok || approve.data?.atendimento?.status !== 'approved') return false;

  const receiptPersist = await persistMemedReceipt(session.token, atendimentoId, correlationId);
  const afterApprove = await getAtendimento(session.token, atendimentoId, correlationId);
  const memedReceipt = afterApprove.data?.atendimento?.dados_clinicos?.memed_receita;
  report.steps.push(
    summarizeStep('memed_receipt_persisted', receiptPersist, {
      hasMemedReceipt: Boolean(memedReceipt),
      pdfUrl: memedReceipt?.pdfUrl || null,
      status: afterApprove.data?.atendimento?.status
    })
  );
  if (!receiptPersist.ok) return false;

  const validate = await clinicalValidate(session.token, atendimentoId, correlationId);
  report.steps.push(
    summarizeStep('clinical_validate_ready', validate, {
      statusNovo: validate.data?.atendimento?.status
    })
  );
  if (!validate.ok) return false;

  const deliver = await deliverPrescription(session.token, atendimentoId, correlationId);
  report.steps.push(
    summarizeStep('deliver_mock', deliver, {
      provider: deliver.data?.delivery?.provider,
      deliveryStatus: deliver.data?.delivery?.status,
      statusFinal: deliver.data?.atendimento?.status
    })
  );
  if (!deliver.ok) return false;

  const finalRow = await getAtendimento(session.token, atendimentoId, correlationId);
  const audit = finalRow.data?.atendimento?.dados_clinicos?.clinical_audit || {};
  report.evidence = {
    approve_flow: {
      status: finalRow.data?.atendimento?.status,
      memed_receita_id: memedReceipt?.receitaId || memedReceipt?.providerPrescriptionId,
      clinical_audit_approvedBy: audit.approvedBy || audit.approved_by,
      delivery_provider: deliver.data?.delivery?.provider
    }
  };

  const rejectCorr = `${correlationId}-reject`;
  const createdReject = await createAtendimentoViaN8n(rejectCorr);
  report.steps.push({
    name: 'n8n_create_atendimento_reject_flow',
    ok: createdReject.ok,
    atendimentoId: createdReject.atendimentoId
  });
  if (!createdReject.ok) return false;

  const rejectId = createdReject.atendimentoId;
  report.atendimento_reject_id = rejectId;

  const reject = await clinicalReject(
    session.token,
    rejectId,
    rejectCorr,
    'DOCUMENTACAO_INSUFICIENTE',
    'Fase 2 — documentação insuficiente para renovação segura'
  );
  report.steps.push(
    summarizeStep('clinical_reject', reject, {
      statusNovo: reject.data?.atendimento?.status,
      reason_code: reject.data?.reason_code,
      motivoRejeicao: reject.data?.atendimento?.dados_clinicos?.motivo_rejeicao
    })
  );
  if (!reject.ok) return false;

  const rejectedRow = await getAtendimento(session.token, rejectId, rejectCorr);
  const motivoRej = rejectedRow.data?.atendimento?.dados_clinicos?.motivo_rejeicao;
  report.evidence = {
    ...report.evidence,
    reject_flow: {
      status: rejectedRow.data?.atendimento?.status,
      reason_code: motivoRej?.code,
      reason_label: motivoRej?.label,
      audit_rejectReasonCode:
        rejectedRow.data?.atendimento?.dados_clinicos?.clinical_audit?.rejectReasonCode
    }
  };

  return true;
}

async function main() {
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'staging',
    backend_url: BACKEND_URL,
    panel_url: 'https://painel-medico-staging-staging.up.railway.app',
    phase: 'FASE2_CLOSE',
    deploy: {
      backend_deployment_id: 'e3aa7a15-abd4-402c-9ebf-13e990b42389',
      panel_deployment_id: '084e0b9a-fea7-434c-a974-a8d737d300e1',
      note: 'railway up detach 2026-05-29'
    },
    steps: [],
    manual_ui_checklist: {
      fila: 'pending_operator',
      abertura_atendimento: 'pending_operator',
      prontuario: 'pending_operator',
      approve: 'covered_by_e2e',
      reject: 'covered_by_e2e',
      validate: 'covered_by_e2e',
      deliver_mock: 'covered_by_e2e'
    },
    success: false
  };

  report.has_medico_pass = Boolean(process.env.MEDICO_PASS);
  report.has_n8n_secret = Boolean(process.env.N8N_WEBHOOK_SECRET);

  const ok = await runFullE2e(report);
  report.success = ok;
  report.report_path = writeReport(report);

  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
