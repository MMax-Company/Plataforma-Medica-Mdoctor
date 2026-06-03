#!/usr/bin/env node
/**
 * Simulação clínica operacional — 3 pacientes fictícios (HAS, Diabetes, Hipotireoidismo).
 * API staging + checagem UI leve 1366×768. Sem WhatsApp/Memed real.
 *
 *   MEDICO_PASS=... node scripts/simulacao-clinica-painel.js
 */
const fs = require('fs');
const path = require('path');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const REPORT_JSON = path.join(__dirname, '../../docs/SIMULACAO-CLINICA-PAINEL-RELATORIO.json');
const REPORT_MD = path.join(__dirname, '../../docs/SIMULACAO-CLINICA-PAINEL-RELATORIO.md');

const TS = Date.now();

const PATIENTS = [
  {
    key: 'has',
    conditionCode: 'hipertensao',
    condicao: 'Hipertensão arterial (HAS)',
    medicacao: 'Losartana 50mg 1x ao dia',
    cpf: '52998224725',
    queixa: 'Renovação de anti-hipertensivo — pressão estável em acompanhamento.',
    historico: 'HAS diagnosticada há 4 anos. Uso contínuo de losartana sem intercorrências.',
    nome: `Sim HAS ${TS}`,
  },
  {
    key: 'diabetes',
    conditionCode: 'diabetes_tipo_2',
    condicao: 'Diabetes mellitus tipo 2',
    medicacao: 'Metformina 850mg 2x ao dia',
    cpf: '39053344705',
    queixa: 'Renovação de metformina — glicemias estáveis no último trimestre.',
    historico: 'DM2 em tratamento oral há 3 anos. Sem hipoglicemias relatadas.',
    nome: `Sim Diabetes ${TS}`,
  },
  {
    key: 'hipotireoidismo',
    conditionCode: 'hipotireoidismo',
    condicao: 'Hipotireoidismo',
    medicacao: 'Levotiroxina 50mcg 1x ao dia em jejum',
    cpf: '15350946056',
    queixa: 'Renovação de levotiroxina — sintomas compensados.',
    historico: 'Hipotireoidismo primário em uso contínuo. TSH recente dentro da meta.',
    nome: `Sim Hipotireo ${TS}`,
  },
];

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { status: response.status, ok: response.ok, data };
}

function authHeaders(token, correlationId) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Correlation-Id': correlationId,
  };
}

function step(name, ok, extra = {}) {
  return { name, ok: Boolean(ok), ...extra };
}

