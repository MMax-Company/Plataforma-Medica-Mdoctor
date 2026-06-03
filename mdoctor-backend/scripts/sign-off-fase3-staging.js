#!/usr/bin/env node
/**
 * Fase 3 — sign-off staging (API automatizado + checklist manual).
 * Gera docs/SIGN-OFF-FASE3-RELATORIO.md
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';
const PANEL = 'https://painel-medico-staging-staging.up.railway.app';
const REPORT_MD = path.join(__dirname, '../../docs/SIGN-OFF-FASE3-RELATORIO.md');

function loadRailwayVars() {
  try {
    const out = execSync(`railway variable list -p ${PROJECT} -e ${ENV} -s ${SERVICE} --json`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    for (const [key, value] of Object.entries(JSON.parse(out))) {
      if (value != null && value !== '') process.env[key] = String(value);
    }
  } catch (e) {
    console.error('Railway vars:', e.message);
  }
}

loadRailwayVars();

const lib = require('./homologacao-clinica-fase2-lib');

const PRONTUARIO_FIELDS = [
  'queixa_principal',
  'historico_clinico',
  'exame_fisico_telemedicina',
  'conduta_sugerida',
  'orientacoes_clinicas'
];

function checkProntuario(clinical = {}) {
  const fields = {};
  const missing = [];
  for (const f of PRONTUARIO_FIELDS) {
    const ok = Boolean(clinical[f] && String(clinical[f]).trim().length > 3);
    fields[f] = ok;
    if (!ok) missing.push(f);
  }
  const medicacao = Boolean(
    clinical.medicacao_em_uso || clinical.medicamento || clinical.medications?.length
  );
  const receita = Boolean(
    clinical.foto_receita_url || clinical.previous_prescription_file || clinical.previous_prescription_url
  );
  return { fields, missing, medicacao, receita, complete: missing.length === 0 && medicacao && receita };
}

async function run() {
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'staging',
    backend_url: lib.BACKEND_URL,
    panel_url: PANEL,
    automated: { sections: {}, steps: [], success: false },
    manual_ui: {
      status: 'PENDENTE_OPERADOR',
      checklist_ref: 'docs/RUNBOOK-SIGN-OFF-FASE3.md'
    },
    gate: {
      fase3_api: false,
      fase3_manual: false,
      memed_producao_liberado: false
    },
    atendimento_ids: {}
  };

  const correlationId = `fase3-signoff-${Date.now()}`;
  const session = await lib.loginMedico(correlationId);
  report.automated.steps.push({ name: 'login', ok: session.ok, status: session.status });
  if (!session.ok) {
    writeReport(report);
    process.exit(1);
  }

  const token = session.token;
  const headers = lib.authHeaders(token, correlationId);

  const reasons = await lib.fetchRejectReasons(token, correlationId);
  const reasonOk = reasons.ok && Array.isArray(reasons.data?.reasons) && reasons.data.reasons.length >= 8;
  report.automated.sections.reject_dropdown_api = {
    ok: reasonOk,
    count: reasons.data?.reasons?.length || 0
  };

  const created = await lib.createAtendimentoViaTriagem(correlationId);
  report.automated.steps.push({ name: 'create_atendimento', ok: created.ok, id: created.atendimentoId });
  if (!created.ok) {
    writeReport(report);
    process.exit(1);
  }
  const id = created.atendimentoId;
  report.atendimento_ids.primary = id;

  const detail = await lib.getAtendimento(token, id, correlationId);
  const at = detail.data?.atendimento || detail.data;
  const clinical = at?.dados_clinicos || {};
  const prontuario = checkProntuario(clinical);

  report.automated.sections.fila = {
    ok: at?.status === 'waiting',
    status: at?.status,
    pagamento_confirmado: String(at?.pagamento_status || '').toUpperCase() === 'CONFIRMADO',
    elegivel: at?.elegibilidade?.eligible === true || at?.risco === 'BAIXO',
    risco: at?.elegibilidade?.riskLevel || at?.risco,
    receita_anterior: prontuario.receita
  };

  report.automated.sections.atendimento = {
    ok: Boolean(at?.paciente_nome),
    prontuario,
    has_historico_endpoint: true
  };

  const list = await lib.requestJson(`${lib.BACKEND_URL}/api/atendimentos?scope=medical`, { headers });
  const items = list.data?.atendimentos || [];
  const inMedicalList = items.some((i) => i.id === id);
  report.automated.sections.fila_lista = { ok: inMedicalList, total_medical: items.length };

  const approve1 = await lib.clinicalApprove(token, id, correlationId);
  const approve1Ok = approve1.ok && approve1.data?.atendimento?.status === 'approved';
  report.automated.sections.approve = {
    ok: approve1Ok,
    status: approve1.data?.atendimento?.status,
    memedEmission: approve1.data?.memed?.emission
  };

  const receipt = await lib.persistMemedReceipt(token, id, correlationId);
  report.automated.sections.memed_receipt = {
    ok: receipt.ok,
    status: receipt.data?.atendimento?.status
  };

  const approveDup = await lib.clinicalApprove(token, id, `${correlationId}-dup`);
  const dupBlocked = approveDup.status === 409 || approveDup.data?.error?.includes('duplicada');
  report.automated.sections.duplicate_approve_block = {
    ok: dupBlocked,
    status: approveDup.status,
    error: approveDup.data?.error
  };

  const validate = await lib.clinicalValidate(token, id, correlationId);
  report.automated.sections.ready = {
    ok: validate.ok && validate.data?.atendimento?.status === 'ready',
    status: validate.data?.atendimento?.status
  };

  const deliver = await lib.deliverPrescription(token, id, correlationId);
  report.automated.sections.deliver_mock = {
    ok: deliver.ok && deliver.data?.atendimento?.status === 'delivered',
    status: deliver.data?.atendimento?.status,
    provider: deliver.data?.delivery?.provider
  };

  const rejectCreated = await lib.createAtendimentoViaTriagem(`${correlationId}-rej`);
  report.atendimento_ids.reject = rejectCreated.atendimentoId;
  const reject = await lib.clinicalReject(
    token,
    rejectCreated.atendimentoId,
    `${correlationId}-rej`,
    'FORA_DO_PROTOCOLO',
    'Sign-off Fase 3 — reprovação teste'
  );
  const rejAt = reject.data?.atendimento;
  report.automated.sections.reject = {
    ok: reject.ok && rejAt?.status === 'rejected',
    reason_code: reject.data?.reason_code,
    motivo_rejeicao: rejAt?.dados_clinicos?.motivo_rejeicao,
    audit_code: rejAt?.dados_clinicos?.clinical_audit?.rejectReasonCode
  };

  let panelLogin = false;
  try {
    const res = await fetch(`${PANEL}/login`);
    panelLogin = res.ok;
  } catch {
    panelLogin = false;
  }
  report.automated.sections.panel = { login_page_ok: panelLogin, url: PANEL };

  const apiOk =
    reasonOk &&
    report.automated.sections.fila.ok &&
    prontuario.complete &&
    approve1Ok &&
    dupBlocked &&
    report.automated.sections.ready.ok &&
    report.automated.sections.deliver_mock.ok &&
    report.automated.sections.reject.ok &&
    panelLogin;

  report.automated.success = apiOk;
  report.gate.fase3_api = apiOk;
  report.gate.memed_producao_liberado = false;

  writeReport(report);
  console.log(JSON.stringify({ success: apiOk, report_md: REPORT_MD }, null, 2));
  process.exit(apiOk ? 0 : 1);
}

function writeReport(report) {
  const lines = [
    '# Sign-off Fase 3 — Relatório',
    '',
    `**Gerado:** ${report.generated_at}`,
    `**Ambiente:** staging`,
    `**Backend:** ${report.backend_url}`,
    `**Painel:** ${report.panel_url}`,
    '',
    '## Gate',
    '',
    '| Gate | Status |',
    '|------|--------|',
    `| API automatizada | ${report.gate.fase3_api ? 'APROVADO' : 'PENDENTE/FALHA'} |`,
    `| UI manual (ergonomia) | ${report.manual_ui.status} |`,
    `| Memed produção | ${report.gate.memed_producao_liberado ? 'LIBERADO' : 'BLOQUEADO até sign-off manual'} |`,
    '',
    '## IDs de teste',
    '',
    `- Primário (approve→deliver): \`${report.atendimento_ids.primary || '—'}\``,
    `- Reject: \`${report.atendimento_ids.reject || '—'}\``,
    '',
    '## Resultados API (automatizado)',
    ''
  ];

  for (const [section, data] of Object.entries(report.automated.sections)) {
    lines.push(`### ${section}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(data, null, 2));
    lines.push('```');
    lines.push('');
  }

  lines.push('## Checklist manual — UX médica (obrigatório antes Memed produção)');
  lines.push('');
  lines.push('Executar em: ' + PANEL);
  lines.push('');
  lines.push('| Item | OK | Observação |');
  lines.push('|------|-----|------------|');
  const manual = [
    'Fila — carregamento e cards legíveis',
    'Fila — elegibilidade/risco visíveis',
    'Atendimento — abertura rápida',
    'Atendimento — navegação sem erro',
    'Prontuário — doença/medicação/posologia',
    'Prontuário — conduta/orientações/exame telemedicina',
    'Approve — botão, loading, transição approved → receita Sinapse',
    'Reject — dropdown motivos + persistência visual',
    'Deliver mock — feedback ao médico',
    'Concorrência — 1 médico na fila (procedimento)'
  ];
  for (const item of manual) {
    lines.push(`| ${item} | [ ] | |`);
  }
  lines.push('');
  lines.push('## Assinatura');
  lines.push('');
  lines.push('| Campo | Valor |');
  lines.push('|-------|--------|');
  lines.push('| Data | |');
  lines.push('| Médico supervisor | |');
  lines.push('| Resultado manual | [ ] Aprovado [ ] Ressalvas [ ] Bloqueado |');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('**Próximo passo após manual OK:** `docs/MEMED-PRODUCAO-HOMOLOGACAO.md` (Etapa 3).');

  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');
  fs.writeFileSync(
    path.join(__dirname, '../../docs/SIGN-OFF-FASE3-RELATORIO.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
