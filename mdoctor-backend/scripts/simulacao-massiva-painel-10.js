#!/usr/bin/env node
/**
 * Simulação massiva staging — 10 pacientes (6 elegíveis, 3 inelegíveis, 1 não pago).
 * Fluxo: Typebot → n8n → backend → Supabase → fila → painel → approve/reject → Memed mock → entrega.
 *
 *   MEDICO_PASS=... N8N_WEBHOOK_SECRET=... node scripts/simulacao-massiva-painel-10.js
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const lib = require('./homologacao-clinica-fase2-lib');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const N8N_TYPEBOT = String(
  process.env.N8N_WEBHOOK_URL || 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook'
).replace(/\/$/, '');
const SECRET = process.env.N8N_WEBHOOK_SECRET || process.env.INGRESS_SERVICE_SECRET || '';
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const REPORT_JSON = path.join(__dirname, '../../docs/SIMULACAO-MASSIVA-PAINEL-10-RELATORIO.json');
const REPORT_MD = path.join(__dirname, '../../docs/SIMULACAO-MASSIVA-PAINEL-10-RELATORIO.md');
const RX_PHOTO = 'https://example.com/receita-simulacao-massiva.jpg';

const TS = Date.now();
const RUN_ID = `mass-${TS}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const CPFS = [
  '52998224725',
  '39053344705',
  '15350946056',
  '11144477735',
  '93642479859',
  '74816998030',
  '60783309080',
  '45317828791',
  '23100299900',
  '28625587860',
];

/** @type {import('./simulacao-massiva-painel-10.types').PatientDef[]} */
const PATIENTS = [
  {
    num: 1,
    group: 'elegivel',
    key: 'e1_has_30',
    nome: `Mass E1 HAS 30d ${RUN_ID}`,
    cpf: CPFS[0],
    conditionCode: 'hipertensao',
    condicao: 'Hipertensão arterial (HAS)',
    receita_vencida_dias: 30,
    hora_offset_min: 0,
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
    expected: { elegivel: true, inQueue: true, fluxo: true },
  },
  {
    num: 2,
    group: 'elegivel',
    key: 'e2_dm_45',
    nome: `Mass E2 DM2 45d ${RUN_ID}`,
    cpf: CPFS[1],
    conditionCode: 'diabetes_tipo_2',
    condicao: 'Diabetes mellitus tipo 2',
    receita_vencida_dias: 45,
    hora_offset_min: 3,
    meds: [
      { name: 'Metformina', dose: '850', unit: 'mg', frequency: '12/12h' },
      { name: 'Glibenclamida', dose: '5', unit: 'mg', frequency: '24h' },
    ],
    expected: { elegivel: true, inQueue: true, fluxo: true },
  },
  {
    num: 3,
    group: 'elegivel',
    key: 'e3_has_dm_60',
    nome: `Mass E3 HAS+DM 60d ${RUN_ID}`,
    cpf: CPFS[2],
    conditionCode: 'hipertensao',
    condicao: 'HAS + Diabetes tipo 2',
    secondary: ['diabetes_tipo_2'],
    receita_vencida_dias: 60,
    hora_offset_min: 6,
    meds: [
      { name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' },
      { name: 'Metformina', dose: '850', unit: 'mg', frequency: '12/12h' },
      { name: 'Hidroclorotiazida', dose: '25', unit: 'mg', frequency: '24h' },
    ],
    expected: { elegivel: true, inQueue: true, fluxo: true },
  },
  {
    num: 4,
    group: 'elegivel',
    key: 'e4_hipo_75',
    nome: `Mass E4 Hipotireoidismo ${RUN_ID}`,
    cpf: CPFS[3],
    conditionCode: 'hipotireoidismo',
    condicao: 'Hipotireoidismo',
    receita_vencida_dias: 75,
    hora_offset_min: 9,
    meds: [{ name: 'Levotiroxina', dose: '50', unit: 'mcg', frequency: '24h jejum' }],
    expected: { elegivel: true, inQueue: true, fluxo: true },
  },
  {
    num: 5,
    group: 'elegivel',
    key: 'e5_dlp_90',
    nome: `Mass E5 DLP 90d ${RUN_ID}`,
    cpf: CPFS[4],
    conditionCode: 'dislipidemia',
    condicao: 'Dislipidemia (DLP)',
    receita_vencida_dias: 90,
    hora_offset_min: 12,
    meds: [{ name: 'Sinvastatina', dose: '20', unit: 'mg', frequency: '24h noite' }],
    expected: { elegivel: true, inQueue: true, fluxo: true },
  },
  {
    num: 6,
    group: 'elegivel',
    key: 'e6_has_120',
    nome: `Mass E6 HAS 120d ${RUN_ID}`,
    cpf: CPFS[5],
    conditionCode: 'hipertensao',
    condicao: 'Hipertensão arterial',
    receita_vencida_dias: 120,
    hora_offset_min: 15,
    meds: [
      { name: 'Losartana', dose: '100', unit: 'mg', frequency: '24h' },
      { name: 'Anlodipino', dose: '5', unit: 'mg', frequency: '24h' },
    ],
    expected: { elegivel: true, inQueue: true, fluxo: true },
  },
  {
    num: 7,
    group: 'inelegivel',
    key: 'i7_alerta',
    nome: `Mass I7 Sinais alerta ${RUN_ID}`,
    cpf: CPFS[6],
    conditionCode: 'hipertensao',
    condicao: 'HAS com sinais de alerta',
    receita_vencida_dias: 40,
    hora_offset_min: 18,
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
    has_warning_signs: true,
    sinais_alerta: 'SIM',
    expected: { elegivel: false, inQueue: false, fluxo: false, rejectApi: true },
  },
  {
    num: 8,
    group: 'inelegivel',
    key: 'i8_controlado',
    nome: `Mass I8 Controlado ${RUN_ID}`,
    cpf: CPFS[7],
    conditionCode: 'hipertensao',
    condicao: 'HAS — tentativa controlado',
    receita_vencida_dias: 50,
    hora_offset_min: 21,
    meds: [{ name: 'Clonazepam', dose: '2', unit: 'mg', frequency: '12/12h' }],
    medicacao: 'Clonazepam 2mg — benzodiazepínico',
    expected: { elegivel: false, inQueue: false, fluxo: false, rejectApi: true },
  },
  {
    num: 9,
    group: 'inelegivel',
    key: 'i9_receita_antiga',
    nome: `Mass I9 Receita 220d ${RUN_ID}`,
    cpf: CPFS[8],
    conditionCode: 'hipertensao',
    condicao: 'HAS receita vencida >180d',
    receita_vencida_dias: 220,
    hora_offset_min: 24,
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
    expected: { elegivel: false, inQueue: false, fluxo: false, rejectApi: true },
  },
  {
    num: 10,
    group: 'nao_pago',
    key: 'p10_sem_pagamento',
    nome: `Mass P10 Sem pagamento ${RUN_ID}`,
    cpf: CPFS[9],
    conditionCode: 'hipertensao',
    condicao: 'HAS — pagamento pendente',
    receita_vencida_dias: 35,
    hora_offset_min: 27,
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
    pagamento: false,
    expected: { elegivel: true, inQueue: false, fluxo: false, unpaid: true },
  },
];

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: response.status, ok: response.ok, data, text };
}

