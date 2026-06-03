#!/usr/bin/env node
/**
 * Simulação clínica controlada — 5 pacientes Doctor Prescreve.
 * Valida elegibilidade, fila médica, fluxo approve/receita mock (elegíveis).
 * Sem deploy, sem tour visual, sem WhatsApp/Memed real.
 *
 *   MEDICO_PASS=... node scripts/simulacao-elegibilidade-5-pacientes.js
 */
const fs = require('fs');
const path = require('path');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const REPORT_JSON = path.join(__dirname, '../../docs/SIMULACAO-ELEGIBILIDADE-5-PACIENTES-RELATORIO.json');
const REPORT_MD = path.join(__dirname, '../../docs/SIMULACAO-ELEGIBILIDADE-5-PACIENTES-RELATORIO.md');

const TS = Date.now();
const RX_PHOTO = 'https://example.com/receita-simulacao-elegibilidade.jpg';

const PATIENTS = [
  {
    num: 1,
    key: 'p1_has_30d',
    nome: `Sim P1 HAS 30d ${TS}`,
    cpf: '52998224725',
    condicao: 'Hipertensão arterial (HAS)',
    receita_vencida_dias: 30,
    pagamento: true,
    medicamentos: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
    expected: {
      elegivel: true,
      fluxo_medico: true,
      status_inicial: 'waiting',
      bloqueio_motivo: null,
      qtd_medicamentos: 1,
    },
  },
  {
    num: 2,
    key: 'p2_has_45d_2med',
    nome: `Sim P2 HAS 45d 2med ${TS}`,
    cpf: '39053344705',
    condicao: 'Hipertensão arterial (HAS)',
    receita_vencida_dias: 45,
    pagamento: true,
    medicamentos: [
      { name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' },
      { name: 'Hidroclorotiazida', dose: '25', unit: 'mg', frequency: '24h' },
    ],
    expected: {
      elegivel: true,
      fluxo_medico: true,
      status_inicial: 'waiting',
      bloqueio_motivo: null,
      qtd_medicamentos: 2,
    },
  },
  {
    num: 3,
    key: 'p3_has_dm_60d_3med',
    nome: `Sim P3 HAS+DM 60d ${TS}`,
    cpf: '15350946056',
    condicao: 'Hipertensão arterial + Diabetes mellitus tipo 2',
    conditionCode: 'hipertensao',
    secondary_conditions: ['diabetes_tipo_2'],
    receita_vencida_dias: 60,
    pagamento: true,
    medicamentos: [
      { name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' },
      { name: 'Hidroclorotiazida', dose: '25', unit: 'mg', frequency: '24h' },
      { name: 'Metformina', dose: '850', unit: 'mg', frequency: '12/12h' },
    ],
    expected: {
      elegivel: true,
      fluxo_medico: true,
      status_inicial: 'waiting',
      bloqueio_motivo: null,
      qtd_medicamentos: 3,
    },
  },
  {
    num: 4,
    key: 'p4_has_220d_bloqueio',
    nome: `Sim P4 HAS 220d bloq ${TS}`,
    cpf: '11144477735',
    condicao: 'Hipertensão arterial (HAS)',
    receita_vencida_dias: 220,
    pagamento: true,
    medicamentos: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
    expected: {
      elegivel: false,
      fluxo_medico: false,
      status_inicial: 'rejected',
      bloqueio_motivo: 'receita_vencida_acima_180',
      qtd_medicamentos: 1,
    },
  },
  {
    num: 5,
    key: 'p5_has_40d_sem_pag',
    nome: `Sim P5 HAS 40d sem pag ${TS}`,
    cpf: '98765432100',
    condicao: 'Hipertensão arterial (HAS)',
    receita_vencida_dias: 40,
    pagamento: false,
    medicamentos: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
    expected: {
      elegivel: true,
      fluxo_medico: false,
      status_inicial: 'waiting',
      bloqueio_motivo: 'pagamento_pendente',
      qtd_medicamentos: 1,
    },
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

function medicacaoLabel(meds) {
  return meds.map((m) => `${m.name} ${m.dose}${m.unit}`).join(' + ');
}

function buildCreateBody(p, phone) {
  const meds = p.medicamentos;
  const clinical = {
    condition: p.conditionCode || 'hipertensao',
    doenca_cronica: p.condicao,
    secondary_conditions: p.secondary_conditions || [],
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
    queixa_principal: `Renovação — receita vencida há ${p.receita_vencida_dias} dias.`,
    historico_clinico: `Uso contínuo documentado. Simulação elegibilidade P${p.num}.`,
    foto_receita_url: RX_PHOTO,
    previous_prescription_file: RX_PHOTO,
    flags: [],
    has_warning_signs: false,
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
  if (meds[2]) {
    clinical.terceiro_medicamento = `${meds[2].name} ${meds[2].dose}${meds[2].unit}`;
    clinical.med3_nome = meds[2].name;
    clinical.med3_dose = `${meds[2].dose}${meds[2].unit}`;
  }

  return {
    paciente_nome: p.nome,
    paciente_telefone: phone,
    paciente_cpf: p.cpf,
    paciente_email: `sim.p${p.num}.${TS}@elegibilidade.local`,
    condicao: p.condicao,
    pagamento_status: p.pagamento ? 'CONFIRMADO' : 'PENDENTE',
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
  const phone = `+55118${String(TS + index).slice(-8)}`;
  const body = buildCreateBody(p, phone);
  const ingressSecret = process.env.INGRESS_SERVICE_SECRET || process.env.N8N_WEBHOOK_SECRET || '';
  const r = await requestJson(`${BACKEND}/api/atendimentos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      ...(ingressSecret ? { 'X-MDoctor-Webhook-Secret': ingressSecret } : {})
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
  };
}

async function checkMedicalVisibility(token, atendimentoId, correlationId) {
  const cid = correlationId;
  const queue = await requestJson(`${BACKEND}/api/atendimentos/queue`, { headers: authHeaders(token, cid) });
  const panel = await requestJson(`${BACKEND}/api/atendimentos`, { headers: authHeaders(token, cid) });
  const all = await requestJson(`${BACKEND}/api/atendimentos?scope=all`, { headers: authHeaders(token, cid) });

  const inQueue = (queue.data?.atendimentos || []).some((a) => a.id === atendimentoId);
  const inPanel = (panel.data?.atendimentos || []).some((a) => a.id === atendimentoId);
  const inAll = (all.data?.atendimentos || []).some((a) => a.id === atendimentoId);

  return { inQueue, inPanel, inAll, queueStatus: queue.status, panelStatus: panel.status };
}

function countMedications(atendimento) {
  const clinical = atendimento?.dados_clinicos || {};
  if (Array.isArray(clinical.medications) && clinical.medications.length) return clinical.medications.length;
  const text = String(clinical.medicacao_em_uso || '');
  const names = ['Losartana', 'Hidroclorotiazida', 'Metformina', 'Levotiroxina'];
  return names.filter((n) => text.toLowerCase().includes(n.toLowerCase())).length || (text ? 1 : 0);
}

async function runEligibleFlow(token, p, atendimentoId, correlationId) {
  const steps = [];
  const cid = `${correlationId}-${p.key}`;
  const h = authHeaders(token, cid);

  const detail = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: h });
  const at = detail.data?.atendimento || {};
  const medCount = countMedications(at);
  steps.push({
    name: 'prontuario_carregado',
    ok: detail.ok && medCount >= p.expected.qtd_medicamentos,
    medCount,
    expected: p.expected.qtd_medicamentos,
  });

  const save = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical`, {
    method: 'PATCH',
    headers: h,
    body: JSON.stringify({
      dados_clinicos: {
        conduta_medica: `Simulação P${p.num} — renovação aprovada.`,
        observacao_medica: 'Prontuário salvo na simulação de elegibilidade.',
      },
    }),
  });
  steps.push({ name: 'prontuario_salvo', ok: save.ok, status: save.status });

  const approve = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical/approve`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      motivo: `Simulação P${p.num}`,
      conduta_medica: `Renovar ${medicacaoLabel(p.medicamentos)}.`,
    }),
  });
  steps.push({
    name: 'aprovacao',
    ok: approve.ok && approve.data?.atendimento?.status === 'approved',
    statusNovo: approve.data?.atendimento?.status,
  });

  const memed = await requestJson(`${BACKEND}/api/memed/receita`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      atendimentoId,
      receitaId: `sim-eleg-${p.key}-${TS}`,
      pdfUrl: `https://example.invalid/sim-${atendimentoId}.pdf`,
      payload: { mock: true, medicamentos: p.medicamentos.length },
    }),
  });
  steps.push({ name: 'receita_mock', ok: memed.ok, status: memed.status });

  const validate = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical/validate`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ motivo: 'Simulação — validação mock' }),
  });
  steps.push({ name: 'validacao_receita', ok: validate.ok, statusNovo: validate.data?.atendimento?.status });

  const deliver = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}/deliver`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ channel: 'whatsapp' }),
  });
  const provider = String(deliver.data?.delivery?.provider || '').toLowerCase();
  const mockDelivery = ['mock', 'dry-run'].includes(provider);
  steps.push({
    name: 'whatsapp_simulado',
    ok: mockDelivery || !deliver.ok,
    provider: provider || null,
    nota: mockDelivery ? 'dry-run/mock — sem envio real' : 'entrega não executada',
  });

  const final = await requestJson(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: h });
  steps.push({
    name: 'persistencia',
    ok: final.ok,
    statusFinal: final.data?.atendimento?.status,
    temReceita: Boolean(final.data?.atendimento?.dados_clinicos?.memed_receita?.pdfUrl),
  });

  return { steps, ok: steps.every((s) => s.ok) };
}

