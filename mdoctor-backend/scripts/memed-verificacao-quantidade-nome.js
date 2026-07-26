#!/usr/bin/env node
/**
 * Cria e aprova um atendimento de homologação em staging com um medicamento
 * parametrizável (default: Captopril 25mg 2x ao dia — quantidade real
 * esperada: 120 comprimidos), para verificação manual do PDF final assinado
 * na Memed após o fix de memed-payload.service.js (quantidade embutida em
 * "nome", quantidade:1 enviada ao addItem).
 *
 * Uso: LOAD_RAILWAY_VARS=0 node scripts/memed-verificacao-quantidade-nome.js
 * Override: MED_NOME=Losartana MED_DOSE=50 MED_FREQ="1x ao dia" node ...
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const lib = require('./homologacao-clinica-fase2-lib');

const PANEL_STAGING = 'https://painel-medico-staging-staging.up.railway.app';
const MED_NOME = process.env.MED_NOME || 'Captopril';
const MED_DOSE = process.env.MED_DOSE || '25';
const MED_FREQ = process.env.MED_FREQ || '2x ao dia';
const REPORT_PATH =
  process.env.REPORT_PATH ||
  path.join(__dirname, '../../docs/MEMED-VERIFICACAO-QUANTIDADE-NOME.json');

async function createAtendimentoCaptopril(correlationId) {
  const ts = Date.now();
  const idempotencyKey = `memed-verif-qtd-${ts}`;
  const phone = `55119${String(ts).slice(-8)}`;
  const payload = {
    paciente: {
      nome: `Paciente Verificacao Memed ${ts}`,
      telefone: phone,
      cpf: '12345678909',
      email: `memed.verif.${ts}@example.com`,
      data_nascimento: '15/08/1988',
      endereco: 'Rua Aurora, 965, Santa Ifigênia, São Paulo, SP',
      cep: '01209003'
    },
    triagem: {
      doencas: 'Hipertensão arterial (HAS)',
      medicacao_em_uso: `${MED_NOME} ${MED_DOSE}mg`,
      tempo_uso: 'Mais de 6 meses',
      receita_anterior: 'sim',
      sinais_alerta: 'não',
      observacoes: 'Homologação — verificação de quantidade embutida no nome (fix Memed)'
    },
    typebot_context: {
      pagamento_status: 'CONFIRMADO',
      payment_status: 'paid',
      payment_confirmed: true,
      has_previous_prescription: 'sim',
      receita_anterior: 'sim',
      previous_prescription_file: 'https://example.com/receita-verif.jpg',
      foto_receita_url: 'https://example.com/receita-verif.jpg',
      eligibility_status: 'eligible',
      lgpd_accepted: true,
      privacy_policy_accepted: true,
      telemedicine_consent_accepted: true,
      non_urgency_notice_accepted: true,
      terms_of_use_accepted: true,
      med1_nome: MED_NOME,
      med1_dose: MED_DOSE,
      med1_via: 'oral',
      med1_frequencia: MED_FREQ
    }
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
    'Idempotency-Key': idempotencyKey
  };
  if (process.env.N8N_WEBHOOK_SECRET) headers['X-MDoctor-Webhook-Secret'] = process.env.N8N_WEBHOOK_SECRET;

  const triagem = await lib.requestJson(`${lib.BACKEND_URL}/api/webhook/triagem`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const atendimentoId = triagem.data?.atendimentoId || triagem.data?.atendimento?.id;
  return {
    ok: triagem.ok && Boolean(atendimentoId),
    atendimentoId,
    triagemStatus: triagem.status,
    triagemBody: triagem.data
  };
}

const AUTO_APPROVE = process.env.AUTO_APPROVE !== '0';

async function main() {
  const correlationId = `memed-verif-qtd-${Date.now()}`;
  const report = { executed_at: new Date().toISOString(), backend: lib.BACKEND_URL, panel: PANEL_STAGING, correlationId, steps: [] };
  function step(name, ok, extra = {}) {
    report.steps.push({ name, ok, ...extra });
  }

  const created = await createAtendimentoCaptopril(correlationId);
  step('triagem', created.ok, { atendimentoId: created.atendimentoId, triagemStatus: created.triagemStatus });
  if (!created.atendimentoId) {
    report.error = 'triagem_failed';
    report.triagemBody = created.triagemBody;
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const atendimentoId = created.atendimentoId;
  report.atendimentoId = atendimentoId;

  const login = await lib.loginMedico(correlationId);
  step('medico_login', login.ok, { status: login.status, error: login.error });
  if (!login.token) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  if (AUTO_APPROVE) {
    const approve = await lib.clinicalApprove(login.token, atendimentoId, correlationId);
    step('clinical_approve', approve.ok, { status: approve.data?.atendimento?.status });
  } else {
    step('clinical_approve', true, { skipped: true, reason: 'AUTO_APPROVE=0 — aprovação fica para o médico no painel' });
  }

  const detail = await lib.getAtendimento(login.token, atendimentoId, correlationId);
  const at = detail.data?.atendimento || {};
  step('atendimento_status', true, {
    status: at.status,
    paciente_nome: at.paciente_nome,
    medications: at.dados_clinicos?.medications
  });

  const memedPayload = await lib.requestJson(`${lib.BACKEND_URL}/api/memed/payload/${atendimentoId}`, {
    headers: lib.authHeaders(login.token, correlationId)
  });
  step('memed_payload_preview', memedPayload.ok, {
    addItems: memedPayload.data?.addItems || memedPayload.data?.payload?.addItems
  });

  report.urls = {
    receita: `${PANEL_STAGING}/receita?atendimentoId=${atendimentoId}`,
    atendimento: `${PANEL_STAGING}/atendimento/${atendimentoId}`,
    fila: `${PANEL_STAGING}/fila`
  };
  report.instrucao = AUTO_APPROVE
    ? 'Login no painel com as credenciais do médico, abrir a URL de receita acima, emitir e assinar via widget Memed, e conferir no PDF final o texto do item.'
    : 'Atendimento criado via /api/webhook/triagem (mesma via oficial do Typebot/n8n) e está na fila aguardando revisão. Login no painel, abrir a fila (ou a URL de atendimento acima), revisar e aprovar clinicamente como de costume, e então seguir o fluxo normal até a Memed.';
  report.ok = report.steps.every((s) => s.ok);

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
