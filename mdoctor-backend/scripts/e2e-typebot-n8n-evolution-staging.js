/**
 * E2E dry-run: Typebot payload -> n8n staging -> backend staging -> prescription mock -> delivery dry-run
 *
 * Env:
 *   N8N_WEBHOOK_URL (default n8n staging typebot-webhook)
 *   N8N_WEBHOOK_SECRET
 *   BACKEND_URL
 *   MEDICO_USER / MEDICO_PASS
 */

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL || 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook';
const BACKEND_URL = process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app';
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';
const MEDICO_USER = process.env.MEDICO_USER || 'staging-doctor';
const MEDICO_PASS = process.env.MEDICO_PASS || '';

const ts = Date.now();
const correlationId = `e2e-tne-${ts}`;
const idempotencyKey = `e2e-tne-key-${ts}`;
const phone = '5511988776655';

const typebotPayload = {
  patient_name: `Paciente Ficticio E2E ${ts}`,
  nome: `Paciente Ficticio E2E ${ts}`,
  telefone: phone,
  whatsapp: phone,
  cpf: '12345678909',
  email: `e2e.tne.${ts}@example.com`,
  birth_date: '15/08/1988',
  data_nascimento: '15/08/1988',
  address: 'Rua Teste, 100',
  cep: '01310100',
  chronic_condition: 'has',
  doenca_cronica: 'has',
  medication_count: 1,
  medication_name: 'losartana',
  med1_nome: 'losartana',
  med1_dose: '50mg',
  med1_frequencia: '1x ao dia',
  med1_via: 'oral',
  medicacao: 'losartana 50mg',
  uso_continuo: 'sim',
  has_previous_prescription: 'sim',
  receita_anterior: 'sim',
  previous_prescription_file: 'https://example.com/receita-e2e.jpg',
  foto_receita_url: 'https://example.com/receita-e2e.jpg',
  tempo_uso: 'Mais de 6 meses',
  sinais_alerta: 'NAO',
  has_warning_signs: false,
  eligibility_status: 'eligible',
  lgpd: 'sim',
  consentimento: 'sim',
  address: 'Rua E2E, 100',
  cep: '01310100',
  payment_status: 'paid',
  pagamento_status: 'CONFIRMADO',
  from: phone,
  text: 'HAS renovacao uso continuo sem sinais de alerta losartana 50mg 180 dias'
};