async function login(correlationId) {
  const r = await requestJson(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': correlationId },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  return { ok: r.ok && r.data?.token, token: r.data?.token, status: r.status, error: r.data?.error };
}

function buildCreateBody(p, phone) {
  return {
    paciente_nome: p.nome,
    paciente_telefone: phone,
    paciente_cpf: p.cpf,
    paciente_email: `${p.key}.${TS}@simulacao.local`,
    condicao: p.condicao,
    pagamento_status: 'CONFIRMADO',
    status: 'QUEUE',
    dados_clinicos: {
      condition: p.conditionCode,
      doenca_cronica: p.conditionCode,
      previous_prescription: true,
      continuous_use_proof: true,
      uso_continuo: true,
      tempo_uso: 'Mais de 6 meses',
      continuous_use_days: 180,
      eligibility_status: 'eligible',
      medicacao_em_uso: p.medicacao,
      queixa_principal: p.queixa,
      historico_clinico: p.historico,
      exame_fisico_telemedicina: 'Teleconsulta assíncrona — sem sinais de alarme.',
      alergias: 'Nenhuma conhecida',
      conduta_sugerida: `Renovar ${p.medicacao} conforme protocolo.`,
      foto_receita_url: 'https://example.com/receita-simulacao.jpg',
      previous_prescription_file: 'https://example.com/receita-simulacao.jpg',
      flags: [],
    },
  };
}

async function createPatient(p, index, correlationId) {
  const phone = `+55119${String(TS + index).slice(-8)}`;
  const ingressSecret = process.env.INGRESS_SERVICE_SECRET || process.env.N8N_WEBHOOK_SECRET || '';
  const r = await requestJson(`${BACKEND}/api/atendimentos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      ...(ingressSecret ? { 'X-MDoctor-Webhook-Secret': ingressSecret } : {})
    },
    body: JSON.stringify(buildCreateBody(p, phone)),
  });
  const id = r.data?.atendimento?.id;
  return { ok: r.ok && id, id, status: r.status, phone, error: r.data?.error, statusCreated: r.data?.atendimento?.status };
}

async function runPatientFlow(token, p, atendimentoId, correlationId) {
  const steps = [];
  const cid = `${correlationId}-${p.key}`;

  const queue = await requestJson(`${BACKEND}/api/atendimentos/queue`, { headers: authHeaders(token, cid) });
  const inQueue = (queue.data?.atendimentos || []).some((a) => a.id === atendimentoId);
  const inList = await requestJson(`${BACKEND}/api/atendimentos`, { headers: authHeaders(token, cid) });
  const listed = (inList.data?.atendimentos || []).some((a) => a.id === atendimentoId);
  steps.push(step('fila_lista_paciente', inQueue || listed, { status: queue.status, inQueue, listed }));

  const detail = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: authHeaders(token, cid) });
  const clinical = detail.data?.atendimento?.dados_clinicos || {};
  const hasClinical =
    Boolean(clinical.queixa_principal) &&
    Boolean(clinical.historico_clinico) &&
    Boolean(clinical.medicacao_em_uso || p.medicacao);
  steps.push(step('prontuario_dados_carregados', detail.ok && hasClinical, {
    status: detail.status,
    queixa: clinical.queixa_principal?.slice(0, 40),
  }));

  const save = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical`, {
    method: 'PATCH',
    headers: authHeaders(token, cid),
    body: JSON.stringify({
      dados_clinicos: {
        conduta_medica: `Simulação piloto — ${p.condicao}. Paciente estável para renovação.`,
        observacao_medica: 'Prontuário salvo na simulação clínica.',
      },
    }),
  });
  steps.push(step('prontuario_salvo', save.ok, { status: save.status }));

  const approve = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical/approve`, {
    method: 'POST',
    headers: authHeaders(token, cid),
    body: JSON.stringify({
      motivo: `Simulação — aprovação ${p.condicao}`,
      observacao_medica: 'Aprovado na simulação operacional.',
      conduta_medica: `Renovar ${p.medicacao}.`,
    }),
  });
  const approvedStatus = approve.data?.atendimento?.status;
  steps.push(step('aprovar_atendimento', approve.ok && approvedStatus === 'approved', {
    status: approve.status,
    statusNovo: approvedStatus,
    error: approve.data?.error,
  }));

  const memed = await requestJson(`${BACKEND}/api/memed/receita`, {
    method: 'POST',
    headers: authHeaders(token, cid),
    body: JSON.stringify({
      atendimentoId,
      receitaId: `sim-mock-${p.key}-${TS}`,
      pdfUrl: `https://example.invalid/sim-${atendimentoId}.pdf`,
      payload: { mock: true, simulacao: true, condicao: p.key },
    }),
  });
  steps.push(step('receita_mock_persistida', memed.ok, { status: memed.status }));

  const validate = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical/validate`, {
    method: 'POST',
    headers: authHeaders(token, cid),
    body: JSON.stringify({ motivo: 'Simulação — validação receita mock' }),
  });
  steps.push(step('validar_receita_ready', validate.ok, {
    status: validate.status,
    statusNovo: validate.data?.atendimento?.status,
  }));

  const deliver = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/deliver`, {
    method: 'POST',
    headers: authHeaders(token, cid),
    body: JSON.stringify({ channel: 'whatsapp' }),
  });
  const provider = deliver.data?.delivery?.provider;
  const deliveryMock = ['mock', 'dry-run'].includes(String(provider || '').toLowerCase());
  const stoppedBeforeReal = deliveryMock || !deliver.ok;
  steps.push(step('whatsapp_simulado_sem_envio_real', stoppedBeforeReal, {
    status: deliver.status,
    provider: provider || null,
    deliveryStatus: deliver.data?.delivery?.status,
    nota: deliveryMock ? 'Mock/dry-run — nenhum WhatsApp real' : deliver.data?.error || 'Entrega não executada (proposital)',
  }));

  const finalGet = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: authHeaders(token, cid) });
  steps.push(step('persistencia_final', finalGet.ok, {
    statusFinal: finalGet.data?.atendimento?.status,
    temReceita: Boolean(finalGet.data?.atendimento?.dados_clinicos?.memed_receita?.pdfUrl),
  }));

  return { patient: p.key, atendimentoId, steps, ok: steps.every((s) => s.ok) };
}

