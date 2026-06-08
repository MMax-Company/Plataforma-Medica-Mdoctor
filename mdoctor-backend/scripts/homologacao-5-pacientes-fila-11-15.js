#!/usr/bin/env node
/**
 * Cria 5 atendimentos TESTE 11–15 na fila staging (homologação painel).
 *   node scripts/homologacao-5-pacientes-fila-11-15.js
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const REPORT_JSON = path.join(__dirname, '../../docs/HOMOLOGACAO-5-PACIENTES-FILA-11-15-RELATORIO.json');
const REPORT_MD = path.join(__dirname, '../../docs/HOMOLOGACAO-5-PACIENTES-FILA-11-15-RELATORIO.md');
const RX_PHOTO = 'https://example.com/receita-homologacao-painel.jpg';
const RUN_TAG = process.env.HOMOLOG_RUN_TAG || `homolog-11-15-${Date.now()}`;

const CPFS = ['52998224725', '11144477735', '39053344705', '28625587896', '81717023088'];

const PATIENTS = [
  {
    num: 11,
    nome: 'PACIENTE TESTE 11',
    cpf: CPFS[0],
    sexo: 'F',
    idade: 41,
    data_nascimento: '08/04/1985',
    condicao: 'Hipertensão arterial (HAS)',
    conditionCode: 'hipertensao',
    queixa: 'Renovação HAS — homologação fila painel TESTE 11.',
    receita_vencida_dias: 32,
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
  },
  {
    num: 12,
    nome: 'PACIENTE TESTE 12',
    cpf: CPFS[1],
    sexo: 'M',
    idade: 52,
    data_nascimento: '15/09/1973',
    condicao: 'Hipertensão arterial (HAS)',
    conditionCode: 'hipertensao',
    queixa: 'Controle pressórico — homologação fila painel TESTE 12.',
    receita_vencida_dias: 38,
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
  },
  {
    num: 13,
    nome: 'PACIENTE TESTE 13',
    cpf: CPFS[2],
    sexo: 'F',
    idade: 47,
    data_nascimento: '22/06/1978',
    condicao: 'Diabetes mellitus tipo 2',
    conditionCode: 'diabetes_tipo_2',
    queixa: 'Renovação metformina — homologação fila painel TESTE 13.',
    receita_vencida_dias: 44,
    meds: [{ name: 'Metformina', dose: '850', unit: 'mg', frequency: '12/12h' }],
  },
  {
    num: 14,
    nome: 'PACIENTE TESTE 14',
    cpf: CPFS[3],
    sexo: 'M',
    idade: 38,
    data_nascimento: '03/12/1987',
    condicao: 'Hipotireoidismo',
    conditionCode: 'hipotireoidismo',
    queixa: 'Renovação levotiroxina — homologação fila painel TESTE 14.',
    receita_vencida_dias: 41,
    meds: [{ name: 'Levotiroxina', dose: '75', unit: 'mcg', frequency: '24h jejum' }],
  },
  {
    num: 15,
    nome: 'PACIENTE TESTE 15',
    cpf: CPFS[4],
    sexo: 'F',
    idade: 59,
    data_nascimento: '30/01/1967',
    condicao: 'Hipertensão arterial (HAS)',
    conditionCode: 'hipertensao',
    queixa: 'Renovação crônica — homologação fluxo approve/reject TESTE 15.',
    receita_vencida_dias: 28,
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function requestJson(url, options = {}, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text.slice(0, 400) };
      }
      return { status: response.status, ok: response.ok, data };
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

function authHeaders(token, correlationId) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
  };
}

function medicacaoLabel(meds) {
  return meds.map((m) => `${m.name} ${m.dose}${m.unit}`).join(' + ');
}

function buildCreateBody(p, phone) {
  const meds = p.meds;
  const clinical = {
    condition: p.conditionCode,
    doenca_cronica: p.condicao,
    previous_prescription: true,
    continuous_use_proof: true,
    uso_continuo: true,
    tempo_uso: 'Mais de 6 meses',
    continuous_use_days: 365,
    receita_vencida_dias: p.receita_vencida_dias,
    eligibility_status: 'eligible',
    medicacao_em_uso: medicacaoLabel(meds),
    medications: meds.map((m, i) => ({ index: i + 1, ...m, continuous: true })),
    medication_count: meds.length,
    queixa_principal: p.queixa,
    historico_clinico: `Homologação painel TESTE ${p.num} — ${RUN_TAG}. Uso contínuo documentado.`,
    foto_receita_url: RX_PHOTO,
    previous_prescription_file: RX_PHOTO,
    paciente_sexo: p.sexo,
    paciente_idade: p.idade,
    data_nascimento: p.data_nascimento,
    flags: [],
    has_warning_signs: false,
    homologacao_painel: true,
    homologacao_run: RUN_TAG,
    homologacao_teste_num: p.num,
  };

  if (meds[0]) {
    clinical.primeiro_medicamento = `${meds[0].name} ${meds[0].dose}${meds[0].unit}`;
    clinical.med1_nome = meds[0].name;
    clinical.med1_dose = `${meds[0].dose}${meds[0].unit}`;
  }

  return {
    paciente_nome: p.nome,
    paciente_telefone: phone,
    paciente_cpf: p.cpf,
    paciente_email: `homolog.teste${p.num}@mdoctor.local`,
    data_nascimento: p.data_nascimento,
    condicao: p.condicao,
    pagamento_status: 'CONFIRMADO',
    status: 'QUEUE',
    dados_clinicos: clinical,
  };
}

async function login(correlationId) {
  const r = await requestJson(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  return { ok: r.ok && r.data?.token, token: r.data?.token, status: r.status };
}

async function createPatient(p, correlationId) {
  const phone = `+5511999${String(110000 + p.num).slice(-7)}`;
  const body = buildCreateBody(p, phone);
  const ingressSecret = process.env.INGRESS_SERVICE_SECRET || process.env.N8N_WEBHOOK_SECRET || '';
  const r = await requestJson(`${BACKEND}/api/atendimentos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      ...(ingressSecret ? { 'X-MDoctor-Webhook-Secret': ingressSecret } : {}),
    },
    body: JSON.stringify(body),
  });
  const at = r.data?.atendimento || {};
  return {
    ok: r.ok && at.id,
    id: at.id,
    status: r.status,
    atendimento: at,
    error: r.data?.error,
    phone,
  };
}

async function validatePatient(token, p, created, correlationId) {
  const h = authHeaders(token, `${correlationId}-v${p.num}`);
  const checks = {};

  const queue = await requestJson(`${BACKEND}/api/atendimentos/queue`, { headers: h });
  const row = (queue.data?.atendimentos || []).find((a) => a.id === created.id);
  checks.na_fila = Boolean(row);
  checks.fila_status = queue.status;

  const detail = await requestJson(`${BACKEND}/api/atendimentos/${created.id}`, { headers: h });
  const at = detail.data?.atendimento || {};
  checks.prontuario_carrega = detail.ok && at.id === created.id;
  checks.status = String(at.status || '').toLowerCase();
  checks.elegivel = at.elegibilidade?.eligible === true;
  checks.pago = String(at.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
  checks.nome_painel = (at.paciente_nome || '').includes(`PACIENTE TESTE ${p.num}`);

  const ok =
    checks.na_fila &&
    checks.prontuario_carrega &&
    checks.elegivel &&
    checks.pago &&
    checks.nome_painel &&
    (checks.status === 'waiting' || checks.status === 'queue') &&
    checks.approve_disponivel !== false;

  return { checks, atendimento: at, ok };
}

function writeMarkdown(report) {
  const lines = [
    '# Homologação — 5 pacientes TESTE 11–15 na fila',
    '',
    `> ${report.generated_at}`,
    `> Backend: ${report.backend_url}`,
    `> Run: \`${report.run_tag}\``,
    '',
    report.ready_for_human
      ? '**Prontos para teste operacional** — 5 atendimentos na FILA DE ESPERA staging.'
      : '**Requer revisão** — ver falhas abaixo.',
    '',
    '| # | Nome | atendimentoId | Status | Fila | Prontuário |',
    '|---|------|---------------|--------|------|------------|',
  ];
  for (const row of report.patients) {
    const icon = row.ok ? '✅' : '❌';
    lines.push(
      `| ${row.num} | ${row.nome} | \`${row.atendimentoId || '—'}\` | \`${row.status || '—'}\` | ${row.checks?.na_fila ? 'sim' : 'não'} | ${row.checks?.prontuario_carrega ? 'sim' : 'não'} | ${icon} |`
    );
  }
  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');
}

async function main() {
  const correlationId = `homolog-11-15-${Date.now()}`;
  const report = {
    generated_at: new Date().toISOString(),
    backend_url: BACKEND,
    panel_url: String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, ''),
    run_tag: RUN_TAG,
    patients: [],
    ready_for_human: false,
  };

  if (!MEDICO_PASS) {
    console.error('MEDICO_PASS obrigatório (mdoctor-backend/.env.local)');
    process.exit(1);
  }

  const session = await login(correlationId);
  if (!session.ok) {
    console.error('Login falhou', session.status);
    process.exit(1);
  }

  for (const p of PATIENTS) {
    const created = await createPatient(p, correlationId);
    if (!created.ok) {
      report.patients.push({
        num: p.num,
        nome: p.nome,
        ok: false,
        error: created.error || `HTTP ${created.status}`,
      });
      continue;
    }

    await sleep(400);
    const validation = await validatePatient(session.token, p, created, correlationId);
    report.patients.push({
      num: p.num,
      nome: p.nome,
      cpf: p.cpf,
      telefone: created.phone,
      email: `homolog.teste${p.num}@mdoctor.local`,
      sexo: p.sexo,
      idade: p.idade,
      queixa: p.queixa,
      atendimentoId: created.id,
      status: validation.checks.status,
      elegivel: validation.checks.elegivel,
      checks: validation.checks,
      ok: validation.ok,
    });
  }

  report.ready_for_human = report.patients.length === 5 && report.patients.every((r) => r.ok);

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  writeMarkdown(report);

  console.log(JSON.stringify({ success: report.ready_for_human, patients: report.patients, report: REPORT_MD }, null, 2));
  process.exit(report.ready_for_human ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