function buildWebhookText(payload) {
  return [
    `Nome: ${payload.nome}`,
    `Telefone: ${payload.telefone}`,
    `CPF: ${payload.cpf}`,
    `Email: ${payload.email}`,
    `Nascimento: ${payload.data_nascimento}`,
    `Condicao: ${payload.condicao}`,
    `Medicacao: ${payload.medicacao}`,
    `Uso continuo: ${payload.uso_continuo}`,
    `Receita anterior: ${payload.receita_anterior}`,
    `Tempo uso: ${payload.tempo_uso}`,
    `Sinais alerta: ${payload.sinais_alerta}`,
    `LGPD: ${payload.lgpd}`,
    `Consentimento: ${payload.consentimento}`
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
  return { response, data };
}

async function main() {
  const report = { steps: [] };

  const n8nBody = {
    ...typebotPayload,
    from: phone,
    text: buildWebhookText(typebotPayload),
    rawMessage: {
      messageId: idempotencyKey,
      channel: 'typebot',
      original: typebotPayload
    }
  };

  const n8n = await requestJson(N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(n8nBody)
  });
  report.steps.push({
    name: 'n8n_typebot_webhook',
    status: n8n.response.status,
    ok: n8n.response.ok,
    duplicate: n8n.data?.duplicate,
    correlationId: n8n.data?.correlationId,
    atendimentoId: n8n.data?.atendimento?.id
  });

  if (!n8n.response.ok) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  let atendimentoId = n8n.data?.atendimento?.id;
  if (!atendimentoId && MEDICO_PASS) {
    const loginProbe = await requestJson(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS })
    });
    const probeToken = loginProbe.data?.token;
    if (probeToken) {
      const listProbe = await requestJson(`${BACKEND_URL}/api/atendimentos`, {
        headers: { Authorization: `Bearer ${probeToken}` }
      });
      const items = Array.isArray(listProbe.data?.atendimentos)
        ? listProbe.data.atendimentos
        : [];
      const match = items.find(
        (item) =>
          String(item.paciente_telefone || item.telefone || '').replace(/\D/g, '') === phone &&
          String(item.origem || '').includes('whatsapp')
      );
      atendimentoId = match?.id;
      report.steps.push({
        name: 'atendimento_resolve_after_n8n',
        ok: Boolean(atendimentoId),
        resolvedFromList: true
      });
    }
  }
  if (!atendimentoId) {
    report.error = 'atendimento_id_missing_from_n8n_response';
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const providerStatus = await requestJson(`${BACKEND_URL}/api/whatsapp/provider-status`, {
    headers: { 'X-Correlation-Id': correlationId }
  });
  report.steps.push({
    name: 'provider_status',
    status: providerStatus.response.status,
    provider: providerStatus.data?.provider,
    dryRun: providerStatus.data?.dryRun,
    evolutionConfigured: providerStatus.data?.evolution?.configured,
    instanceState: providerStatus.data?.evolution?.instanceState
  });

  if (!MEDICO_PASS) {
    report.warning = 'MEDICO_PASS not set; skipping auth flow steps';
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const login = await requestJson(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS })
  });
  const token = login.data?.token;
  report.steps.push({ name: 'login', status: login.response.status, ok: Boolean(token) });

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId
  };

  const list = await requestJson(`${BACKEND_URL}/api/atendimentos`, { headers: authHeaders });
  const listItems = Array.isArray(list.data?.atendimentos)
    ? list.data.atendimentos
    : Array.isArray(list.data)
      ? list.data
      : Array.isArray(list.data?.items)
        ? list.data.items
        : [];
  const foundInList = listItems.some((item) => item.id === atendimentoId);
  report.steps.push({
    name: 'atendimentos_list',
    status: list.response.status,
    foundInList
  });

  const approve = await requestJson(`${BACKEND_URL}/api/atendimentos/${atendimentoId}/status`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ status: 'ready' })
  });
  report.steps.push({ name: 'approve', status: approve.response.status });

  const prescription = await requestJson(`${BACKEND_URL}/api/prescriptions/${atendimentoId}/generate`, {
    method: 'POST',
    headers: authHeaders
  });
  report.steps.push({
    name: 'prescription_generate',
    status: prescription.response.status,
    source: prescription.data?.source || prescription.data?.prescription?.source
  });

  const deliver = await requestJson(`${BACKEND_URL}/api/atendimentos/${atendimentoId}/deliver`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ channel: 'whatsapp', target: `+${phone}` })
  });
  report.steps.push({
    name: 'deliver',
    status: deliver.response.status,
    provider: deliver.data?.delivery?.provider,
    deliveryStatus: deliver.data?.delivery?.status
  });

  const testSend = await requestJson(`${BACKEND_URL}/api/whatsapp/test-send`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      to: phone,
      message: 'E2E dry-run Evolution via test-send',
      pacienteNome: typebotPayload.nome
    })
  });
  report.steps.push({
    name: 'test_send_dry_run',
    status: testSend.response.status,
    provider: testSend.data?.delivery?.provider
  });

  const panelDash = await fetch('https://painel-medico-staging-staging.up.railway.app/dashboard');
  report.steps.push({ name: 'panel_dashboard', status: panelDash.status });

  report.summary = {
    atendimentoId,
    n8nOk: n8n.response.ok,
    dryRunDelivery: deliver.data?.delivery?.provider === 'dry-run' || testSend.data?.delivery?.provider === 'dry-run',
    realMessageSent: false
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
