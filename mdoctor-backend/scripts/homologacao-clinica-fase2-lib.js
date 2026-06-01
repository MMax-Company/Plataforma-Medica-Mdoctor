/**
 * Biblioteca compartilhada — homologação clínica Fase 2 (staging).
 */
const fs = require('fs');
const path = require('path');

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ||
  'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook';
const BACKEND_URL = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';
function medicoUser() {
  return process.env.MEDICO_USER || 'staging-doctor';
}

function medicoPass() {
  return process.env.MEDICO_PASS || '';
}

const REPORT_PATH =
  process.env.REPORT_PATH ||
  path.join(__dirname, '../../docs/HOMOLOGACAO-CLINICA-FASE2-RELATORIO.json');

const VALID_REJECT_CODES = [
  'RED_FLAG',
  'DOCUMENTACAO_INSUFICIENTE',
  'RECEITA_AUSENTE',
  'FORA_DO_PROTOCOLO',
  'MEDICACAO_INCOMPATIVEL',
  'RISCO_CLINICO',
  'DADOS_INCONSISTENTES',
  'OUTROS'
];

function buildTypebotPayload(ts = Date.now()) {
  const phone = `55119${String(ts).slice(-8)}`;
  return {
    patient_name: `Paciente Fase2 ${ts}`,
    nome: `Paciente Fase2 ${ts}`,
    telefone: phone,
    whatsapp: phone,
    cpf: '12345678909',
    email: `fase2.${ts}@example.com`,
    birth_date: '15/08/1988',
    data_nascimento: '15/08/1988',
    chronic_condition: 'has',
    doenca_cronica: 'has',
    medication_count: 1,
    med1_nome: 'losartana',
    med1_dose: '50mg',
    med1_frequencia: '1x ao dia',
    medicacao: 'losartana 50mg',
    uso_continuo: 'sim',
    has_previous_prescription: 'sim',
    receita_anterior: 'sim',
    previous_prescription_file: 'https://example.com/receita-fase2.jpg',
    foto_receita_url: 'https://example.com/receita-fase2.jpg',
    tempo_uso: 'Mais de 6 meses',
    sinais_alerta: 'NAO',
    has_warning_signs: false,
    eligibility_status: 'eligible',
    lgpd: 'sim',
    consentimento: 'sim',
    address: 'Rua Fase2, 100',
    cep: '01310100',
    payment_status: 'paid',
    pagamento_status: 'CONFIRMADO',
    from: phone,
    text: 'HAS renovacao losartana 50mg sem sinais de alerta'
  };
}

function buildWebhookText(payload) {
  return [
    `Nome: ${payload.nome}`,
    `Telefone: ${payload.telefone}`,
    `Medicacao: ${payload.medicacao}`,
    `Receita anterior: ${payload.receita_anterior}`,
    `Pagamento: ${payload.pagamento_status}`
  ].join('\n');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data, ok: response.ok, status: response.status };
}

async function loginMedico(correlationId) {
  const pass = medicoPass();
  if (!pass) {
    return { ok: false, error: 'MEDICO_PASS not set', token: null };
  }
  const login = await requestJson(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
    body: JSON.stringify({ user: medicoUser(), password: pass })
  });
  return {
    ok: Boolean(login.data?.token),
    token: login.data?.token || null,
    status: login.status,
    error: login.data?.error
  };
}

function authHeaders(token, correlationId) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId
  };
}

async function createAtendimentoViaTriagem(correlationId) {
  const ts = Date.now();
  const idempotencyKey = `fase2-triagem-${ts}`;
  const phone = `55119${String(ts).slice(-8)}`;
  const payload = {
    paciente: {
      nome: `Paciente Fase2 ${ts}`,
      telefone: phone,
      cpf: '12345678909',
      email: `fase2.${ts}@example.com`,
      data_nascimento: '15/08/1988',
      endereco: 'Rua Fase2, 100',
      cep: '01310100'
    },
    triagem: {
      doencas: 'Hipertensão arterial (HAS)',
      medicacao_em_uso: 'losartana 50mg 1x ao dia',
      tempo_uso: 'Mais de 6 meses',
      receita_anterior: 'sim',
      sinais_alerta: 'não',
      observacoes: 'Homologação clínica Fase 2 — triagem direta'
    },
    typebot_context: {
      pagamento_status: 'CONFIRMADO',
      payment_status: 'paid',
      payment_confirmed: true,
      has_previous_prescription: 'sim',
      receita_anterior: 'sim',
      previous_prescription_file: 'https://example.com/receita-fase2.jpg',
      foto_receita_url: 'https://example.com/receita-fase2.jpg',
      eligibility_status: 'eligible'
    }
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
    'Idempotency-Key': idempotencyKey
  };
  if (SECRET) headers['X-MDoctor-Webhook-Secret'] = SECRET;

  const triagem = await requestJson(`${BACKEND_URL}/api/webhook/triagem`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const atendimentoId = triagem.data?.atendimentoId || triagem.data?.atendimento?.id;
  return {
    ok: triagem.ok && Boolean(atendimentoId),
    atendimentoId,
    payload: { telefone: phone },
    source: 'backend_triagem',
    triagemStatus: triagem.status,
    triagemBody: triagem.data
  };
}

async function createAtendimentoViaN8n(correlationId) {
  const triagemFirst = await createAtendimentoViaTriagem(correlationId);
  if (triagemFirst.ok) return { ...triagemFirst, n8nSkipped: true };

  const ts = Date.now();
  const idempotencyKey = `fase2-${ts}`;
  const payload = buildTypebotPayload(ts);
  const n8nBody = {
    ...payload,
    from: payload.telefone,
    text: buildWebhookText(payload),
    rawMessage: { messageId: idempotencyKey, channel: 'typebot', original: payload }
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
    'Idempotency-Key': idempotencyKey
  };
  if (SECRET) headers['X-MDoctor-Webhook-Secret'] = SECRET;

  const n8n = await requestJson(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(n8nBody)
  });

  let atendimentoId = n8n.data?.atendimento?.id;
  if (!atendimentoId && medicoPass()) {
    const session = await loginMedico(correlationId);
    if (session.token) {
      const list = await requestJson(`${BACKEND_URL}/api/atendimentos`, {
        headers: authHeaders(session.token, correlationId)
      });
      const items = Array.isArray(list.data?.atendimentos) ? list.data.atendimentos : [];
      const phoneDigits = String(payload.telefone).replace(/\D/g, '');
      const match = items.find(
        (item) => String(item.paciente_telefone || '').replace(/\D/g, '') === phoneDigits
      );
      atendimentoId = match?.id;
    }
  }

  return {
    ok: n8n.ok && Boolean(atendimentoId),
    atendimentoId,
    payload,
    n8nStatus: n8n.status,
    n8nBody: n8n.data
  };
}

