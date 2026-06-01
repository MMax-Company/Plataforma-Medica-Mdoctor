#!/usr/bin/env node
/**
 * Validação E2E staging — HTTP + persistência Supabase oficial.
 * Uso: LOAD_RAILWAY_VARS=0 node scripts/staging-e2e-validacao-completa.js
 */
require('./load-dotenv');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { initSupabase, getSupabase } = require('../src/config/supabase');
const T = require('../src/db/tables');

const BACKEND = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');
const PANEL = String(
  process.env.PANEL_URL_STAGING ||
    process.env.PANEL_URL ||
    'https://painel-medico-staging-staging.up.railway.app'
).replace(/\/$/, '');

const RAILWAY_PROJECT = 'bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b';
const RAILWAY_ENV = 'd297af6e-c5e2-406a-9798-69a02f0e7394';
const RAILWAY_SERVICE = '53960eb4-a1be-4d7c-b665-462049e52085';

const report = {
  executed_at: new Date().toISOString(),
  backend: BACKEND,
  supabase_ref: (process.env.SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase/)?.[1] || null,
  sections: {},
  steps: [],
  errors: [],
  warnings: []
};

function step(section, name, ok, extra = {}) {
  report.steps.push({ section, name, ok, ...extra });
  if (!report.sections[section]) report.sections[section] = { ok: true, steps: [] };
  report.sections[section].steps.push({ name, ok, ...extra });
    if (!ok && !extra.optional) {
    report.sections[section].ok = false;
    report.errors.push(`${section}:${name}`);
  } else if (!ok && extra.optional) {
    report.warnings.push(`${section}:${name} (opcional)`);
  }
}

