require('./load-dotenv');

const PHONE = '5511985485777';
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const INGRESS_SECRET = process.env.INGRESS_SERVICE_SECRET || process.env.N8N_WEBHOOK_SECRET || '';
const N8N_SECRET = process.env.N8N_WEBHOOK_SECRET || '';

const report = { steps: [], errors: [] };

function step(name, ok, extra = {}) {
  report.steps.push({ name, ok, ...extra });
  if (!ok) report.errors.push(name);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function supabaseFetch(queryPath, { method = 'GET', body = null } = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${queryPath}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: text || res.statusText, status: res.status };
  }
  if (method === 'DELETE') return { ok: true };
  return res.json();
}

async function getWaSession() {
  const rows = await supabaseFetch(
    `whatsapp_sessions?phone=eq.${PHONE}&select=id,phone,typebot_session_id,metadata,status&order=updated_at.desc&limit=1`
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function findSurveyAttendanceId() {
  const session = await getWaSession();
  const fromSession = session?.metadata?.post_delivery_survey?.attendance_id;
  if (fromSession) return { id: fromSession, patient_id: session?.patient_id || null };

  const outcomes = await supabaseFetch(
    `patient_outcomes?patient_id=not.is.null&select=attendance_id,patient_id&order=created_at.desc&limit=10`
  );
  if (Array.isArray(outcomes)) {
    for (const row of outcomes) {
      const phoneRows = await supabaseFetch(
        `atendimentos?id=eq.${row.attendance_id}&select=id,patient_id,paciente_telefone,status&limit=1`
      );
      const match = Array.isArray(phoneRows) ? phoneRows[0] : null;
      if (match && String(match.paciente_telefone || '').replace(/\D/g, '').endsWith('985485777')) {
        return match;
      }
    }
    if (outcomes[0]?.attendance_id) {
      return { id: outcomes[0].attendance_id, patient_id: outcomes[0].patient_id || null };
    }
  }

  const rows = await supabaseFetch(
    `atendimentos?paciente_telefone=eq.${PHONE}&select=id,patient_id,paciente_telefone,status&order=criado_em.desc&limit=5`
  );
  if (Array.isArray(rows) && rows.length) return rows[0];

  const loose = await supabaseFetch(
    `atendimentos?paciente_telefone=ilike.*98548*&select=id,patient_id,paciente_telefone,status&order=criado_em.desc&limit=5`
  );
  return Array.isArray(loose) && loose.length ? loose[0] : null;
}

async function resetSurveyState(attendanceId) {
  await supabaseFetch(`patient_outcomes?attendance_id=eq.${attendanceId}&survey_version=eq.fase1_v1`, {
    method: 'DELETE'
  }).catch(() => {});

  const session = await getWaSession();
  if (!session?.id) return null;
  const metadata = { ...(session.metadata || {}) };
  delete metadata.post_delivery_survey;
  await supabaseFetch(`whatsapp_sessions?id=eq.${session.id}`, {
    method: 'PATCH',
    body: { typebot_session_id: 'stale-typebot-session-for-test', metadata: { ...metadata, typebot_expected_input_id: 'blk_upload_check' } }
  });
  return getWaSession();
}

async function triggerSurvey(attendanceId, patientId) {
  const res = await fetch(`${BACKEND}/api/patient-outcomes/survey/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(INGRESS_SECRET ? { 'X-MDoctor-Service-Secret': INGRESS_SECRET } : {})
    },
    body: JSON.stringify({
      attendance_id: attendanceId,
      patient_id: patientId || null,
      phone: PHONE
    })
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function sendWa(text, suffix = '') {
  const id = `wamid.survey.${Date.now()}${suffix}`;
  const res = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-survey-test',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ profile: { name: 'Teste Survey 98548' }, wa_id: PHONE }],
            messages: [{ id, type: 'text', from: PHONE, text: { body: text } }]
          }
        }]
      }]
    })
  });
  return { status: res.status, messageId: id };
}

async function surveyInbound(text) {
  const res = await fetch(`${BACKEND}/api/patient-outcomes/survey/inbound`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(N8N_SECRET ? { 'X-N8N-Webhook-Secret': N8N_SECRET } : {})
    },
    body: JSON.stringify({ from: PHONE, text })
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getOutcome(attendanceId) {
  const rows = await supabaseFetch(
    `patient_outcomes?attendance_id=eq.${attendanceId}&survey_version=eq.fase1_v1&select=*`
  );
  return Array.isArray(rows) ? rows[0] : null;
}

async function runFullSurveyFlow(attendanceId) {
  await resetSurveyState(attendanceId);
  const trigger = await triggerSurvey(attendanceId);
  step('full_trigger', trigger.status === 200 && trigger.data?.triggered !== false, trigger);

  await sleep(1500);
  const afterTrigger = await getWaSession();
  step('full_typebot_cleared_on_trigger', !afterTrigger?.typebot_session_id, {
    typebotSessionId: afterTrigger?.typebot_session_id || null,
    surveyStep: afterTrigger?.metadata?.post_delivery_survey?.step || null
  });
  step('full_survey_session_opt_in', afterTrigger?.metadata?.post_delivery_survey?.step === 'opt_in');

  const optIn = await sendWa('1', 'full1');
  step('full_opt_in_webhook', optIn.status === 200);
  await sleep(3500);

  const afterOptIn = await getWaSession();
  step('full_no_typebot_after_opt_in', !afterOptIn?.typebot_session_id, {
    typebotSessionId: afterOptIn?.typebot_session_id || null,
    surveyStep: afterOptIn?.metadata?.post_delivery_survey?.step || null
  });
  step('full_step_q1', afterOptIn?.metadata?.post_delivery_survey?.step === 'q1');

  for (const [answer, expectedStep] of [['2', 'q2'], ['1', 'q3'], ['1', null]]) {
    const inbound = await sendWa(answer, `full-${answer}-${expectedStep || 'done'}`);
    step(`full_answer_${answer}_handled`, inbound.status === 200, { status: inbound.status });
    await sleep(3500);
    const session = await getWaSession();
    if (expectedStep) {
      step(`full_step_${expectedStep}`, session?.metadata?.post_delivery_survey?.step === expectedStep);
    } else {
      step('full_survey_cleared', !session?.metadata?.post_delivery_survey);
    }
  }

  const outcome = await getOutcome(attendanceId);
  step('full_persistence_q1', outcome?.q1_access_alternative === 'ubs', { q1: outcome?.q1_access_alternative });
  step('full_persistence_q2', outcome?.q2_avoided_interruption === 'sim', { q2: outcome?.q2_avoided_interruption });
  step('full_persistence_q3', outcome?.q3_would_use_again === 'sim', { q3: outcome?.q3_would_use_again });
  step('full_no_typebot_at_end', !(await getWaSession())?.typebot_session_id);
}

async function runSkipFlow(attendanceId) {
  await resetSurveyState(attendanceId);
  await triggerSurvey(attendanceId);
  await sleep(1000);

  const skip = await sendWa('ENCERRAR', 'skip');
  step('skip_webhook', skip.status === 200);
  await sleep(2500);

  const session = await getWaSession();
  step('skip_clears_survey', !session?.metadata?.post_delivery_survey);
  step('skip_no_typebot', !session?.typebot_session_id, { typebotSessionId: session?.typebot_session_id || null });
}

async function runDeclineFlow(attendanceId) {
  await resetSurveyState(attendanceId);
  await triggerSurvey(attendanceId);
  await sleep(1000);

  const decline = await sendWa('2', 'decline');
  step('decline_handled', decline.status === 200, { status: decline.status });
  await sleep(3500);

  const session = await getWaSession();
  step('decline_clears_survey', !session?.metadata?.post_delivery_survey);
  step('decline_no_typebot', !session?.typebot_session_id);
}

async function main() {
  const atendimento = await findSurveyAttendanceId();
  if (!atendimento?.id) {
    console.log(JSON.stringify({ fatal: 'Nenhum attendance_id de pesquisa encontrado para o telefone de teste', phone: PHONE }, null, 2));
    process.exit(1);
  }

  await runFullSurveyFlow(atendimento.id);
  await runSkipFlow(atendimento.id);
  await runDeclineFlow(atendimento.id);

  console.log(JSON.stringify({
    phone: PHONE,
    backend: BACKEND,
    attendance_id: atendimento.id,
    full_survey: report.steps.filter((s) => s.name.startsWith('full_')).every((s) => s.ok) ? 'OK' : 'erro',
    skip_flow: report.steps.filter((s) => s.name.startsWith('skip_')).every((s) => s.ok) ? 'OK' : 'erro',
    decline_flow: report.steps.filter((s) => s.name.startsWith('decline_')).every((s) => s.ok) ? 'OK' : 'erro',
    errors: report.errors,
    steps: report.steps
  }, null, 2));

  if (report.errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message, stack: error.stack }));
  process.exit(1);
});