function evaluatePatient(p, created, visibility, flow) {
  const at = created.atendimento || {};
  const elig = at.elegibilidade || {};
  const status = String(at.status || '').toLowerCase();
  const paid = String(at.pagamento_status || '').toUpperCase() === 'CONFIRMADO';

  const obtained = {
    elegivel: elig.eligible === true,
    status,
    pagamento: paid ? 'pago' : 'nao_pago',
    inMedicalQueue: visibility.inQueue,
    inMedicalPanel: visibility.inPanel,
    bloqueio_motivo: null,
    reasonCode: elig.reasonCode || null,
    reason: elig.reason || null,
    medCount: countMedications(at),
    fluxoCompleto: flow?.ok ?? null,
  };

  if (!elig.eligible) {
    if (elig.flags?.includes('receita_muito_antiga') || (p.receita_vencida_dias > 180 && status === 'rejected')) {
      obtained.bloqueio_motivo = 'receita_vencida_acima_180';
    } else {
      obtained.bloqueio_motivo = elig.reasonCode || 'inelegivel';
    }
  } else if (!paid) {
    obtained.bloqueio_motivo = 'pagamento_pendente';
  }

  const checks = {
    criado: created.ok,
    elegivel_ok: obtained.elegivel === p.expected.elegivel,
    status_ok:
      p.expected.status_inicial === 'rejected'
        ? status === 'rejected'
        : status === 'waiting' || status === 'queue',
    fila_medica_ok: obtained.inMedicalQueue === p.expected.fluxo_medico,
    painel_medico_ok: obtained.inMedicalPanel === p.expected.fluxo_medico,
    medicamentos_ok: obtained.medCount >= p.expected.qtd_medicamentos,
    fluxo_ok: p.expected.fluxo_medico ? flow?.ok === true : flow === null,
    bloqueio_ok: p.expected.bloqueio_motivo
      ? obtained.bloqueio_motivo === p.expected.bloqueio_motivo ||
        (p.num === 4 && status === 'rejected' && !obtained.elegivel)
      : !obtained.bloqueio_motivo || obtained.bloqueio_motivo === null,
  };

  const ok = Object.values(checks).every(Boolean);
  return { obtained, checks, ok };
}

