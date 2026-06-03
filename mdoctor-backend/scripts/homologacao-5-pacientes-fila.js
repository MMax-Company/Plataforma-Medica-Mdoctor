#!/usr/bin/env node
/**
 * Cria 5 atendimentos reais no backend/Supabase para homologação humana do painel.
 * Sem mock de UI; sem approve automático (médico testa manualmente).
 *
 *   node scripts/homologacao-5-pacientes-fila.js
 * (carrega MEDICO_PASS de .env.local via load-dotenv)
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const REPORT_JSON = path.join(__dirname, '../../docs/HOMOLOGACAO-5-PACIENTES-FILA-RELATORIO.json');
const REPORT_MD = path.join(__dirname, '../../docs/HOMOLOGACAO-5-PACIENTES-FILA-RELATORIO.md');
const RX_PHOTO = 'https://example.com/receita-homologacao-painel.jpg';
const RUN_TAG = process.env.HOMOLOG_RUN_TAG || `homolog-${Date.now()}`;

/** CPFs válidos (dígito verificador OK) — únicos por paciente */
const CPFS = ['93642479859', '74816998030', '60783309080', '45317828791', '23100299900'];

const PATIENTS = [
  {
    num: 1,
    nome: 'PACIENTE TESTE 01 - DOR ABDOMINAL',
    cpf: CPFS[0],
    sexo: 'F',
    idade: 42,
    data_nascimento: '12/03/1984',
    condicao: 'Hipertensão arterial (HAS)',
    conditionCode: 'hipertensao',
    queixa: 'Desconforto abdominal leve em paciente com HAS em uso contínuo — homologação painel.',
    receita_vencida_dias: 35,
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
  },
  {
    num: 2,
    nome: 'PACIENTE TESTE 02 - HIPERTENSÃO',
    cpf: CPFS[1],
    sexo: 'M',
    idade: 55,
    data_nascimento: '20/07/1970',
    condicao: 'Hipertensão arterial (HAS)',
    conditionCode: 'hipertensao',
    queixa: 'Renovação de anti-hipertensivo — homologação painel.',
    receita_vencida_dias: 40,
    meds: [
      { name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' },
      { name: 'Hidroclorotiazida', dose: '25', unit: 'mg', frequency: '24h' },
    ],
  },
  {
    num: 3,
    nome: 'PACIENTE TESTE 03 - DIABETES',
    cpf: CPFS[2],
    sexo: 'F',
    idade: 48,
    data_nascimento: '05/11/1977',
    condicao: 'Diabetes mellitus tipo 2',
    conditionCode: 'diabetes_tipo_2',
    queixa: 'Renovação de hipoglicemiante oral — homologação painel.',
    receita_vencida_dias: 50,
    meds: [{ name: 'Metformina', dose: '850', unit: 'mg', frequency: '12/12h' }],
  },
  {
    num: 4,
    nome: 'PACIENTE TESTE 04 - ANSIEDADE',
    cpf: CPFS[3],
    sexo: 'M',
    idade: 36,
    data_nascimento: '18/09/1989',
    condicao: 'Hipotireoidismo',
    conditionCode: 'hipotireoidismo',
    queixa:
      'Paciente com hipotireoidismo em uso contínuo; relata ansiedade leve associada — cenário de homologação (rótulo ANSIEDADE).',
    receita_vencida_dias: 45,
    meds: [{ name: 'Levotiroxina', dose: '50', unit: 'mcg', frequency: '24h jejum' }],
  },
  {
    num: 5,
    nome: 'PACIENTE TESTE 05 - RENOVAÇÃO RECEITA',
    cpf: CPFS[4],
    sexo: 'F',
    idade: 62,
    data_nascimento: '22/01/1964',
    condicao: 'Hipertensão arterial (HAS)',
    conditionCode: 'hipertensao',
    queixa: 'Renovação de receita crônica — homologação fluxo receita/Memed.',
    receita_vencida_dias: 30,
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
    historico_clinico: `Homologação humana painel — ${RUN_TAG}. Uso contínuo documentado.`,
    foto_receita_url: RX_PHOTO,
    previous_prescription_file: RX_PHOTO,
    paciente_sexo: p.sexo,
    paciente_idade: p.idade,
    data_nascimento: p.data_nascimento,
    flags: [],
    has_warning_signs: false,
    homologacao_painel: true,
    homologacao_run: RUN_TAG,
  };

  if (meds[0]) {
    clinical.primeiro_medicamento = `${meds[0].name} ${meds[0].dose}${meds[0].unit}`;
    clinical.med1_nome = meds[0].name;
    clinical.med1_dose = `${meds[0].dose}${meds[0].unit}`;
  }
  if (meds[1]) {
    clinical.segundo_medicamento = `${meds[1].name} ${meds[1].dose}${meds[1].unit}`;
    clinical.med2_nome = meds[1].name;
    clinical.med2_dose = `${meds[1].dose}${meds[1].unit}`;
  }

  return {
    paciente_nome: p.nome,
    paciente_telefone: phone,
    paciente_cpf: p.cpf,
    paciente_email: `homolog.teste0${p.num}@mdoctor.local`,
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

async function createPatient(p, index, correlationId) {
  const phone = `+5511988${String(700000 + p.num).slice(-7)}`;
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
  checks.nome_painel = (at.paciente_nome || '').includes(`PACIENTE TESTE 0${p.num}`);

  const approveProbe = await requestJson(`${BACKEND}/api/atendimentos/${created.id}/clinical/approve`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ motivo: 'probe homologacao — nao executar em prod' }),
  });
  checks.approve_disponivel =
    approveProbe.status === 200 || approveProbe.status === 409 || approveProbe.status === 422;

  const ok =
    checks.na_fila &&
    checks.prontuario_carrega &&
    checks.elegivel &&
    checks.pago &&
    checks.nome_painel &&
    (checks.status === 'waiting' || checks.status === 'queue') &&
    checks.approve_disponivel;

  return { checks, atendimento: at, ok };
}

function writeMarkdown(report) {
  const lines = [
    '# Homologação — 5 pacientes na fila do painel',
    '',
    `> ${report.generated_at}`,
    `> Backend: ${report.backend_url}`,
    `> Run: \`${report.run_tag}\``,
    '',
    report.ready_for_human
      ? '**Prontos para teste humano** — 5 atendimentos na fila staging.'
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
  lines.push('', '## URLs painel', '');
  for (const row of report.patients) {
    if (row.atendimentoId) {
      lines.push(
        `- **${row.nome}:** [fila](${report.panel_url}/fila) · [atendimento](${report.panel_url}/atendimento/${row.atendimentoId}) · [receita](${report.panel_url}/receita?atendimentoId=${row.atendimentoId})`
      );
    }
  }
  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');
}

async function main() {
  const correlationId = `homolog-5-fila-${Date.now()}`;
  const report = {
    generated_at: new Date().toISOString(),
    backend_url: BACKEND,
    panel_url: String(
      process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app'
    ).replace(/\/$/, ''),
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

  for (let i = 0; i < PATIENTS.length; i++) {
    const p = PATIENTS[i];
    const created = await createPatient(p, i, correlationId);
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

  console.log(
    JSON.stringify(
      {
        success: report.ready_for_human,
        patients: report.patients.map((p) => ({
          num: p.num,
          nome: p.nome,
          atendimentoId: p.atendimentoId,
          status: p.status,
          ok: p.ok,
        })),
        report: REPORT_MD,
      },
      null,
      2
    )
  );
  process.exit(report.ready_for_human ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
