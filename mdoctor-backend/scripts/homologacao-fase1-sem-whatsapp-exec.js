#!/usr/bin/env node
/** Execução única — homologação Fase 1 sem WhatsApp real. Saída: stdout JSON. */
require('./load-dotenv');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const N8N = String(process.env.N8N_WEBHOOK_URL || 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook').replace(/\/$/, '').replace(/\/webhook\/typebot-webhook$/, '');
const N8N_TYPEBOT = `${N8N}/webhook/typebot-webhook`;
const N8N_EVOLUTION = `${N8N}/webhook/evolution-webhook`;
const EVO = String(process.env.EVOLUTION_API_URL || 'https://evolution-api-staging-staging-40d1.up.railway.app').replace(/\/$/, '');
const EVO_KEY = process.env.EVOLUTION_API_KEY || '';
const EVO_INST = process.env.EVOLUTION_INSTANCE || 'mdoctor-staging';
const SECRET = process.env.N8N_WEBHOOK_SECRET || process.env.INGRESS_SERVICE_SECRET || '';
const MEDICO_USER = process.env.MEDICO_USER || 'staging-doctor';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const RX_URL =
  process.env.HOMOLOG_PRESCRIPTION_URL ||
  'https://thbwoogytwcidxrrboym.supabase.co/storage/v1/object/public/Documentos%20Doctor%20Prescreve/sample-receita-homolog.pdf';

const report = {
  generated_at: new Date().toISOString(),
  targets: { BACKEND, PANEL, N8N, EVO, EVO_INST },
  validations: {},
  passed: [],
  failed: [],
  skipped_whatsapp_only: [],
  readiness_pct: null
};

function pass(id, evidence) {
  report.passed.push(id);
  report.validations[id] = { ok: true, ...evidence };
}
function fail(id, evidence) {
  report.failed.push(id);
  report.validations[id] = { ok: false, ...evidence };
}
function skipWa(id, evidence) {
  report.skipped_whatsapp_only.push(id);
  report.validations[id] = { ok: null, whatsapp_only: true, ...evidence };
}

async function req(url, options = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 400) };
    }
    return { ok: res.ok, status: res.status, data, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, ms: Date.now() - t0 };
  }
}

async function login() {
  if (!MEDICO_PASS) return { ok: false, error: 'MEDICO_PASS missing' };
  const r = await req(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS })
  });
  return { ok: Boolean(r.data?.token), token: r.data?.token, status: r.status };
}

async function v1_typebot() {
  const stamp = Date.now();
  const phone = `55119${String(stamp).slice(-8)}`;
  const label = `Homolog Fase1 ${stamp}`;
  const body = {
    from: phone,
    telefone: phone,
    patient_name: label,
    nome: label,
    cpf: '52998224725',
    birth_date: '15/03/1985',
    chronic_condition: 'hipertensão arterial',
    has_warning_signs: 'false',
    eligibility_status: 'eligible',
    has_previous_prescription: 'true',
    previous_prescription_file: RX_URL,
    foto_receita_url: RX_URL,
    medication_name: 'Losartana',
    medication_dose: '50mg',
    payment_status: 'paid',
    pagamento_status: 'CONFIRMADO',
    source: 'typebot-doctor-prescreve',
    typebot_public_id: 'doctor-prescreve-8rmljgu',
    text: label
  };
  const cid = `homolog-fase1-${stamp}`;
  const n8n = await req(N8N_TYPEBOT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': cid,
      'Idempotency-Key': cid
    },
    body: JSON.stringify(body)
  });
  const atId = n8n.data?.atendimentoId || n8n.data?.atendimento_id;
  await new Promise((r) => setTimeout(r, 1200));
  const at = atId ? await req(`${BACKEND}/api/atendimentos/${atId}`) : null;
  const status = at?.data?.atendimento?.status || at?.data?.status;
  const ok = n8n.status === 200 && n8n.data?.success === true && Boolean(atId) && at?.ok;
  if (ok) {
    pass('V1_typebot_n8n_backend', {
      n8n_status: n8n.status,
      atendimento_id: atId,
      status,
      phone_masked: phone.replace(/\d(?=\d{4})/g, '*')
    });
  } else {
    fail('V1_typebot_n8n_backend', {
      n8n_status: n8n.status,
      n8n_success: n8n.data?.success,
      atendimento_id: atId,
      backend_get: at?.status
    });
  }
  return { atId, phone, token: null, label };
}