function authHeaders(token, correlationId) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
    'Idempotency-Key': `${correlationId}-${Math.random().toString(36).slice(2, 9)}`,
  };
}

function medicacaoLabel(meds, override) {
  if (override) return override;
  return meds.map((m) => `${m.name} ${m.dose}${m.unit}`).join(' + ');
}

function buildN8nPayload(p, phone) {
  const meds = p.meds;
  const medLabel = medicacaoLabel(meds, p.medicacao);
  const clinical = {
    condition: p.conditionCode,
    doenca_cronica: p.condicao,
    secondary_conditions: p.secondary || [],
    previous_prescription: true,
    continuous_use_proof: true,
    uso_continuo: true,
    tempo_uso: 'Mais de 6 meses',
    continuous_use_days: 365,
    receita_vencida_dias: p.receita_vencida_dias,
    eligibility_status: p.expected.elegivel === false && p.has_warning_signs ? 'ineligible' : 'eligible',
    medicacao_em_uso: medLabel,
    medications: meds.map((m, i) => ({ index: i + 1, ...m, continuous: true })),
    medication_count: meds.length,
    queixa_principal: `Simulação massiva P${p.num} — ${p.condicao}`,
    historico_clinico: `Prontuário simulado ${RUN_ID}. Offset ${p.hora_offset_min}min.`,
    conduta: `Renovar ${medLabel} conforme protocolo Doctor Prescreve.`,
    orientacoes_clinicas: 'Manter adesão e retorno se piora.',
    foto_receita_url: RX_PHOTO,
    previous_prescription_file: RX_PHOTO,
    flags: [],
    has_warning_signs: Boolean(p.has_warning_signs),
    sinais_alerta: p.sinais_alerta || 'NAO',
  };

  if (meds[0]) {
    clinical.med1_nome = meds[0].name;
    clinical.med1_dose = `${meds[0].dose}${meds[0].unit}`;
    clinical.primeiro_medicamento = `${meds[0].name} ${meds[0].dose}${meds[0].unit}`;
  }

  const pagamento = p.pagamento !== false;
  return {
    patient_name: p.nome,
    nome: p.nome,
    telefone: phone.replace(/\D/g, ''),
    whatsapp: phone.replace(/\D/g, ''),
    from: phone.replace(/\D/g, ''),
    cpf: p.cpf,
    email: `mass.p${p.num}.${TS}@simulacao.local`,
    birth_date: '15/08/1988',
    chronic_condition: 'has',
    has_previous_prescription: 'sim',
    receita_anterior: 'sim',
    previous_prescription_file: RX_PHOTO,
    foto_receita_url: RX_PHOTO,
    tempo_uso: 'Mais de 6 meses',
    sinais_alerta: p.sinais_alerta || 'NAO',
    has_warning_signs: Boolean(p.has_warning_signs),
    eligibility_status: clinical.eligibility_status,
    lgpd: 'sim',
    consentimento: 'sim',
    address: `Rua Massiva ${p.num}, 100`,
    cep: '01310100',
    payment_status: pagamento ? 'paid' : 'unpaid',
    pagamento_status: pagamento ? 'CONFIRMADO' : 'PENDENTE',
    medicacao: medLabel,
    med1_nome: clinical.med1_nome,
    med1_dose: clinical.med1_dose,
    text: [
      `Nome: ${p.nome}`,
      `CPF: ${p.cpf}`,
      `Condição: ${p.condicao}`,
      `Medicacao: ${medLabel}`,
      `Pagamento: ${pagamento ? 'CONFIRMADO' : 'PENDENTE'}`,
      `Simulação: ${RUN_ID}`,
    ].join('\n'),
    rawMessage: {
      provider: 'typebot',
      channel: 'whatsapp',
      source: 'simulacao-massiva-10',
      runId: RUN_ID,
      patientNum: p.num,
      original: clinical,
    },
  };
}