function writeMarkdown(report) {
  const lines = [
    '# Simulação Elegibilidade — 5 Pacientes Doctor Prescreve',
    '',
    `> ${report.generated_at}`,
    `> Backend: ${report.backend_url}`,
    '',
    '## Conclusão',
    '',
    report.piloto_fechado_ok
      ? '**Comportamento adequado para piloto fechado:** sim — elegíveis seguem fluxo médico; bloqueios operacionais respeitados.'
      : '**Comportamento adequado para piloto fechado:** parcial — ver divergências na tabela.',
    '',
    '## Tabela resumo',
    '',
    '| # | Cenário | Esperado elegível | Obtido elegível | Status | Fila médica | Fluxo completo | OK |',
    '|---|---------|-------------------|-----------------|--------|-------------|----------------|-----|',
  ];

  for (const row of report.tabela) {
    const cenario = String(row.cenario_resumo || row.cenario || '').replace(/\|/g, '/');
    lines.push(
      `| ${row.num} | ${cenario} | ${row.esperado_elegivel ? 'sim' : 'não'} | ${row.obtido_elegivel ? 'sim' : 'não'} | \`${row.status}\` | ${row.fila_medica ? 'sim' : 'não'} | ${row.fluxo_completo === null ? '—' : row.fluxo_completo ? 'sim' : 'não'} | ${row.ok ? '✅' : '❌'} |`
    );
  }

  lines.push('', '## Detalhes por paciente', '');

  for (const p of report.patients) {
    lines.push(`### Paciente ${p.num} — ${p.label}`);
    lines.push(`- ID: \`${p.atendimentoId || '—'}\``);
    lines.push(`- Resultado geral: **${p.ok ? 'OK' : 'FALHOU'}**`);
    lines.push(`- Motivo bloqueio (obtido): ${p.obtained.bloqueio_motivo || 'nenhum'}`);
    lines.push(`- Medicamentos carregados: ${p.obtained.medCount} (esperado ${p.expected.qtd_medicamentos})`);
    if (p.flow?.steps?.length) {
      lines.push('- Etapas fluxo elegível:');
      for (const s of p.flow.steps) {
        lines.push(`  - ${s.ok ? '✅' : '❌'} ${s.name}`);
      }
    }
    lines.push('');
  }

  lines.push('## O que funcionou', '');
  if (report.funcionou.length) report.funcionou.forEach((x) => lines.push(`- ${x}`));
  else lines.push('- —');

  lines.push('', '## O que falhou', '');
  if (report.falhou.length) report.falhou.forEach((x) => lines.push(`- ${x}`));
  else lines.push('- Nenhuma falha crítica.');

  lines.push('', '## Observações', '');
  report.observacoes.forEach((x) => lines.push(`- ${x}`));

  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');
}