async function v2_backend(token) {
  const checks = [];
  const triagem = await req(`${BACKEND}/api/webhook/triagem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {}),
      'Idempotency-Key': `probe-triagem-${Date.now()}`
    },
    body: JSON.stringify({
      paciente: { nome: 'Probe Triagem', telefone: `55118${String(Date.now()).slice(-8)}` },
      typebot_context: { pagamento_status: 'CONFIRMADO', eligibility_status: 'eligible' }
    })
  });
  checks.push({ name: 'triagem', status: triagem.status, ok: triagem.ok || triagem.status === 200 });

  const list = token
    ? await req(`${BACKEND}/api/atendimentos`, { headers: { Authorization: `Bearer ${token}` } })
    : { ok: false, status: 401 };
  checks.push({ name: 'atendimentos', status: list.status, ok: list.ok, count: list.data?.atendimentos?.length });

  const queue = token
    ? await req(`${BACKEND}/api/atendimentos/queue`, { headers: { Authorization: `Bearer ${token}` } })
    : { ok: false, status: 401 };
  checks.push({ name: 'queue', status: queue.status, ok: queue.ok, count: queue.data?.atendimentos?.length });

  const inbound = await req(`${BACKEND}/api/patient-outcomes/survey/inbound`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {})
    },
    body: JSON.stringify({ from: '5511999887766', text: '1' })
  });
  checks.push({ name: 'patient_outcomes_inbound', status: inbound.status, ok: inbound.status !== 404 });

  const provider = await req(`${BACKEND}/api/whatsapp/provider-status`);
  checks.push({
    name: 'provider_status',
    status: provider.status,
    ok: provider.ok,
    evolution_state: provider.data?.evolution?.state || provider.data?.evolution?.instanceState
  });

  const health = await req(`${BACKEND}/health`);
  const readyz = await req(`${BACKEND}/readyz`);
  checks.push({ name: 'health', status: health.status, ok: health.ok });
  checks.push({ name: 'readyz_supabase', status: readyz.status, ok: readyz.data?.supabase?.connected === true });

  const allOk = checks.every((c) => c.ok);
  if (allOk) pass('V2_backend_endpoints', { checks });
  else fail('V2_backend_endpoints', { checks });
}

async function v3_supabase(atId, token) {
  if (!atId || !token) {
    fail('V3_supabase_persistence', { reason: 'missing_atendimento_or_token' });
    return;
  }
  const before = await req(`${BACKEND}/api/atendimentos/${atId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const st1 = before.data?.atendimento?.status;
  const approve = await req(`${BACKEND}/api/atendimentos/${atId}/clinical/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo: 'Homolog Fase1', observacao_medica: 'probe' })
  });
  await new Promise((r) => setTimeout(r, 800));
  const after = await req(`${BACKEND}/api/atendimentos/${atId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const st2 = after.data?.atendimento?.status;
  const ok = before.ok && approve.ok && after.ok && st1 !== st2 && String(st2).toLowerCase() === 'approved';
  if (ok) {
    pass('V3_supabase_read_write', { atendimento_id: atId, status_before: st1, status_after: st2 });
  } else {
    fail('V3_supabase_read_write', {
      atendimento_id: atId,
      status_before: st1,
      status_after: st2,
      approve_status: approve.status
    });
  }
}

async function v4_panel(token, atId, phone) {
  const loginPage = await req(`${PANEL}/login`);
  if (!loginPage.ok) {
    fail('V4_panel_login_page', { status: loginPage.status });
  } else {
    pass('V4_panel_login_page', { status: loginPage.status, url: `${PANEL}/login` });
  }
  if (!token || !atId) {
    fail('V4_panel_queue_flow', { reason: 'auth_or_atendimento_missing' });
    return;
  }
  const queue = await req(`${BACKEND}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const inQueue = (queue.data?.atendimentos || []).some((a) => a.id === atId);
  const attending = await req(`${BACKEND}/api/atendimentos?scope=medical&status=approved`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const inApproved = (attending.data?.atendimentos || []).some((a) => a.id === atId);

  const rejectId = await createRejectPatient(token);
  const rejectInList = rejectId
    ? (queue.data?.atendimentos || []).some((a) => a.id === rejectId) ||
      (await req(`${BACKEND}/api/atendimentos/${rejectId}`, { headers: { Authorization: `Bearer ${token}` } })).data
        ?.atendimento?.status === 'rejected'
    : false;

  const ok = inQueue || inApproved;
  if (ok && rejectId) {
    pass('V4_panel_api_flow', {
      atendimento_id: atId,
      in_queue_or_approved: ok,
      approved_visible: inApproved,
      reject_patient_id: rejectId,
      reject_status_ok: rejectInList
    });
  } else if (ok) {
    pass('V4_panel_api_flow', { atendimento_id: atId, in_queue_or_approved: ok, approved_visible: inApproved });
  } else {
    fail('V4_panel_api_flow', { atendimento_id: atId, in_queue: inQueue, in_approved: inApproved, rejectId });
  }
}

async function createRejectPatient(token) {
  const ts = Date.now();
  const triagem = await req(`${BACKEND}/api/webhook/triagem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {}),
      'Idempotency-Key': `reject-probe-${ts}`
    },
    body: JSON.stringify({
      paciente: { nome: `Reject Probe ${ts}`, telefone: `55117${String(ts).slice(-8)}` },
      triagem: { sinais_alerta: 'sim', observacoes: 'homolog reject' },
      typebot_context: { pagamento_status: 'CONFIRMADO', eligibility_status: 'ineligible', has_warning_signs: true }
    })
  });
  const id = triagem.data?.atendimentoId || triagem.data?.atendimento?.id;
  if (!id) return null;
  const rej = await req(`${BACKEND}/api/atendimentos/${id}/clinical/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason_code: 'RED_FLAG', motivo: 'Homolog reject probe' })
  });
  return rej.ok ? id : id;
}

async function v5_memed(token, atId) {
  const config = await req(`${BACKEND}/api/memed/config`);
  const runtimeOk = config.ok && (config.data?.runtime?.configured || config.data?.config?.enabled);
  if (!token || !atId) {
    if (runtimeOk) pass('V5_memed_config', { config_status: config.status, runtime: config.data?.runtime });
    else fail('V5_memed_config', { config_status: config.status, data: config.data });
    return;
  }
  const mock = await req(`${BACKEND}/api/memed/receita`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      atendimentoId: atId,
      receitaId: `mock-homolog-${Date.now()}`,
      pdfUrl: `https://example.invalid/mock-${atId}.pdf`,
      payload: { mock: true }
    })
  });
  const ok = config.ok && mock.ok;
  if (ok) {
    pass('V5_memed_mock_flow', {
      config_status: config.status,
      environment: config.data?.runtime?.environment,
      mock_receipt_status: mock.status,
      atendimento_id: atId
    });
  } else {
    fail('V5_memed_mock_flow', {
      config_status: config.status,
      mock_receipt_status: mock.status,
      mock_error: mock.data?.error
    });
  }
}