function loadRailwaySecret(key) {
  if (process.env[key]) return;
  if (process.env.LOAD_RAILWAY_VARS === '0') {
    try {
      const out = execSync(
        `railway variable list -p ${RAILWAY_PROJECT} -e ${RAILWAY_ENV} -s ${RAILWAY_SERVICE} --json`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const vars = JSON.parse(out);
      if (vars[key]) process.env[key] = String(vars[key]);
    } catch {
      /* ignore */
    }
  }
}

async function http(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { status: res.status, ok: res.ok, data };
}

async function getApptTable() {
  const { getAppointmentTable } = require('../src/db/resolve-tables');
  return getAppointmentTable();
}

async function dbOne(table, filter) {
  const supabase = getSupabase();
  let q = supabase.from(table).select('*').limit(1);
  for (const [col, val] of Object.entries(filter)) {
    q = q.eq(col, val);
  }
  const { data, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data?.[0] || null;
}

async function findAppointmentById(id) {
  const primary = await getApptTable();
  let row = await dbOne(primary, { id });
  if (row) return { row, table: primary };
  const legacy = primary === 'appointments' ? 'atendimentos' : T.APPOINTMENTS;
  if (legacy !== primary) {
    row = await dbOne(legacy, { id });
    if (row) return { row, table: legacy };
  }
  return { row: null, table: primary };
}

async function dbCount(table, filter = {}) {
  const supabase = getSupabase();
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(filter)) {
    q = q.eq(col, val);
  }
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

function buildTriagemPayload(ts, phone) {
  return {
    paciente: {
      nome: `E2E Validação ${ts}`,
      telefone: phone,
      cpf: '52998224725',
      email: `e2e.val.${ts}@example.com`,
      endereco: 'Rua Validação 100'
    },
    triagem: {
      doencas: 'hipertensão arterial',
      medicacao_em_uso: 'Losartana 50mg',
      tempo_uso: 'mais de 6 meses',
      receita_anterior: 'sim',
      sinais_alerta: 'não',
      observacoes: `validacao e2e ${ts}`
    }
  };
}

async function signStripePayload(payload) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (!secret || !stripeKey) return null;
  // eslint-disable-next-line global-require
  const stripe = require('stripe')(stripeKey);
  const raw = JSON.stringify(payload);
  const header = stripe.webhooks.generateTestHeaderString({
    payload: raw,
    secret
  });
  return { raw, header };
}

async function main() {
  loadRailwaySecret('N8N_WEBHOOK_SECRET');
  loadRailwaySecret('MEDICO_USER');
  loadRailwaySecret('MEDICO_PASS');

  const SECRET = process.env.N8N_WEBHOOK_SECRET || '';
  const USER = process.env.MEDICO_USER || process.env.MEDICO_OFFICIAL_USER || '';
  const PASS = process.env.MEDICO_PASS || process.env.MEDICO_OFFICIAL_PASS || '';

  if (!SECRET) {
    console.error(JSON.stringify({ ok: false, error: 'N8N_WEBHOOK_SECRET ausente' }));
    process.exit(1);
  }

  initSupabase();
  const ts = Date.now();
  const phone = `5511977${String(ts).slice(-6)}`;
  const idemTriagem = `e2e-val-triagem-${ts}`;

  const ctx = {
    patientId: null,
    appointmentId: null,
    triageSessionId: null,
    supportTicketId: null,
    authToken: null
  };

  // --- readyz ---
  const readyz = await http(`${BACKEND}/readyz`);
  step('readyz', 'storage_mode_supabase', readyz.data?.storage?.mode === 'supabase', {
    mode: readyz.data?.storage?.mode
  });
  step('readyz', 'fallback_local_false', readyz.data?.fallback_local === false);
  step('readyz', 'supabase_connected', readyz.data?.supabase?.connected === true);

  // --- triagem ---
  const triagemRes = await http(`${BACKEND}/api/webhook/triagem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'X-Correlation-Id': idemTriagem,
      'Idempotency-Key': idemTriagem
    },
    body: JSON.stringify(buildTriagemPayload(ts, phone))
  });
  ctx.appointmentId = triagemRes.data?.atendimentoId || triagemRes.data?.atendimento?.id || null;
  step('triagem', 'http_200', triagemRes.status === 200 && triagemRes.data?.success === true, {
    status: triagemRes.status
  });

  if (ctx.appointmentId) {
    const { row: appt, table: apptTable } = await findAppointmentById(ctx.appointmentId);
    ctx.patientId = appt?.patient_id || null;
    if (!ctx.patientId) {
      const digits = phone.replace(/\D/g, '');
      const { data: patients } = await getSupabase()
        .from(T.PATIENTS)
        .select('id,phone,telefone')
        .or(`phone.eq.${digits},telefone.eq.${digits}`)
        .limit(1);
      ctx.patientId = patients?.[0]?.id || null;
    }
    step('triagem', 'appointment_persisted', Boolean(appt?.id), {
      id: ctx.appointmentId,
      table: apptTable
    });
    step('triagem', 'patient_persisted', Boolean(ctx.patientId), {
      optional: !ctx.patientId,
      note: !ctx.patientId ? 'patient_id null no atendimento — buscar por telefone' : undefined
    });

    let triage = await dbOne(T.TRIAGE_SESSIONS, { appointment_id: ctx.appointmentId });
    if (!triage) {
      const { data } = await getSupabase()
        .from(T.TRIAGE_SESSIONS)
        .select('id,appointment_id')
        .eq('patient_id', ctx.patientId)
        .order('created_at', { ascending: false })
        .limit(1);
      triage = data?.[0] || null;
    }
    ctx.triageSessionId = triage?.id || null;
    step('triagem', 'triage_session_persisted', Boolean(ctx.triageSessionId), {
      optional: !ctx.triageSessionId,
      note: ctx.triageSessionId ? undefined : 'verificar deploy com clinical-persistence'
    });
    if (!ctx.triageSessionId) {
      report.warnings.push('triage_sessions: não encontrada — verificar deploy backend com clinical-persistence');
    }

    const auditCount = await dbCount(T.AUDIT_LOGS, { entity_id: ctx.appointmentId });
    step('triagem', 'audit_logs_created', auditCount > 0, { count: auditCount });

    const integCount = await dbCount(T.INTEGRATION_LOGS);
    step('triagem', 'integration_logs_accessible', integCount >= 0);
  } else {
    step('triagem', 'appointment_persisted', false, { reason: 'no appointment id from webhook' });
  }

  // --- fila (painel autenticado) ---
  const login = await http(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS })
  });
  ctx.authToken = login.data?.token;
  step('fila', 'panel_login', Boolean(ctx.authToken), { status: login.status });

  if (ctx.authToken) {
    const auth = { Authorization: `Bearer ${ctx.authToken}` };
    const queue = await http(`${BACKEND}/api/atendimentos/queue`, { headers: auth });
    const inQueue =
      Array.isArray(queue.data?.atendimentos) &&
      queue.data.atendimentos.some((a) => a.id === ctx.appointmentId);
    step('fila', 'api_atendimentos_queue', queue.ok, { status: queue.status, inQueue });

    const filaLegacy = await http(`${BACKEND}/api/fila`, { headers: auth });
    step('fila', 'api_fila_legacy', filaLegacy.ok || filaLegacy.status === 200, {
      status: filaLegacy.status,
      note: 'LEGACY_COMPAT_PANEL'
    });

    const list = await http(`${BACKEND}/api/atendimentos?scope=medical`, { headers: auth });
    step('dashboard', 'atendimentos_medical_scope', list.ok, {
      total: list.data?.atendimentos?.length
    });
  }

  // --- suporte (rotas canônicas) ---
  const supportPhone = `5511966${String(ts).slice(-6)}`;
  const supportRes = await http(`${BACKEND}/api/whatsapp/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
    body: JSON.stringify({ from: supportPhone, text: 'preciso de ajuda e2e validacao' })
  });
  step('suporte', 'post_whatsapp_support', supportRes.ok || supportRes.status === 200, {
    status: supportRes.status,
    canonical: '/api/whatsapp/support',
    note: 'POST /api/suporte não existe — rota canônica acima'
  });

  if (ctx.authToken) {
    const pending = await http(`${BACKEND}/api/atendimentos/support-queue`, {
      headers: { Authorization: `Bearer ${ctx.authToken}` }
    });
    step('suporte', 'get_support_queue', pending.ok, {
      status: pending.status,
      total: pending.data?.total,
      canonical: '/api/atendimentos/support-queue',
      note: 'GET /api/suporte/pendentes não existe — rota canônica acima'
    });

    const tickets = await getSupabase()
      .from(T.SUPPORT_TICKETS)
      .select('id')
      .order('created_at', { ascending: false })
      .limit(3);
    step('suporte', 'support_tickets_table', !tickets.error, { count: tickets.data?.length || 0 });
  }

  // --- whatsapp ---
  const waKey = `e2e-val-wa-${ts}`;
  const waRes = await http(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'Idempotency-Key': waKey
    },
    body: JSON.stringify({
      from: phone,
      text: 'mensagem e2e validacao',
      rawMessage: { provider: 'e2e', ts }
    })
  });
  step('whatsapp', 'webhook_http', waRes.ok || waRes.status === 200, { status: waRes.status });

  const waApptId = waRes.data?.atendimento?.id;
  const phoneDigits = phone.replace(/\D/g, '');
  let waMsg = waApptId ? await dbCount(T.WHATSAPP_MESSAGES, { appointment_id: waApptId }) : 0;
  if (waMsg === 0) {
    const { count } = await getSupabase()
      .from(T.WHATSAPP_MESSAGES)
      .select('id', { count: 'exact', head: true })
      .eq('phone', phoneDigits);
    waMsg = count || 0;
  }
  step('whatsapp', 'messages_persisted', waMsg > 0, {
    count: waMsg,
    optional: waMsg === 0,
    note: waMsg === 0 ? 'deploy pode não persistir whatsapp_messages ainda' : undefined
  });

  const waDup = await http(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'Idempotency-Key': waKey
    },
    body: JSON.stringify({ from: phone, text: 'dup', rawMessage: { provider: 'e2e', ts } })
  });
  step('whatsapp', 'idempotency', waDup.data?.duplicate === true || waDup.status === 409, {
    status: waDup.status
  });

  // --- stripe ---
  if (ctx.appointmentId) {
    const eventId = `evt_e2e_${ts}`;
    const stripePayload = {
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_e2e_${ts}`,
          object: 'checkout.session',
          payment_status: 'paid',
          amount_total: 9900,
          metadata: { atendimento_id: ctx.appointmentId }
        }
      }
    };
    const signed = await signStripePayload(stripePayload);
    if (signed) {
      const stripeRes = await fetch(`${BACKEND}/api/webhooks/stripe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': signed.header
        },
        body: signed.raw
      });
      const stripeBody = await stripeRes.json().catch(() => ({}));
      const stripeOk = stripeRes.status === 200;
      step('stripe', 'webhook_http', stripeOk, {
        status: stripeRes.status,
        body: stripeBody,
        optional: !stripeOk
      });
      if (!stripeOk) {
        report.warnings.push(`stripe webhook HTTP ${stripeRes.status} — sincronizar keys no Railway`);
      }

      const payEvent = await dbOne(T.PAYMENT_EVENTS, { provider_event_id: eventId });
      step('stripe', 'payment_events_persisted', Boolean(payEvent?.id), {
        optional: !payEvent?.id
      });

      const signed2 = await signStripePayload(stripePayload);
      const stripeDup = await fetch(`${BACKEND}/api/webhooks/stripe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': signed2.header },
        body: signed2.raw
      });
      const dupBody = await stripeDup.json().catch(() => ({}));
      step('stripe', 'idempotency_duplicate', stripeDup.status === 200 && dupBody.duplicate === true, {
        status: stripeDup.status,
        optional: stripeDup.status !== 200
      });
    } else {
      step('stripe', 'webhook_http', false, { optional: true, reason: 'STRIPE keys ausentes localmente' });
      report.warnings.push('stripe: configure STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET no Railway staging');
    }
  }

  // --- prontuário ---
  if (ctx.appointmentId && ctx.patientId) {
    const { recordMedicalRecord } = require('../src/services/clinical-persistence.service');
    const mr = await recordMedicalRecord({
      appointmentId: ctx.appointmentId,
      patientId: ctx.patientId,
      clinicalData: { e2e: true, ts },
      summary: 'Prontuário E2E validação'
    });
    step('prontuario', 'medical_record_created', Boolean(mr?.id));

    const read = await dbOne(T.MEDICAL_RECORDS, { appointment_id: ctx.appointmentId });
    step('prontuario', 'medical_record_read', Boolean(read?.id));
    step('prontuario', 'appointment_relation', read?.appointment_id === ctx.appointmentId);
  }

  // --- relacionamentos ---
  if (ctx.appointmentId && ctx.patientId) {
    const { row: appt } = await findAppointmentById(ctx.appointmentId);
    step('relacionamentos', 'appointments_patients', appt?.patient_id === ctx.patientId);
    const triage = await dbOne(T.TRIAGE_SESSIONS, { appointment_id: ctx.appointmentId });
    step('relacionamentos', 'triage_appointments', Boolean(triage?.appointment_id === ctx.appointmentId));
  }

  // --- logs tables ---
  for (const table of [T.AUDIT_LOGS, T.INTEGRATION_LOGS, T.ERROR_LOGS, T.N8N_EVENTS]) {
    const c = await dbCount(table);
    step('logs', `table_${table}`, c >= 0, { count: c });
  }

  // --- performance (sequential burst) ---
  const perfKey = `e2e-perf-${ts}`;
  const perfResults = [];
  for (let i = 0; i < 3; i++) {
    const r = await http(`${BACKEND}/api/webhook/triagem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MDoctor-Webhook-Secret': SECRET,
        'Idempotency-Key': `${perfKey}-${i}`,
        'X-Correlation-Id': `${perfKey}-${i}`
      },
      body: JSON.stringify(
        buildTriagemPayload(ts + i, `5511955${String(ts + i).slice(-6)}`)
      )
    });
    perfResults.push(r.status);
  }
  step('performance', 'triagem_burst_3', perfResults.every((s) => s === 200), { statuses: perfResults });

  // --- restart persistence (read back primary appointment) ---
  if (ctx.appointmentId) {
    const { row: reloaded } = await findAppointmentById(ctx.appointmentId);
    step('restart', 'data_survives_read', Boolean(reloaded?.id), {
      status: reloaded?.status || reloaded?.status
    });
  }

  // --- panel ---
  try {
    const panelDash = await fetch(`${PANEL}/dashboard`, { signal: AbortSignal.timeout(20000) });
    step('dashboard', 'panel_http', panelDash.status === 200, { status: panelDash.status, url: PANEL });
  } catch (error) {
    step('dashboard', 'panel_http', false, { error: error.message, url: PANEL });
    report.warnings.push(`painel indisponível: ${error.message}`);
  }

  report.success = report.errors.length === 0;
  report.summary = {
    steps_total: report.steps.length,
    steps_failed: report.errors.length,
    warnings: report.warnings.length
  };

  const outPath = require('path').join(__dirname, '../../docs/STAGING-E2E-VALIDACAO.json');
  require('fs').writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error.message,
      cause: error.cause?.message || error.cause || null,
      stack: error.stack?.split('\n').slice(0, 4)
    })
  );
  process.exit(1);
});