async function createViaN8n(p, index, correlationId) {
  const phone = `55117${String(TS + index).slice(-8)}`;
  const payload = buildN8nPayload(p, phone);
  const cid = `${correlationId}-n8n-p${p.num}`;
  const headers = { 'Content-Type': 'application/json', 'X-Correlation-Id': cid };
  if (SECRET) headers['X-MDoctor-Webhook-Secret'] = SECRET;

  const n8n = await requestJson(N8N_TYPEBOT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  let atendimentoId = n8n.data?.atendimento?.id || n8n.data?.atendimentoId || null;

  if (!atendimentoId) {
    const ingress = await requestJson(`${BACKEND}/api/atendimentos`, {
      method: 'POST',
      headers: {
        ...headers,
        ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {}),
      },
      body: JSON.stringify({
        paciente_nome: p.nome,
        paciente_telefone: phone,
        paciente_cpf: p.cpf,
        paciente_email: payload.email,
        condicao: p.condicao,
        pagamento_status: p.pagamento === false ? 'PENDENTE' : 'CONFIRMADO',
        dados_clinicos: payload.rawMessage.original,
      }),
    });
    atendimentoId = ingress.data?.atendimento?.id || null;
    return {
      ok: Boolean(atendimentoId),
      id: atendimentoId,
      phone,
      via: 'ingress_fallback',
      n8nStatus: n8n.status,
      ingressStatus: ingress.status,
    };
  }

  return { ok: true, id: atendimentoId, phone, via: 'n8n', n8nStatus: n8n.status };
}