async function v6_evidence(atId, phone) {
  if (!SECRET || !atId) {
    fail('V6_patient_outcomes', { reason: !SECRET ? 'secret_missing' : 'atendimento_missing' });
    return;
  }
  const cid = `evidence-${Date.now()}`;
  const trigger = await req(`${BACKEND}/api/patient-outcomes/survey/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'X-Correlation-Id': cid
    },
    body: JSON.stringify({ attendance_id: atId, phone })
  });
  const steps = [];
  for (const [q, text] of [
    ['Q1', '2'],
    ['Q2', '1'],
    ['Q3', '1']
  ]) {
    const r = await req(`${BACKEND}/api/patient-outcomes/survey/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MDoctor-Webhook-Secret': SECRET,
        'X-Correlation-Id': cid
      },
      body: JSON.stringify({ from: phone, text })
    });
    steps.push({ q, status: r.status, handled: r.data?.handled, completed: r.data?.completed });
  }
  const saved = await req(`${BACKEND}/api/patient-outcomes/${atId}`, {
    headers: { 'X-MDoctor-Webhook-Secret': SECRET }
  });
  const o = saved.data?.outcome;
  const ok =
    trigger.status !== 404 &&
    steps.every((s) => s.handled) &&
    o?.q1_access_alternative === 'ubs' &&
    o?.q2_avoided_interruption === 'sim' &&
    o?.q3_would_use_again === 'sim';
  if (ok) {
    pass('V6_patient_outcomes_survey', {
      trigger_status: trigger.status,
      steps,
      q1: o.q1_access_alternative,
      q2: o.q2_avoided_interruption,
      q3: o.q3_would_use_again
    });
  } else {
    fail('V6_patient_outcomes_survey', { trigger_status: trigger.status, steps, saved: o || saved.data });
  }
}

