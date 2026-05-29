#!/usr/bin/env node
/**
 * Homologação funcional: Typebot (payload flat) → n8n prod → /api/webhook/triagem → fila médica.
 *
 * Env:
 *   N8N_WEBHOOK_URL (default prod typebot-webhook)
 *   BACKEND_URL (default web-production)
 *   N8N_WEBHOOK_SECRET (opcional; probe direto no backend)
 *   HOMOLOG_PRESCRIPTION_URL (URL pública de receita para aparecer na fila médica)
 */
const N8N = String(
  process.env.N8N_WEBHOOK_URL || 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook'
).replace(/\/$/, '');
const BACKEND = String(process.env.BACKEND_URL || 'https://web-production-5f178.up.railway.app').replace(
  /\/$/,
  ''
);
const RX_URL =
  process.env.HOMOLOG_PRESCRIPTION_URL ||
  'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/sample-receita-homolog.pdf';

const stamp = Date.now();
const phone = `55119${String(stamp).slice(-8)}`;
const patientLabel =
  process.env.HOMOLOG_PATIENT_NAME || process.env.PACIENTE_NOME_CONTAINS || `Homologação Typebot ${stamp}`;

/** Corpo espelhando o bloco Webhook do Typebot produção (flat, não nested). */
const typebotFlatBody = {
  from: phone,
  telefone: phone,
  patient_name: patientLabel,
  birth_date: '15/03/1985',
  cpf: '52998224725',
  whatsapp: phone,
  email: `homolog+${stamp}@doctorprescreve.com`,
  address: 'Av. Paulista, 1000 — São Paulo/SP',
  cep: '01310100',
  chronic_condition: 'hipertensão arterial',
  continuous_use_days: '45',
  tempo_uso: 'mais de 30 dias',
  has_warning_signs: 'false',
  sinais_alerta: 'não',
  eligibility_status: 'eligible',
  ineligibility_reason: '',
  has_previous_prescription: 'true',
  has_prescription_photo_ready: 'true',
  previous_prescription_file: RX_URL,
  foto_receita_url: RX_URL,
  medication_count: '1',
  medication_1_name: 'Losartana',
  medication_1_dose: '50mg',
  medication_1_frequency: '1x ao dia',
  medication_1_route: 'oral',
  medications: [
    { name: 'Losartana', dose: '50mg', frequency: '1x ao dia', route: 'oral' }
  ],
  medication_name: 'Losartana',
  medication_dose: '50mg',
  payment_status: 'paid',
  pagamento_status: 'CONFIRMADO',
  pagamento: 'pago',
  protocol: 'staging-clinical-v1',
  source: 'typebot-doctor-prescreve',
  nome: patientLabel,
  doenca_cronica: 'hipertensão arterial',
  text: `Operação assistida Doctor Prescreve — ${patientLabel}`,
  typebot_public_id: 'doctor-prescreve-8rmljgu',
  lgpd_accepted: 'true',
  privacy_policy_accepted: 'true',
  telemedicine_consent_accepted: 'true',
  non_urgency_notice_accepted: 'true',
  terms_of_use_accepted: 'true'
};

const report = {
  timestamp: new Date().toISOString(),
  n8n_url: N8N,
  backend_url: BACKEND,
  payload_sent: typebotFlatBody,
  n8n_response: null,
  atendimento: null,
  panel_queue: null,
  prontuario: null,
  errors: [],
  pending: []
};

function pickClinicalFields(atendimento = {}) {
  const c = atendimento.dados_clinicos || {};
  return {
    origem: atendimento.origem,
    status: atendimento.status,
    created_at: atendimento.created_at || atendimento.createdAt,
    updated_at: atendimento.updated_at || atendimento.updatedAt,
    pagamento_status: atendimento.pagamento_status,
    condicao: atendimento.condicao,
    elegibilidade: atendimento.elegibilidade,
    protocol_version: c.protocol_version,
    queue_type: c.queue_type,
    queixa_principal: c.queixa_principal,
    historico_clinico: c.historico_clinico,
    exame_fisico_telemedicina: c.exame_fisico_telemedicina,
    conduta_sugerida: c.conduta_sugerida,
    orientacoes_clinicas: c.orientacoes_clinicas,
    clinical_summary: c.clinical_summary,
    triagem_nested: c.triagem_nested,
    panel_visible_fields: {
      paid: String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO',
      eligible: atendimento.elegibilidade?.eligible === true,
      has_rx: Boolean(
        c.previous_prescription_file ||
          c.foto_receita_url ||
          c.previous_prescription_url ||
          c.prescription_photo_url
      )
    }
  };
}

async function main() {
  const correlationId = `homolog-typebot-${stamp}`;
  const idempotencyKey = correlationId;

  const n8nRes = await fetch(N8N, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(typebotFlatBody)
  });
  const n8nText = await n8nRes.text();
  try {
    report.n8n_response = { status: n8nRes.status, body: JSON.parse(n8nText) };
  } catch {
    report.n8n_response = { status: n8nRes.status, raw: n8nText.slice(0, 500) };
  }

  if (n8nRes.status !== 200 || report.n8n_response.body?.success !== true) {
    report.errors.push('n8n não retornou 200 com success:true');
  }

  const atendimentoId =
    report.n8n_response.body?.atendimentoId || report.n8n_response.body?.atendimento_id;
  if (!atendimentoId) {
    report.errors.push('atendimentoId ausente na resposta n8n');
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 1500));

  const one = await fetch(`${BACKEND}/api/atendimentos/${atendimentoId}`);
  if (one.ok) {
    const data = await one.json();
    report.atendimento = pickClinicalFields(data.atendimento || data);
    report.prontuario = {
      doenca: report.atendimento.condicao,
      medicacao: report.atendimento.triagem_nested?.triagem?.medicacao_em_uso,
      conduta: report.atendimento.conduta_sugerida,
      orientacoes: report.atendimento.orientacoes_clinicas,
      exame_fisico: report.atendimento.exame_fisico_telemedicina
    };
  } else {
    report.errors.push(`GET /api/atendimentos/${atendimentoId} -> ${one.status}`);
  }

  const queue = await fetch(`${BACKEND}/api/atendimentos?scope=medical`);
  if (queue.ok) {
    const q = await queue.json();
    const list = q.atendimentos || [];
    const inQueue = list.some((a) => a.id === atendimentoId);
    report.panel_queue = {
      total_medical_visible: list.length,
      atendimento_in_queue: inQueue,
      sample_ids: list.slice(0, 5).map((a) => a.id)
    };
    if (!inQueue) {
      report.pending.push(
        'Atendimento criado mas não visível em GET /api/atendimentos?scope=medical — conferir pagamento CONFIRMADO, elegível e foto de receita.'
      );
    }
  } else {
    report.errors.push(`GET fila médica -> ${queue.status}`);
  }

  if (!report.prontuario?.conduta) {
    report.pending.push('Prontuário automático incompleto — revisar buildClinicalNarrative / payload Typebot.');
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors.length ? 1 : 0);
}

main().catch((e) => {
  report.errors.push(e.message);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
});
