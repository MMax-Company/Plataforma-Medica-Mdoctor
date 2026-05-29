/**
 * n8n Code node: Typebot / webhook → POST /api/webhook/triagem (Doctor Prescreve)
 * Sync into typebot-webhook-staging.json when editing.
 */
const input = $input.first().json || {};
const headers = input.headers || {};
const body = input.body || input;

function pick(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function digits(v) {
  return String(v || '').replace(/\D/g, '');
}

const correlationId =
  headers['x-correlation-id'] ||
  headers['X-Correlation-Id'] ||
  body.correlation_id ||
  `typebot-${Date.now()}`;

const idempotencyKey =
  headers['idempotency-key'] ||
  headers['Idempotency-Key'] ||
  body.idempotency_key ||
  `triagem-${digits(body.paciente?.telefone || body.telefone)}-${Date.now()}`;

let paciente;
let triagem;

if (body.paciente && body.triagem) {
  paciente = {
    nome: pick(body.paciente.nome),
    telefone: pick(body.paciente.telefone),
    cpf: pick(body.paciente.cpf),
    email: pick(body.paciente.email)
  };
  triagem = {
    doencas: pick(body.triagem.doencas),
    medicacao_em_uso: pick(body.triagem.medicacao_em_uso),
    tempo_uso: pick(body.triagem.tempo_uso),
    receita_anterior: pick(body.triagem.receita_anterior),
    sinais_alerta: pick(body.triagem.sinais_alerta),
    observacoes: pick(body.triagem.observacoes)
  };
} else {
  const telefone = digits(
    pick(body.telefone, body.whatsapp, body.from, body.paciente_telefone, body.phone)
  );
  paciente = {
    nome: pick(body.patient_name, body.nome, body.Nome_Completo, body.paciente_nome),
    telefone: telefone || pick(body.telefone, body.whatsapp),
    cpf: digits(pick(body.cpf, body.cpf_paciente)),
    email: pick(body.email, body.Email, body.paciente_email)
  };
  triagem = {
    doencas: pick(
      body.triagem?.doencas,
      body.doenca_cronica,
      body.chronic_condition,
      body.doencas,
      body.condition
    ),
    medicacao_em_uso: pick(
      body.triagem?.medicacao_em_uso,
      body.medicacao_em_uso,
      body.primeiro_medicamento,
      body.medication_name
    ),
    tempo_uso: pick(body.triagem?.tempo_uso, body.tempo_uso),
    receita_anterior: pick(
      body.triagem?.receita_anterior,
      body.receita_anterior,
      body.has_previous_prescription
    ),
    sinais_alerta: pick(body.triagem?.sinais_alerta, body.sinais_alerta),
    observacoes: pick(body.triagem?.observacoes, body.observacoes, body.text)
  };
}

if (!paciente.nome) throw new Error('paciente.nome é obrigatório');
if (!triagem.doencas) throw new Error('triagem.doencas é obrigatório');
if (!paciente.telefone) throw new Error('paciente.telefone é obrigatório');

const triagemPayload = { paciente, triagem };

return [
  {
    json: {
      correlationId,
      idempotencyKey,
      triagemPayload
    }
  }
];