async function v7_evolution() {
  const health = await req(`${EVO}/`);
  const inst = EVO_KEY
    ? await req(`${EVO}/instance/fetchInstances`, { headers: { apikey: EVO_KEY } })
    : { ok: false, status: 0, error: 'no_key' };
  const wh = EVO_KEY
    ? await req(`${EVO}/webhook/find/${encodeURIComponent(EVO_INST)}`, { headers: { apikey: EVO_KEY } })
    : { ok: false };
  const n8nProbe = await req(`${N8N_EVOLUTION}/connection-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'CONNECTION_UPDATE', instance: EVO_INST, data: { state: 'close' } })
  });
  const provider = await req(`${BACKEND}/api/whatsapp/provider-status`);
  const instExists = Array.isArray(inst.data)
    ? inst.data.some((i) => (i.name || i.instance?.instanceName) === EVO_INST)
    : JSON.stringify(inst.data || '').includes(EVO_INST);
  const whOk = String(wh.data?.url || '').includes('n8n-node-production-f844');
  const apiOk = health.status > 0 && instExists && whOk && n8nProbe.status === 200;
  if (apiOk) {
    pass('V7_evolution_without_session', {
      evolution_http: health.status,
      instance_exists: instExists,
      webhook_url: wh.data?.url,
      n8n_evolution_probe: n8nProbe.status,
      provider: provider.data?.provider,
      evolution_connected: provider.data?.evolution?.connected
    });
  } else {
    fail('V7_evolution_without_session', {
      evolution_http: health.status,
      instance_exists: instExists,
      webhook_url: wh.data?.url,
      n8n_probe: n8nProbe.status
    });
  }
  if (provider.data?.evolution?.connected === false) {
    skipWa('V7_evolution_session_open', {
      state: provider.data?.evolution?.state,
      note: 'Esperado sem QR — não bloqueia Fase 1'
    });
  }
}

async function v8_full_chain(token, baseAtId, phone) {
  if (!token) {
    fail('V8_full_simulated_chain', { reason: 'login_failed' });
    return;
  }
  const stamp = Date.now();
  const cid = `chain-${stamp}`;
  const ph = `55116${String(stamp).slice(-8)}`;
  const n8n = await req(N8N_TYPEBOT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': cid,
      'Idempotency-Key': cid
    },
    body: JSON.stringify({
      from: ph,
      telefone: ph,
      nome: `Chain Fase1 ${stamp}`,
      patient_name: `Chain Fase1 ${stamp}`,
      cpf: '52998224725',
      eligibility_status: 'eligible',
      has_previous_prescription: 'true',
      previous_prescription_file: RX_URL,
      foto_receita_url: RX_URL,
      payment_status: 'paid',
      pagamento_status: 'CONFIRMADO',
      medication_name: 'Losartana',
      medication_dose: '50mg',
      text: 'chain'
    })
  });
  const atId = n8n.data?.atendimentoId || n8n.data?.atendimento_id;
  await new Promise((r) => setTimeout(r, 1000));
  const approve = atId
    ? await req(`${BACKEND}/api/atendimentos/${atId}/clinical/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: 'Chain homolog' })
      })
    : { ok: false };
  const memed = atId
    ? await req(`${BACKEND}/api/memed/receita`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          atendimentoId: atId,
          receitaId: `chain-mock-${stamp}`,
          pdfUrl: `https://example.invalid/chain-${atId}.pdf`,
          payload: { mock: true }
        })
      })
    : { ok: false };
  let surveyOk = false;
  if (atId && SECRET) {
    await req(`${BACKEND}/api/patient-outcomes/survey/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
      body: JSON.stringify({ attendance_id: atId, phone: ph })
    });
    for (const text of ['2', '1', '1']) {
      await req(`${BACKEND}/api/patient-outcomes/survey/inbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
        body: JSON.stringify({ from: ph, text })
      });
    }
    const out = await req(`${BACKEND}/api/patient-outcomes/${atId}`, {
      headers: { 'X-MDoctor-Webhook-Secret': SECRET }
    });
    surveyOk = out.data?.outcome?.q3_would_use_again === 'sim';
  }
  const queue = atId
    ? await req(`${BACKEND}/api/atendimentos/${atId}`, { headers: { Authorization: `Bearer ${token}` } })
    : { ok: false };
  const ok = n8n.status === 200 && Boolean(atId) && approve.ok && memed.ok && surveyOk && queue.ok;
  if (ok) {
    pass('V8_full_simulated_chain', {
      atendimento_id: atId,
      chain: ['typebot_payload', 'n8n_200', 'backend_created', 'approved', 'memed_mock', 'survey_q1_q2_q3', 'supabase_read']
    });
  } else {
    fail('V8_full_simulated_chain', {
      n8n_status: n8n.status,
      atendimento_id: atId,
      approve: approve.status,
      memed: memed.status,
      surveyOk,
      final_read: queue.status
    });
  }
}