async function resolveAtendimento(token, p, phone, correlationId) {
  const detail = await requestJson(`${BACKEND}/api/atendimentos?scope=all`, {
    headers: authHeaders(token, correlationId),
  });
  const list = detail.data?.atendimentos || [];
  const match =
    list.find((a) => a.paciente_nome === p.nome) ||
    list.find((a) => String(a.paciente_telefone || '').replace(/\D/g, '') === phone.replace(/\D/g, '')) ||
    list.find((a) => a.paciente_cpf === p.cpf);
  return match || null;
}

async function login(correlationId) {
  const r = await requestJson(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  return { ok: r.ok && r.data?.token, token: r.data?.token, status: r.status };
}

async function runEligibleFlow(token, p, atendimentoId, correlationId) {
  const h = authHeaders(token, `${correlationId}-flow-p${p.num}`);
  const steps = [];

  const save = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical`, {
    method: 'PATCH',
    headers: h,
    body: JSON.stringify({
      dados_clinicos: {
        conduta: `Conduta P${p.num} — simulação massiva.`,
        posology_notes: p.meds.map((m) => `${m.name} ${m.dose}${m.unit} ${m.frequency}`).join('; '),
      },
    }),
  });
  steps.push({ name: 'prontuario_salvar', ok: save.ok });

  const approve = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical/approve`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ motivo: `Mass P${p.num} approve`, conduta_medica: medicacaoLabel(p.meds, p.medicacao) }),
  });
  steps.push({
    name: 'approve',
    ok: approve.ok && ['approved', 'receita_em_edicao'].includes(String(approve.data?.atendimento?.status || '').toLowerCase()),
    status: approve.data?.atendimento?.status,
  });

  const memed = await lib.persistMemedReceipt(token, atendimentoId, `${correlationId}-memed-p${p.num}`, {
    receitaId: `staging-mass-${RUN_ID}-p${p.num}`,
    pdfUrl: `https://painel-medico-staging-staging.up.railway.app/favicon.ico`,
    payload: { simulation: true, runId: RUN_ID, patient: p.num, meds: p.meds },
  });
  steps.push({ name: 'memed_persist', ok: memed.ok, status: memed.status, code: memed.data?.code });

  const validate = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical/validate`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ motivo: 'Mass validate' }),
  });
  steps.push({ name: 'validate', ok: validate.ok });

  const deliver = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/deliver`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ channel: 'whatsapp' }),
  });
  const provider = String(deliver.data?.delivery?.provider || '').toLowerCase();
  steps.push({
    name: 'whatsapp_entrega',
    ok: deliver.ok || ['mock', 'dry-run'].includes(provider),
    provider: provider || null,
  });

  const final = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: h });
  steps.push({
    name: 'status_final',
    ok: final.ok,
    status: final.data?.atendimento?.status,
    hasPdf: Boolean(final.data?.atendimento?.dados_clinicos?.memed_receita?.pdfUrl),
  });

  return { steps, ok: steps.every((s) => s.ok) };
}