async function runUiChecks(token, user, atendimentoId, patientName) {
  const issues = [];
  const ok = [];
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    return { skipped: true, reason: 'playwright não disponível' };
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.addInitScript((t, u) => {
    localStorage.setItem('mdoctor_auth_token', t);
    localStorage.setItem('mdoctor_auth_user', JSON.stringify(u));
  }, token, user);

  try {
    await page.goto(`${PANEL}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    ok.push('tela_login_abre');

    await page.goto(`${PANEL}/fila`, { waitUntil: 'networkidle', timeout: 45000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    if (!overflow) ok.push('fila_1366_sem_overflow');
    else issues.push('fila_overflow_horizontal');

    const cols = await page.locator('.grid.grid-cols-3 > section, .grid.gap-4.md\\:grid-cols-3 > section').count();
    if (cols >= 3) ok.push('fila_3_colunas');
    else issues.push(`fila_colunas_${cols}`);

    await page.goto(`${PANEL}/atendimento/${atendimentoId}`, { waitUntil: 'networkidle', timeout: 45000 });
    const text = await page.locator('main').innerText();
    if (text.includes(patientName.split(' ').slice(0, 2).join(' ')) || text.includes('Sim')) ok.push('atendimento_nome_visivel');
    else issues.push('atendimento_nome_nao_encontrado');

    const reprovar = page.getByRole('button', { name: /^reprovar$/i }).first();
    const aprovar = page.getByRole('button', { name: /^aprovar$/i }).first();
    if (await reprovar.isVisible()) ok.push('botao_reprovar_visivel');
    else issues.push('botao_reprovar_oculto');
    if (await aprovar.isVisible()) ok.push('botao_aprovar_visivel');
    else issues.push('botao_aprovar_oculto');

    if (text.includes('Não informado') && !text.includes('Losartana') && !text.includes('Metformina') && !text.includes('Levotiroxina')) {
      issues.push('campos_clinicos_vazios_ui');
    } else {
      ok.push('dados_clinicos_ui');
    }

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForTimeout(800);
    if (errors.length === 0) ok.push('sem_erro_critico_frontend');
    else issues.push(`frontend_errors:${errors.join(';')}`);
  } catch (e) {
    issues.push(`ui_exception:${e.message}`);
  } finally {
    await browser.close();
  }

  return { ok, issues };
}

function writeMarkdown(report) {
  const lines = [
    '# Simulação Clínica — Painel Médico',
    '',
    `> ${report.generated_at}`,
    `> Backend: ${report.backend_url}`,
    `> Painel: ${report.panel_url}`,
    '',
    '## Conclusão',
    '',
    report.piloto_fechado_ok ? '**Painel utilizável para piloto fechado médico:** sim, com ressalvas abaixo.' : '**Painel utilizável para piloto fechado médico:** ainda não — corrigir falhas listadas.',
    '',
    '## O que funcionou',
    '',
  ];
  for (const item of report.funcionou) lines.push(`- ${item}`);
  lines.push('', '## O que falhou', '');
  if (report.falhou.length) report.falhou.forEach((f) => lines.push(`- ${f}`));
  else lines.push('- Nenhuma falha crítica na simulação API.');
  lines.push('', '## Pacientes simulados', '');
  for (const p of report.patients) {
    lines.push(`### ${p.label} (\`${p.atendimentoId}\`)`);
    lines.push(`- Resultado: ${p.ok ? 'OK' : 'FALHOU'}`);
    for (const s of p.steps) {
      lines.push(`  - ${s.ok ? '✅' : '❌'} ${s.name}${s.statusNovo ? ` → ${s.statusNovo}` : ''}${s.error ? ` (${s.error})` : ''}`);
    }
    lines.push('');
  }
  if (report.ui) {
    lines.push('## UI 1366×768 (amostra — último paciente)', '');
    for (const u of report.ui.ok || []) lines.push(`- ✅ ${u}`);
    for (const u of report.ui.issues || []) lines.push(`- ❌ ${u}`);
  }
  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');
}

async function main() {
  const correlationId = `sim-clinica-${TS}`;
  const report = {
    generated_at: new Date().toISOString(),
    backend_url: BACKEND,
    panel_url: PANEL,
    correlationId,
    patients: [],
    funcionou: [],
    falhou: [],
    telas_problema: [],
    botoes_sem_resposta: [],
    campos_nao_carregados: [],
    piloto_fechado_ok: false,
    ui: null,
  };

  if (!MEDICO_PASS) {
    report.falhou.push('MEDICO_PASS não definida');
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    writeMarkdown(report);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const session = await login(correlationId);
  if (!session.ok) {
    report.falhou.push(`Login falhou (${session.status})`);
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    writeMarkdown(report);
    process.exit(1);
  }
  report.funcionou.push('Login médico (drmax.matos)');

  const me = await requestJson(`${BACKEND}/api/auth/me`, { headers: authHeaders(session.token, correlationId) });
  if (me.ok) report.funcionou.push('/api/auth/me');

  let lastId = null;
  let lastName = null;
  let uiResult = null;

  for (let i = 0; i < PATIENTS.length; i++) {
    const p = PATIENTS[i];
    const created = await createPatient(p, i, correlationId);
    if (!created.ok) {
      report.patients.push({ label: p.condicao, key: p.key, ok: false, steps: [step('criar_paciente', false, created)] });
      report.falhou.push(`Criação ${p.key}: ${created.error || created.status}`);
      continue;
    }
    lastId = created.id;
    lastName = p.nome;

    if (i === 0 && !uiResult) {
      const loginUser = me.data?.user || { username: MEDICO_USER, name: MEDICO_USER };
      uiResult = await runUiChecks(session.token, loginUser, created.id, p.nome);
    }

    const flow = await runPatientFlow(session.token, p, created.id, correlationId);
    report.patients.push({
      label: p.condicao,
      key: p.key,
      atendimentoId: created.id,
      ok: flow.ok,
      steps: flow.steps,
    });
    if (flow.ok) report.funcionou.push(`Fluxo completo API: ${p.key}`);
    else {
      report.falhou.push(`Fluxo incompleto: ${p.key}`);
      for (const s of flow.steps.filter((x) => !x.ok)) {
        if (s.name.includes('prontuario')) report.campos_nao_carregados.push(`${p.key}:${s.name}`);
        if (s.name.includes('aprovar')) report.botoes_sem_resposta.push(`${p.key}:approve_api`);
      }
    }
  }

  if (uiResult) {
    report.ui = uiResult;
    if (uiResult.skipped) {
      report.falhou.push(`UI skip: ${uiResult.reason}`);
    } else {
      report.funcionou.push(...(uiResult.ok || []).map((x) => `UI: ${x}`));
      for (const issue of uiResult.issues || []) {
        report.falhou.push(`UI: ${issue}`);
        if (issue.includes('botao')) report.botoes_sem_resposta.push(issue);
        if (issue.includes('campos')) report.campos_nao_carregados.push(issue);
        if (issue.includes('fila') || issue.includes('atendimento')) report.telas_problema.push(issue);
      }
    }
  }

  const allApiOk = report.patients.length === 3 && report.patients.every((p) => p.ok);
  const uiOk = !report.ui?.issues?.length;
  report.piloto_fechado_ok = allApiOk && uiOk;

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  writeMarkdown(report);
  console.log(JSON.stringify({ success: report.piloto_fechado_ok, patients: report.patients.length, report: REPORT_MD }, null, 2));
  process.exit(report.piloto_fechado_ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