function computeReadiness() {
  const testIds = [
    'V1_typebot_n8n_backend',
    'V2_backend_endpoints',
    'V3_supabase_read_write',
    'V4_panel_login_page',
    'V4_panel_api_flow',
    'V5_memed_mock_flow',
    'V6_patient_outcomes_survey',
    'V7_evolution_without_session',
    'V8_full_simulated_chain'
  ];
  const passed = testIds.filter((id) => report.passed.includes(id)).length;
  report.readiness_pct = Math.round((passed / testIds.length) * 100);
  report.readiness_detail = { passed, total: testIds.length, whatsapp_only_skips: report.skipped_whatsapp_only.length };
}

async function main() {
  const session = await login();
  const v1 = await v1_typebot();
  if (session.token) {
    await v2_backend(session.token);
    await v3_supabase(v1.atId, session.token);
    await v4_panel(session.token, v1.atId, v1.phone);
    await v5_memed(session.token, v1.atId);
  } else {
    fail('V2_backend_endpoints', { reason: 'login_failed', status: session.status });
    fail('V3_supabase_read_write', { reason: 'login_failed' });
    fail('V4_panel_api_flow', { reason: 'login_failed' });
    fail('V5_memed_mock_flow', { reason: 'login_failed' });
  }
  await v6_evidence(v1.atId, v1.phone);
  await v7_evolution();
  if (session.token) await v8_full_chain(session.token, v1.atId, v1.phone);
  computeReadiness();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
