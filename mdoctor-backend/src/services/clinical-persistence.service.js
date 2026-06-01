const { randomUUID } = require('crypto');
const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');

async function recordIntegrationLog({
  integration,
  direction = 'inbound',
  status = 'ok',
  correlationId = null,
  requestPayload = {},
  responsePayload = {},
  errorMessage = null
}) {
  return dbQuery('integration_log', async (supabase) =>
    supabase
      .from(T.INTEGRATION_LOGS)
      .insert({
        integration,
        direction,
        status,
        correlation_id: correlationId,
        request_payload: requestPayload,
        response_payload: responsePayload,
        error_message: errorMessage
      })
      .select('*')
      .single()
  );
}

async function recordTriageSession({
  patientId,
  appointmentId,
  correlationId,
  idempotencyKey,
  source = 'typebot',
  payload = {}
}) {
  const session = await dbQuery('triage_session', async (supabase) =>
    supabase
      .from(T.TRIAGE_SESSIONS)
      .insert({
        patient_id: patientId || null,
        appointment_id: appointmentId || null,
        source,
        status: 'completed',
        correlation_id: correlationId,
        idempotency_key: idempotencyKey || null,
        payload
      })
      .select('*')
      .single()
  );

  const answers = [];
  const triagem = payload.triagem || payload.triagem_nested?.triagem || {};
  for (const [questionKey, answerValue] of Object.entries(triagem)) {
    if (typeof answerValue === 'object' && answerValue !== null) continue;
    const row = await dbQuery('triage_answer', async (supabase) =>
      supabase
        .from(T.TRIAGE_ANSWERS)
        .insert({
          triage_session_id: session.id,
          question_key: questionKey,
          answer_value: String(answerValue ?? ''),
          answer_json: typeof answerValue === 'object' ? answerValue : null
        })
        .select('*')
        .single()
    );
    answers.push(row);
  }

  return { session, answers };
}

async function recordMedicalEligibility({ appointmentId, decision, protocolVersion }) {
  if (!appointmentId || !decision) return null;
  return dbQuery('medical_eligibility', async (supabase) =>
    supabase
      .from(T.MEDICAL_ELIGIBILITY)
      .insert({
        appointment_id: appointmentId,
        eligible: Boolean(decision.eligible),
        reason: decision.reason || null,
        reason_code: decision.reasonCode || null,
        criteria_used: decision.criteriaUsed || [],
        protocol_version: protocolVersion || decision.protocolVersion || null,
        risk_level: decision.riskLevel || null,
        payload: decision
      })
      .select('*')
      .single()
  );
}

async function recordTypebotSession({
  patientId,
  appointmentId,
  publicId,
  sessionId,
  variables = {}
}) {
  return dbQuery('typebot_session', async (supabase) =>
    supabase
      .from(T.TYPEBOT_SESSIONS)
      .insert({
        patient_id: patientId || null,
        appointment_id: appointmentId || null,
        public_id: publicId || null,
        session_id: sessionId || null,
        status: 'completed',
        variables
      })
      .select('*')
      .single()
  );
}

async function recordMedicalRecord({ appointmentId, patientId, clinicalData = {}, summary = '' }) {
  return dbQuery('medical_record', async (supabase) =>
    supabase
      .from(T.MEDICAL_RECORDS)
      .insert({
        appointment_id: appointmentId,
        patient_id: patientId || null,
        summary: summary || clinicalData.clinical_summary || '',
        clinical_data: clinicalData
      })
      .select('*')
      .single()
  );
}

async function recordSupportTicket({ patientId, appointmentId, phone, subject, metadata = {} }) {
  return dbQuery('support_ticket', async (supabase) =>
    supabase
      .from(T.SUPPORT_TICKETS)
      .insert({
        patient_id: patientId || null,
        appointment_id: appointmentId || null,
        channel: 'whatsapp',
        status: 'open',
        subject: subject || `Suporte WhatsApp ${String(phone).slice(-4)}`,
        metadata: { ...metadata, phone }
      })
      .select('*')
      .single()
  );
}

async function recordWhatsappMessage({
  appointmentId = null,
  phone,
  body,
  direction,
  status = 'received',
  metadata = {}
}) {
  return dbQuery('whatsapp_message', async (supabase) =>
    supabase
      .from(T.WHATSAPP_MESSAGES)
      .insert({
        appointment_id: appointmentId,
        phone: String(phone || '').replace(/\D/g, ''),
        body: body || '',
        direction,
        status,
        metadata
      })
      .select('*')
      .single()
  );
}

async function persistTriagemFlow({
  patient,
  atendimento,
  validation,
  decision,
  correlationId,
  idempotencyKey,
  typebotContext = {}
}) {
  const patientId = patient?.id || atendimento?.patient_id || null;
  const appointmentId = atendimento?.id;

  const triage = await recordTriageSession({
    patientId,
    appointmentId,
    correlationId,
    idempotencyKey,
    source: 'typebot-triagem',
    payload: {
      paciente: validation?.paciente,
      triagem: validation?.triagem,
      typebot_context: typebotContext
    }
  });

  const eligibility = await recordMedicalEligibility({
    appointmentId,
    decision,
    protocolVersion: decision?.protocolVersion
  });

  const typebotSession = await recordTypebotSession({
    patientId,
    appointmentId,
    publicId: typebotContext.typebot_public_id || typebotContext.publicId,
    sessionId: typebotContext.session_id || typebotContext.sessionId,
    variables: typebotContext
  });

  const clinical = atendimento?.dados_clinicos || {};
  const triagem = validation?.triagem || {};
  const prontuario = {
    identificacao: {
      nome: validation?.paciente?.nome || clinical.paciente_nome,
      telefone: validation?.paciente?.telefone,
      cpf: validation?.paciente?.cpf,
      email: validation?.paciente?.email
    },
    hda: clinical.queixa_principal || triagem.observacoes || clinical.clinical_summary,
    medicacoes: triagem.medicacao_em_uso || clinical.medicacao_em_uso,
    alergias: clinical.alergias || null,
    receita_anterior: triagem.receita_anterior || clinical.previous_prescription,
    elegibilidade: decision,
    hipotese_diagnostica: clinical.conduta_sugerida || null,
    conduta: clinical.conduta_sugerida,
    orientacoes: clinical.orientacoes_clinicas,
    exame_fisico_telemedicina: clinical.exame_fisico_telemedicina,
    historico_clinico: clinical.historico_clinico
  };

  const medicalRecord = await recordMedicalRecord({
    appointmentId,
    patientId,
    clinicalData: { ...clinical, prontuario },
    summary: clinical.clinical_summary || prontuario.hda || ''
  });

  await recordIntegrationLog({
    integration: 'typebot',
    correlationId,
    requestPayload: { idempotencyKey, appointmentId },
    responsePayload: {
      triage_session_id: triage?.session?.id,
      eligibility_id: eligibility?.id,
      typebot_session_id: typebotSession?.id,
      medical_record_id: medicalRecord?.id
    }
  });

  return { triage, eligibility, typebotSession, medicalRecord };
}

module.exports = {
  persistTriagemFlow,
  recordIntegrationLog,
  recordMedicalEligibility,
  recordMedicalRecord,
  recordSupportTicket,
  recordTriageSession,
  recordTypebotSession,
  recordWhatsappMessage
};
