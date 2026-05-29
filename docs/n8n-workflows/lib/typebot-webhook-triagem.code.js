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

const typebot_context = {
  patient_name: pick(body.patient_name, body.nome, body.Nome_Completo),
  birth_date: pick(body.birth_date, body.data_nascimento),
  address: pick(body.address, body.Endereco, body.endereco),
  cep: pick(body.cep, body.CEP),
  payment_status: pick(body.payment_status),
  pagamento_status: pick(body.pagamento_status),
  pagamento: pick(body.pagamento),
  eligibility_status: pick(body.eligibility_status),
  ineligibility_reason: pick(body.ineligibility_reason),
  has_previous_prescription: body.has_previous_prescription,
  has_prescription_photo_ready: body.has_prescription_photo_ready,
  previous_prescription_file: pick(
    body.previous_prescription_file,
    body.foto_receita_url,
    body.prescription_photo_url
  ),
  foto_receita_url: pick(body.foto_receita_url, body.previous_prescription_file),
  medications: body.medications,
  medication_1_name: body.medication_1_name,
  medication_1_dose: body.medication_1_dose,
  medication_1_frequency: body.medication_1_frequency,
  medication_1_route: body.medication_1_route,
  medication_2_name: body.medication_2_name,
  medication_2_dose: body.medication_2_dose,
  medication_2_frequency: body.medication_2_frequency,
  medication_2_route: body.medication_2_route,
  medication_3_name: body.medication_3_name,
  medication_3_dose: body.medication_3_dose,
  medication_3_frequency: body.medication_3_frequency,
  medication_3_route: body.medication_3_route,
  continuous_use_days: body.continuous_use_days,
  tempo_uso: pick(body.tempo_uso, triagem.tempo_uso),
  has_warning_signs: body.has_warning_signs,
  sinais_alerta: pick(body.sinais_alerta, triagem.sinais_alerta),
  protocol: pick(body.protocol),
  source: pick(body.source),
  typebot_public_id: pick(body.typebot_public_id),
  lgpd_accepted: body.lgpd_accepted,
  privacy_policy_accepted: body.privacy_policy_accepted,
  telemedicine_consent_accepted: body.telemedicine_consent_accepted,
  non_urgency_notice_accepted: body.non_urgency_notice_accepted,
  terms_of_use_accepted: body.terms_of_use_accepted,
  accepted_terms_at: body.accepted_terms_at,
  accepted_terms_links: body.accepted_terms_links,
  terms_presented: body.terms_presented,
  terms_accepted: body.terms_accepted
};

const triagemPayload = { paciente, triagem, typebot_context };

return [
  {
    json: {
      correlationId,
      idempotencyKey,
      triagemPayload
    }
  }
];
