#!/usr/bin/env node
/**
 * Cria e aprova um atendimento de homologação em staging com Captopril 25mg
 * 2x ao dia (quantidade real esperada: 120 comprimidos), para verificação
 * manual do PDF final assinado na Memed após o fix de memed-payload.service.js
 * (quantidade embutida em "nome", quantidade:1 enviada ao addItem).
 *
 * Uso: LOAD_RAILWAY_VARS=0 node scripts/memed-verificacao-quantidade-nome.js
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
      medicacao_em_uso: 'Captopril 25mg',
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
      med1_nome: 'Captopril',
      med1_dose: '25',
      med1_via: 'oral',
      med1_frequencia: '2x ao dia'
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

async function main() {
  const correlationId = `memed-verif-qtd-${Date.now()}`;
  const report = { executed_at: new Date().toISOString(), backend: lib.BACKEND_URL, panel: PANEL, correlationId, steps: [] };
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

  const approve = await lib.clinicalApprove(login.token, atendimentoId, correlationId);
  step('clinical_approve', approve.ok, { status: approve.data?.atendimento?.status });

  const detail = await lib.getAtendimento(login.token, atendimentoId, correlationId);
  const at = detail.data?.atendimento || {};
  step('atendimento_approved', String(at.status || '').toLowerCase() === 'approved', {
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
    receita: `${PANEL}/receita?atendimentoId=${atendimentoId}`,
    atendimento: `${PANEL}/atendimento/${atendimentoId}`,
    fila: `${PANEL}/fila`
  };
  report.expected_addItem_nome_contains = '120 comprimidos';
  report.instrucao =
    'Login no painel com as credenciais do médico, abrir a URL de receita acima, emitir e assinar via widget Memed, e conferir no PDF final se aparece "Captopril 25 mg (120 comprimidos)" sem "1 embalagem" em destaque.';
  report.ok = report.steps.every((s) => s.ok);

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