async function rejectIneligible(token, atendimentoId, p, correlationId) {
  const h = authHeaders(token, `${correlationId}-rej-p${p.num}`);
  return requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical/reject`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      reason_code: 'FORA_DO_PROTOCOLO',
      motivo: `Reprovação simulação P${p.num}`,
      observacao_medica: p.condicao,
    }),
  });
}

async function checkPersistence(token, atendimentoIds, correlationId) {
  const ids = atendimentoIds.filter(Boolean);
  const out = { ok: false, found: 0, ids: ids.length };
  for (const id of ids) {
    const row = await requestJson(`${BACKEND}/api/atendimentos/${id}`, {
      headers: authHeaders(token, `${correlationId}-db-${id.slice(0, 8)}`),
    });
    if (row.ok && row.data?.atendimento?.id) out.found += 1;
  }
  out.ok = out.found >= ids.length;
  return out;
}

function sectionOk(name, ok) {
  return { section: name, ok: Boolean(ok) };
}

async function main() {
  const correlationId = `sim-mass-10-${TS}`;
  const report = {
    generated_at: new Date().toISOString(),
    run_id: RUN_ID,
    backend: BACKEND,
    n8n: N8N_TYPEBOT,
    patients: [],
    sections: {},
    errors: [],
    stress_ready: false,
  };

  if (!MEDICO_PASS || !SECRET) {
    report.errors.push('MEDICO_PASS e N8N_WEBHOOK_SECRET obrigatórios');
    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const n8nPing = await requestJson(N8N_TYPEBOT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
    body: JSON.stringify({ probe: true, runId: RUN_ID }),
  });
  report.sections.n8n = sectionOk('n8n', n8nPing.status === 200);

  const readyz = await requestJson(`${BACKEND}/readyz`);
  report.sections.supabase = sectionOk(
    'supabase',
    readyz.data?.supabase?.connected === true ||
      readyz.data?.storage?.mode === 'supabase' ||
      readyz.data?.persistence_mode === 'supabase'
  );
  report.memed_real_mode = readyz.data?.memed?.real_mode === true;

  const session = await login(correlationId);
  if (!session.ok) {
    report.errors.push('login_failed');
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const refreshProbe = await requestJson(`${BACKEND}/api/auth/refresh`, {
    method: 'POST',
    headers: authHeaders(session.token, correlationId),
    body: '{}',
  });
  report.sections.login = sectionOk('login', session.ok && refreshProbe.ok);

  const createdIds = [];

  for (let i = 0; i < PATIENTS.length; i++) {
    const p = PATIENTS[i];
    if (i > 0) await sleep(1800);
    const created = await createViaN8n(p, i, correlationId);
    await sleep(400);
    let at = null;
    if (created.id) {
      const got = await requestJson(`${BACKEND}/api/atendimentos/${created.id}`, {
        headers: authHeaders(session.token, correlationId),
      });
      at = got.data?.atendimento;
    } else {
      at = await resolveAtendimento(session.token, p, created.phone, correlationId);
    }
    const atendimentoId = at?.id || created.id;
    if (atendimentoId) createdIds.push(atendimentoId);

    const queue = await requestJson(`${BACKEND}/api/atendimentos/queue`, {
      headers: authHeaders(session.token, correlationId),
    });
    const panel = await requestJson(`${BACKEND}/api/atendimentos`, { headers: authHeaders(session.token, correlationId) });
    const all = await requestJson(`${BACKEND}/api/atendimentos?scope=all`, {
      headers: authHeaders(session.token, correlationId),
    });

    const inQueue = (queue.data?.atendimentos || []).some((a) => a.id === atendimentoId);
    const inPanel = (panel.data?.atendimentos || []).some((a) => a.id === atendimentoId);
    const inAll = (all.data?.atendimentos || []).some((a) => a.id === atendimentoId);
    const elig = at?.elegibilidade?.eligible === true;
    const status = String(at?.status || '').toLowerCase();
    const paid = String(at?.pagamento_status || '').toUpperCase() === 'CONFIRMADO';

    let flow = null;
    if (p.expected.fluxo) {
      flow = await runEligibleFlow(session.token, p, atendimentoId, correlationId);
    } else if (p.expected.rejectApi && atendimentoId) {
      const approveProbe = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical/approve`, {
        method: 'POST',
        headers: authHeaders(session.token, `${correlationId}-probe-p${p.num}`),
        body: JSON.stringify({ motivo: 'probe bloqueado' }),
      });
      const rej =
        status === 'rejected' || !elig
          ? { ok: true, skipped: 'ja_rejeitado_triagem' }
          : await rejectIneligible(session.token, atendimentoId, p, correlationId);
      flow = {
        steps: [
          { name: 'approve_bloqueado', ok: approveProbe.status >= 400 },
          { name: 'reject', ok: rej.ok || status === 'rejected' },
        ],
        ok: approveProbe.status >= 400 && (rej.ok || status === 'rejected'),
      };
    }

    const checks = {
      criado: Boolean(atendimentoId),
      elegivel: elig === p.expected.elegivel,
      fila: inQueue === p.expected.inQueue,
      painel: inPanel || inAll,
      fluxo: p.expected.fluxo ? flow?.ok === true : true,
      nao_pago_fora_fila: p.pagamento === false ? !inQueue : true,
      approve_bloqueado: p.expected.rejectApi ? flow?.steps?.[0]?.ok !== false : true,
      status_ok: p.expected.unpaid
        ? !paid && String(at?.pagamento_status || '').toUpperCase() !== 'CONFIRMADO'
        : p.expected.elegivel === false
          ? status === 'rejected' || !elig
          : paid,
    };

    const ok = Object.values(checks).every(Boolean);
    report.patients.push({
      num: p.num,
      group: p.group,
      nome: p.nome,
      atendimentoId,
      via: created.via,
      obtained: { elig, status, paid, inQueue, inPanel, inAll },
      checks,
      flow,
      ok,
    });
  }

  const eligible = report.patients.filter((p) => p.group === 'elegivel');
  const ineligible = report.patients.filter((p) => p.group === 'inelegivel');
  const unpaid = report.patients.filter((p) => p.group === 'nao_pago');

  report.sections.elegiveis = sectionOk('elegiveis', eligible.length === 6 && eligible.every((p) => p.ok));
  report.sections.inelegiveis = sectionOk('inelegiveis', ineligible.length === 3 && ineligible.every((p) => p.ok));
  report.sections.nao_pago = sectionOk('nao_pago', unpaid.length === 1 && unpaid.every((p) => p.ok));

  const queueOrder = await requestJson(`${BACKEND}/api/atendimentos/queue`, {
    headers: authHeaders(session.token, correlationId),
  });
  const queueList = queueOrder.data?.atendimentos || [];
  const queueTimes = queueList.map((a) => new Date(a.created_at || a.updated_at || 0).getTime());
  const monotonicQueue =
    queueTimes.length < 2 || queueTimes.every((t, i) => i === 0 || t >= queueTimes[i - 1]);
  const filaPerPatient =
    eligible.every((p) => p.checks.fila) &&
    ineligible.every((p) => p.checks.fila) &&
    unpaid.every((p) => p.checks.fila);
  report.sections.fila = sectionOk('fila', queueOrder.ok && filaPerPatient && monotonicQueue);

  report.sections.prontuario = sectionOk(
    'prontuario',
    eligible.every((p) => p.flow?.steps?.some((s) => s.name === 'prontuario_salvar' && s.ok))
  );
  report.sections.memed = sectionOk(
    'memed',
    eligible.every((p) => p.flow?.steps?.some((s) => s.name === 'memed_persist' && s.ok))
  );
  report.sections.whatsapp = sectionOk(
    'whatsapp',
    eligible.every((p) => p.flow?.steps?.some((s) => s.name === 'whatsapp_entrega' && s.ok))
  );

  const admin = await requestJson(`${BACKEND}/api/admin/status`, {
    headers: authHeaders(session.token, correlationId),
  });
  report.sections.dashboard = sectionOk('dashboard', admin.ok && admin.data?.metrics);

  const db = await checkPersistence(session.token, createdIds, correlationId);
  report.sections.supabase_rows = sectionOk('supabase_rows', db.ok);
  report.persistence_check = db;

  report.sections.e2e = sectionOk(
    'e2e',
    Object.values(report.sections).every((s) => s.ok) && report.patients.every((p) => p.ok)
  );

  report.stress_ready = report.sections.e2e?.ok === true;

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

  const md = [
    '# Simulação Massiva — 10 Pacientes',
    '',
    `> ${report.generated_at}`,
    `> Run: \`${RUN_ID}\``,
    '',
    '| Seção | OK |',
    '|-------|-----|',
    ...Object.entries(report.sections).map(([k, v]) => `| ${k} | ${v.ok ? '✅' : '❌'} |`),
    '',
    '| # | Grupo | Fila | Elegível | Fluxo | OK |',
    '|---|-------|------|----------|-------|-----|',
    ...report.patients.map(
      (p) =>
        `| ${p.num} | ${p.group} | ${p.obtained.inQueue ? 'sim' : 'não'} | ${p.obtained.elig ? 'sim' : 'não'} | ${
          p.flow?.ok === true ? 'sim' : p.flow?.ok === false ? 'não' : '—'
        } | ${p.ok ? '✅' : '❌'} |`
    ),
    '',
    `**SYSTEM STRESS READY:** ${report.stress_ready ? 'YES' : 'NO'}`,
  ].join('\n');
  fs.writeFileSync(REPORT_MD, md, 'utf8');

  console.log(
    JSON.stringify(
      {
        stress_ready: report.stress_ready,
        ok: report.patients.filter((p) => p.ok).length,
        total: report.patients.length,
        sections: report.sections,
        report: REPORT_MD,
      },
      null,
      2
    )
  );
  process.exit(report.stress_ready ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