async function getAtendimento(token, atendimentoId, correlationId) {
  return requestJson(`${BACKEND_URL}/api/atendimentos/${atendimentoId}`, {
    headers: authHeaders(token, correlationId)
  });
}

async function clinicalApprove(token, atendimentoId, correlationId) {
  return requestJson(`${BACKEND_URL}/api/atendimentos/${atendimentoId}/clinical/approve`, {
    method: 'POST',
    headers: authHeaders(token, correlationId),
    body: JSON.stringify({
      motivo: 'Homologação Fase 2 — aprovação clínica automatizada',
      observacao_medica: 'E2E Fase 2 approve'
    })
  });
}

async function persistMemedReceipt(token, atendimentoId, correlationId, overrides = {}) {
  return requestJson(`${BACKEND_URL}/api/memed/receita`, {
    method: 'POST',
    headers: authHeaders(token, correlationId),
    body: JSON.stringify({
      atendimentoId,
      receitaId: overrides.receitaId || `mock-receipt-${Date.now()}`,
      pdfUrl: overrides.pdfUrl || `https://example.invalid/mock-receipt-${atendimentoId}.pdf`,
      payload: { mock: true, correlationId, ...(overrides.payload || {}) }
    })
  });
}

async function clinicalValidate(token, atendimentoId, correlationId) {
  return requestJson(`${BACKEND_URL}/api/atendimentos/${atendimentoId}/clinical/validate`, {
    method: 'POST',
    headers: authHeaders(token, correlationId),
    body: JSON.stringify({ motivo: 'Homologação Fase 2 — validação Memed mock' })
  });
}

async function clinicalReject(token, atendimentoId, correlationId, reasonCode = 'FORA_DO_PROTOCOLO', detail) {
  return requestJson(`${BACKEND_URL}/api/atendimentos/${atendimentoId}/clinical/reject`, {
    method: 'POST',
    headers: authHeaders(token, correlationId),
    body: JSON.stringify({
      reason_code: reasonCode,
      motivo: detail || 'Homologação Fase 2 — reprovação automatizada',
      observacao_medica: detail || null
    })
  });
}

async function deliverPrescription(token, atendimentoId, correlationId, channel = 'whatsapp') {
  const detail = await getAtendimento(token, atendimentoId, correlationId);
  const phone = detail.data?.atendimento?.paciente_telefone || detail.data?.paciente_telefone;
  return requestJson(`${BACKEND_URL}/api/atendimentos/${atendimentoId}/deliver`, {
    method: 'POST',
    headers: authHeaders(token, correlationId),
    body: JSON.stringify({ channel, target: phone ? `+${String(phone).replace(/\D/g, '')}` : undefined })
  });
}

async function fetchRejectReasons(token, correlationId) {
  return requestJson(`${BACKEND_URL}/api/atendimentos/clinical/reject-reasons`, {
    headers: authHeaders(token, correlationId)
  });
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  return REPORT_PATH;
}

function summarizeStep(name, result, extra = {}) {
  return {
    name,
    status: result.status,
    ok: result.ok,
    error: result.data?.error,
    ...extra
  };
}

module.exports = {
  BACKEND_URL,
  N8N_WEBHOOK_URL,
  medicoUser,
  medicoPass,
  REPORT_PATH,
  VALID_REJECT_CODES,
  buildTypebotPayload,
  requestJson,
  loginMedico,
  authHeaders,
  createAtendimentoViaTriagem,
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
};