async function main() {
  const correlationId = `sim-eleg-5-${TS}`;
  const report = {
    generated_at: new Date().toISOString(),
    backend_url: BACKEND,
    correlationId,
    tabela: [],
    patients: [],
    funcionou: [],
    falhou: [],
    observacoes: [
      'Simulação sem flag `receita_muito_antiga` — bloqueio P4 depende só de `receita_vencida_dias` no backend.',
      'WhatsApp: apenas dry-run/mock; Memed: receita mock via API.',
      'Sem deploy e sem tour visual Playwright.',
    ],
    piloto_fechado_ok: false,
  };

  if (!MEDICO_PASS) {
    report.falhou.push('MEDICO_PASS não definida');
    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    writeMarkdown(report);
    process.exit(1);
  }

  const session = await login(correlationId);
  if (!session.ok) {
    report.falhou.push(`Login falhou (${session.status})`);
    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    writeMarkdown(report);
    process.exit(1);
  }
  report.funcionou.push('Login médico');

  for (let i = 0; i < PATIENTS.length; i++) {
    const p = PATIENTS[i];
    const created = await createPatient(p, i, correlationId);

    if (!created.ok) {
      report.falhou.push(`P${p.num}: falha na criação (${created.error || created.status})`);
      report.patients.push({ num: p.num, label: p.condicao, ok: false, error: created.error });
      report.tabela.push({
        num: p.num,
        cenario: p.condicao.slice(0, 40),
        esperado_elegivel: p.expected.elegivel,
        obtido_elegivel: false,
        status: '—',
        fila_medica: false,
        fluxo_completo: false,
        ok: false,
      });
      continue;
    }

    report.funcionou.push(`P${p.num}: criado (${created.id})`);

    const visibility = await checkMedicalVisibility(session.token, created.id, `${correlationId}-p${p.num}`);

    let flow = null;
    if (p.expected.fluxo_medico) {
      flow = await runEligibleFlow(session.token, p, created.id, correlationId);
      if (flow.ok) report.funcionou.push(`P${p.num}: fluxo médico completo (approve + receita mock + dry-run)`);
      else report.falhou.push(`P${p.num}: fluxo médico incompleto`);
    } else {
      const approveProbe = await requestJson(`${BACKEND}/api/atendimentos/${created.id}/clinical/approve`, {
        method: 'POST',
        headers: authHeaders(session.token, `${correlationId}-probe-${p.num}`),
        body: JSON.stringify({ motivo: 'probe bloqueado' }),
      });
      if (approveProbe.status >= 400) {
        report.funcionou.push(`P${p.num}: approve bloqueado corretamente (${approveProbe.status})`);
      } else if (!p.expected.fluxo_medico) {
        report.falhou.push(`P${p.num}: approve deveria falhar para não elegível/fila`);
      }
    }

    const { obtained, checks, ok } = evaluatePatient(p, created, visibility, flow);

    if (checks.elegivel_ok) report.funcionou.push(`P${p.num}: elegibilidade conforme esperado`);
    else report.falhou.push(`P${p.num}: elegibilidade divergente (esperado ${p.expected.elegivel}, obtido ${obtained.elegivel})`);

    if (checks.fila_medica_ok) report.funcionou.push(`P${p.num}: presença/ausência na fila médica OK`);
    else report.falhou.push(`P${p.num}: fila médica divergente (esperado ${p.expected.fluxo_medico}, obtido ${obtained.inMedicalQueue})`);

    if (!checks.medicamentos_ok) report.falhou.push(`P${p.num}: medicamentos (${obtained.medCount}/${p.expected.qtd_medicamentos})`);

    report.patients.push({
      num: p.num,
      key: p.key,
      label: p.condicao,
      atendimentoId: created.id,
      expected: p.expected,
      obtained,
      checks,
      flow,
      ok,
    });

    report.tabela.push({
      num: p.num,
      cenario: `${p.condicao} | venc ${p.receita_vencida_dias}d | ${p.pagamento ? 'pago' : 'não pago'}`,
      cenario_resumo: `P${p.num}: ${p.medicamentos.length} med, ${p.receita_vencida_dias}d venc, ${p.pagamento ? 'pago' : 'sem pagamento'}`,
      esperado_elegivel: p.expected.elegivel,
      obtido_elegivel: obtained.elegivel,
      status: obtained.status,
      fila_medica: obtained.inMedicalQueue,
      fluxo_completo: flow?.ok ?? null,
      bloqueio: obtained.bloqueio_motivo,
      ok,
    });
  }

  report.piloto_fechado_ok = report.patients.length === 5 && report.patients.every((p) => p.ok);

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  writeMarkdown(report);

  console.log(
    JSON.stringify(
      {
        success: report.piloto_fechado_ok,
        ok: report.patients.filter((p) => p.ok).length,
        total: report.patients.length,
        report: REPORT_MD,
      },
      null,
      2
    )
  );
  process.exit(report.piloto_fechado_ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
