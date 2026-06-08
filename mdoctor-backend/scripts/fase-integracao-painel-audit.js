#!/usr/bin/env node
/**
 * Fase integração painel — auditoria ecossistema, diagnóstico fila, testes operacionais.
 *   node scripts/fase-integracao-painel-audit.js
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const N8N = String(process.env.N8N_BASE_URL || 'https://n8n-staging-staging-2dfe.up.railway.app').replace(/\/$/, '');
const EVOLUTION = String(process.env.EVOLUTION_API_URL || 'https://evolution-api-staging-staging-40d1.up.railway.app').replace(/\/$/, '');
const TYPEBOT = 'https://typebot.co/doctor-prescreve-8rmljgu';
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const OUT_JSON = path.join(ROOT, 'docs/FASE-INTEGRACAO-PAINEL-RELATORIO.json');
const OUT_MD = path.join(ROOT, 'docs/FASE-INTEGRACAO-PAINEL-RELATORIO.md');

function toPanelStatus(status) {
  const s = String(status || 'waiting').trim().toLowerCase();
  if (['waiting', 'queue', 'fila', 'triaged', 'triagem', 'aguardando_pagamento'].includes(s)) return 'QUEUE';
  if (['em_atendimento', 'under_review', 'approved', 'pronto_para_decisao'].includes(s)) return 'EM_ATENDIMENTO';
  if (['receita_em_edicao', 'memed_processing'].includes(s)) return 'MEMED_PROCESSING';
  if (['receita_emitida', 'awaiting_validation'].includes(s)) return 'RECEITA_EMITIDA';
  if (['ready', 'validated', 'aprovado'].includes(s)) return 'VALIDATED';
  if (['rejected', 'recusado', 'inelegivel', 'cancelado'].includes(s)) return 'REJECTED';
  if (['delivered', 'finished', 'finalized'].includes(s)) return 'DELIVERED';
  return 'QUEUE';
}

function columnForPanelStatus(ps) {
  if (['QUEUE', 'FILA', 'TRIAGED'].includes(ps)) return 'FILA_DE_ESPERA';
  if (['EM_ATENDIMENTO', 'UNDER_REVIEW', 'MEMED_PROCESSING', 'AWAITING_VALIDATION'].includes(ps)) return 'EM_ATENDIMENTO';
  if (['VALIDATED', 'APROVADO', 'RECEITA_EMITIDA'].includes(ps)) return 'RECEITAS_PRONTAS';
  if (['REJECTED', 'RECUSADO', 'FINISHED', 'DELIVERED'].includes(ps)) return 'FINALIZADOS';
  return 'ORFAO';
}

function hasPhoto(clinical = {}) {
  return Boolean(
    clinical.foto_receita_url ||
      clinical.previous_prescription_file ||
      clinical.previous_prescription_url ||
      clinical.previous_prescription_storage_path
  );
}

function isSupport(item) {
  const c = item.dados_clinicos || {};
  return item.condicao === 'suporte_whatsapp' || c.queue_type === 'support' || c.whatsapp_support === true;
}

function visibilityReason(item) {
  const reasons = [];
  const st = String(item.status || '').toLowerCase();
  const paid = String(item.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
  const eligible = item.elegibilidade?.eligible === true;
  const clinical = item.dados_clinicos || {};
  if (isSupport(item)) reasons.push('suporte_whatsapp');
  if (st === 'awaiting_prescription_upload' || clinical.prescription_upload_pending) reasons.push('aguardando_foto_receita');
  if (!paid) reasons.push('pagamento_nao_confirmado');
  if (!eligible && item.risco !== 'BAIXO') reasons.push('inelegivel');
  if (!hasPhoto(clinical)) reasons.push('sem_foto_receita');
  if (['delivered', 'cancelado'].includes(st)) reasons.push('status_terminal');
  if (reasons.length === 0) reasons.push('visivel');
  return reasons;
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, data };
}

function verdict(ok, partial = false) {
  if (ok) return 'OK';
  if (partial) return 'PARCIAL';
  return 'FALHA';
}

async function probeIntegration(name, fn) {
  try {
    const result = await fn();
    return { name, ...result };
  } catch (err) {
    return { name, status: verdict(false), ok: false, error: err.message };
  }
}

async function main() {
  const report = {
    generated_at: new Date().toISOString(),
    environment: 'staging',
    targets: { BACKEND, PANEL, N8N, EVOLUTION, TYPEBOT },
    integracoes: {},
    fila: {},
    supabase: {},
    prontuario: {},
    approve_reject: {},
    pacientes_teste: [],
    testes_operacionais: [],
    problemas: [],
    recomendacoes: [],
  };

  // --- INTEGRAÇÕES ---
  const health = await request(`${BACKEND}/health`);
  report.integracoes['1_frontend_backend'] = {
    status: verdict(health.ok),
    detail: `Backend /health ${health.status}`,
    panel_probe: (await request(`${PANEL}/login`)).status,
  };

  const readyz = await request(`${BACKEND}/readyz`);
  const sb = readyz.data?.supabase || {};
  report.integracoes['2_backend_supabase'] = {
    status: verdict(readyz.ok && sb.connected === true, readyz.ok && sb.configured && !sb.connected),
    detail: sb,
    storage: readyz.data?.storage,
    persistence_mode: readyz.data?.persistence_mode,
  };
  report.supabase = {
    configured: sb.configured,
    connected: sb.connected,
    mode: sb.mode || readyz.data?.storage?.mode,
    buckets: readyz.data?.storage?.buckets,
  };

  let token = null;
  if (MEDICO_PASS) {
    const login = await request(`${BACKEND}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
    });
    token = login.data?.token;
    report.integracoes['1_frontend_backend'].login_ok = Boolean(token);
    report.integracoes['1_frontend_backend'].login_status = login.status;
  }

  const authH = token ? { Authorization: `Bearer ${token}` } : {};

  const queueRes = token
    ? await request(`${BACKEND}/api/atendimentos/queue`, { headers: authH })
    : { ok: false, status: 401, data: {} };
  report.integracoes['3_backend_fila'] = {
    status: verdict(queueRes.ok, false),
    http: queueRes.status,
    total: (queueRes.data?.atendimentos || []).length,
  };

  const sampleId = (queueRes.data?.atendimentos || [])[0]?.id;
  const prontRes =
    token && sampleId
      ? await request(`${BACKEND}/api/atendimentos/${sampleId}`, { headers: authH })
      : { ok: false, data: {} };
  report.integracoes['4_backend_prontuario'] = {
    status: verdict(prontRes.ok && prontRes.data?.atendimento?.id === sampleId, prontRes.ok),
    sample_id: sampleId || null,
    endpoint: 'GET /api/atendimentos/:id',
  };

  const approveProbeId = (queueRes.data?.atendimentos || []).find((a) =>
    ['waiting', 'queue', 'em_atendimento'].includes(String(a.status || '').toLowerCase())
  )?.id;
  const rejectReasons = token
    ? await request(`${BACKEND}/api/atendimentos/clinical/reject-reasons`, { headers: authH })
    : { ok: false };
  report.integracoes['5_backend_aprovacao'] = {
    status: verdict(rejectReasons.ok),
    reject_reasons: rejectReasons.ok,
    endpoints: ['POST /:id/clinical/approve', 'POST /:id/clinical/reject', 'PATCH /:id/clinical'],
  };

  const memed = readyz.data?.memed || {};
  const memedToken = token
    ? await request(`${BACKEND}/api/memed/token`, { headers: authH })
    : { ok: false, status: 0 };
  report.integracoes['6_backend_memed'] = {
    status: verdict(memed.configured === true && (memedToken.ok || memedToken.status === 200), memed.configured),
    runtime: memed,
    token_probe_status: memedToken.status,
  };

  const waStatus = token
    ? await request(`${BACKEND}/api/whatsapp/status`, { headers: authH })
    : { ok: false };
  report.integracoes['7_backend_whatsapp'] = {
    status: verdict(waStatus.ok || waStatus.status === 200, waStatus.status === 503),
    http: waStatus.status,
    provider: waStatus.data?.provider || waStatus.data?.configured,
  };

  const evoProbe = await request(`${EVOLUTION}/`);
  report.integracoes['8_backend_evolution'] = {
    status: verdict(evoProbe.ok || evoProbe.status === 401 || evoProbe.status === 404, evoProbe.status > 0),
    evolution_url: EVOLUTION,
    http: evoProbe.status,
    whatsapp_evo_configured: waStatus.data?.evolution?.configured ?? waStatus.data?.provider === 'evolution',
  };

  const n8nHealth = await request(`${N8N}/healthz`);
  const n8nWh = await request(`${N8N}/webhook/typebot-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ probe: true }),
  });
  report.integracoes['9_backend_n8n'] = {
    status: verdict(n8nHealth.ok, n8nHealth.status > 0),
    healthz: n8nHealth.status,
    typebot_webhook_post: n8nWh.status,
    note: 'Webhook POST vazio retorna 4xx esperado se secret ausente — indica rota ativa',
  };

  const typebotPub = await request(TYPEBOT);
  const triagemProbe = await request(`${BACKEND}/api/webhook/triagem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.N8N_WEBHOOK_SECRET || process.env.INGRESS_SERVICE_SECRET
        ? { 'X-MDoctor-Webhook-Secret': process.env.N8N_WEBHOOK_SECRET || process.env.INGRESS_SERVICE_SECRET }
        : {}),
    },
    body: JSON.stringify({ probe: 'audit-only', skip_persist: true }),
  });
  report.integracoes['10_backend_typebot'] = {
    status: verdict(typebotPub.ok, typebotPub.ok),
    typebot_public_http: typebotPub.status,
    backend_triagem_http: triagemProbe.status,
    ingress_secret_present: Boolean(process.env.N8N_WEBHOOK_SECRET || process.env.INGRESS_SERVICE_SECRET),
  };

  // --- DIAGNÓSTICO FILA ---
  const rows = queueRes.data?.atendimentos || [];
  const allRows = rows.map((item) => {
    const ps = toPanelStatus(item.status);
    const col = columnForPanelStatus(ps);
    return {
      id: item.id,
      nome: item.paciente_nome,
      status_backend: String(item.status || '').toLowerCase(),
      status_painel: ps,
      coluna_esperada: col,
      pagamento: item.pagamento_status,
      elegivel: item.elegibilidade?.eligible,
      risco: item.risco,
      suporte: isSupport(item),
      visibility: visibilityReason(item),
      homologacao: item.dados_clinicos?.homologacao_painel === true,
      criado_em: item.criado_em,
    };
  });

  const byColumn = {
    FILA_DE_ESPERA: allRows.filter((r) => r.coluna_esperada === 'FILA_DE_ESPERA'),
    EM_ATENDIMENTO: allRows.filter((r) => r.coluna_esperada === 'EM_ATENDIMENTO'),
    RECEITAS_PRONTAS: allRows.filter((r) => r.coluna_esperada === 'RECEITAS_PRONTAS'),
    FINALIZADOS: allRows.filter((r) => r.coluna_esperada === 'FINALIZADOS'),
    ORFAO: allRows.filter((r) => r.coluna_esperada === 'ORFAO'),
  };

  const filaVaziaComReview = byColumn.FILA_DE_ESPERA.length === 0 && byColumn.EM_ATENDIMENTO.length > 0;

  report.fila = {
    total_api_queue: rows.length,
    contagem_por_coluna: Object.fromEntries(Object.entries(byColumn).map(([k, v]) => [k, v.length])),
    fila_vazia_com_em_atendimento: filaVaziaComReview,
    registros: allRows,
    filtros_backend: [
      'pagamento_status === CONFIRMADO',
      'elegibilidade.eligible === true (ou risco BAIXO via isClinicallyEligible)',
      'isVisibleInMedicalPanel: pago + elegível + foto receita + não suporte + não awaiting_prescription_upload',
      'exclui delivered/cancelado; merge rejeitados pagos para exibição',
    ],
    filtros_frontend: [
      'Exclui suporte (condicao suporte_whatsapp / queue_type support)',
      'Coluna FILA: status QUEUE | FILA | TRIAGED',
      'Coluna EM ATENDIMENTO: EM_ATENDIMENTO | UNDER_REVIEW | MEMED_PROCESSING | AWAITING_VALIDATION',
      'Coluna RECEITAS PRONTAS: VALIDATED | APROVADO | RECEITA_EMITIDA',
      'Filtros UI opcionais: search, statusFilter, riskFilter, paymentFilter',
      'Polling 30s quando aba visível',
    ],
    status_alimentam_colunas: {
      FILA_DE_ESPERA: ['waiting', 'queue', 'fila', 'triaged'],
      EM_ATENDIMENTO: ['em_atendimento', 'under_review', 'approved', 'memed_processing', 'receita_em_edicao'],
      RECEITAS_PRONTAS: ['ready', 'validated', 'aprovado', 'receita_emitida', 'awaiting_validation'],
    },
    causas_fila_vazia: filaVaziaComReview
      ? [
          'Todos pacientes elegíveis já foram movidos para em_atendimento (botão ATENDER faz PATCH imediato)',
          'Nenhum novo ingresso Typebot/n8n com pagamento+foto+elegibilidade',
          'Pacientes sem foto_receita não aparecem em nenhuma coluna médica',
        ]
      : [],
    orfaos: byColumn.ORFAO,
  };

  if (filaVaziaComReview) {
    report.problemas.push('FILA DE ESPERA vazia com pacientes em EM ATENDIMENTO — comportamento esperado se todos waiting já foram atendidos.');
  }
  if (byColumn.ORFAO.length) {
    report.problemas.push(`${byColumn.ORFAO.length} registro(s) com status mapeado para coluna ORFAO (não exibido no painel).`);
  }

  // --- CRIAR PACIENTES TESTE 11-15 ---
  if (MEDICO_PASS) {
    const seed = spawnSync(process.execPath, [path.join(__dirname, 'homologacao-5-pacientes-fila-11-15.js')], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: process.env,
    });
    const seedReportPath = path.join(ROOT, 'docs/HOMOLOGACAO-5-PACIENTES-FILA-11-15-RELATORIO.json');
    if (fs.existsSync(seedReportPath)) {
      const seedReport = JSON.parse(fs.readFileSync(seedReportPath, 'utf8'));
      report.pacientes_teste = seedReport.patients || [];
    }
    if (seed.status !== 0) {
      report.problemas.push(`Seed TESTE 11-15 exit=${seed.status}: ${(seed.stderr || seed.stdout || '').slice(0, 300)}`);
    }

    // Refresh queue after seed
    const queue2 = await request(`${BACKEND}/api/atendimentos/queue`, { headers: authH });
    const testeRows = (queue2.data?.atendimentos || []).filter((a) =>
      /PACIENTE TESTE 1[1-5]/i.test(a.paciente_nome || '')
    );
    report.fila.teste_11_15_na_fila = testeRows.map((a) => ({
      id: a.id,
      nome: a.paciente_nome,
      status: a.status,
      coluna: columnForPanelStatus(toPanelStatus(a.status)),
    }));

    // --- TESTES OPERACIONAIS ---
    const testPatient =
      testeRows.find((a) => ['waiting', 'queue'].includes(String(a.status || '').toLowerCase())) || testeRows[0];
    const testReject =
      testeRows.find((a) => a.id !== testPatient?.id && ['waiting', 'queue'].includes(String(a.status || '').toLowerCase())) ||
      testeRows[1];

    async function runTest(step, fn) {
      const r = await fn();
      report.testes_operacionais.push({ step, ...r });
      return r;
    }

    if (testPatient?.id) {
      const id = testPatient.id;

      await runTest('1_ATENDER', async () => {
        const before = await request(`${BACKEND}/api/atendimentos/${id}`, { headers: authH });
        const patch = await request(`${BACKEND}/api/atendimentos/${id}/status`, {
          method: 'PATCH',
          headers: { ...authH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'EM_ATENDIMENTO', notes: 'Teste operacional ATENDER' }),
        });
        const after = await request(`${BACKEND}/api/atendimentos/${id}`, { headers: authH });
        const st = String(after.data?.atendimento?.status || '').toLowerCase();
        return {
          ok: patch.ok && ['em_atendimento', 'under_review'].includes(st),
          before_status: before.data?.atendimento?.status,
          after_status: after.data?.atendimento?.status,
          http: patch.status,
        };
      });

      await runTest('2_abrir_modal_prontuario', async () => {
        const detail = await request(`${BACKEND}/api/atendimentos/${id}`, { headers: authH });
        const at = detail.data?.atendimento;
        return {
          ok: detail.ok && Boolean(at?.dados_clinicos?.queixa_principal || at?.dados_clinicos?.historico_clinico),
          id: at?.id,
          nome: at?.paciente_nome,
        };
      });

      const editMarker = `Edição teste operacional ${Date.now()}`;
      await runTest('3_editar_prontuario', async () => {
        const patch = await request(`${BACKEND}/api/atendimentos/${id}/clinical`, {
          method: 'PATCH',
          headers: { ...authH, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dados_clinicos: { historico_clinico: editMarker },
          }),
        });
        const verify = await request(`${BACKEND}/api/atendimentos/${id}`, { headers: authH });
        const saved = verify.data?.atendimento?.dados_clinicos?.historico_clinico;
        return { ok: patch.ok && saved === editMarker, http: patch.status, persisted: saved === editMarker };
      });
      report.prontuario = { edit_test_ok: report.testes_operacionais.find((t) => t.step === '3_editar_prontuario')?.ok };

      await runTest('4_aprovar', async () => {
        const approve = await request(`${BACKEND}/api/atendimentos/${id}/clinical/approve`, {
          method: 'POST',
          headers: { ...authH, 'Content-Type': 'application/json' },
          body: JSON.stringify({ motivo: 'Teste operacional approve TESTE 11-15' }),
        });
        const after = await request(`${BACKEND}/api/atendimentos/${id}`, { headers: authH });
        const st = String(after.data?.atendimento?.status || '').toLowerCase();
        return {
          ok: approve.ok || approve.status === 409,
          http: approve.status,
          after_status: st,
          memed: approve.data?.memed ? 'present' : 'absent',
          error: approve.data?.error,
        };
      });
      report.approve_reject = {
        approve: report.testes_operacionais.find((t) => t.step === '4_aprovar'),
      };

      if (testReject?.id) {
        await runTest('5_reprovar', async () => {
          await request(`${BACKEND}/api/atendimentos/${testReject.id}/status`, {
            method: 'PATCH',
            headers: { ...authH, 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'EM_ATENDIMENTO', notes: 'Prep reject test' }),
          });
          const reject = await request(`${BACKEND}/api/atendimentos/${testReject.id}/clinical/reject`, {
            method: 'POST',
            headers: { ...authH, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reason_code: 'clinical_ineligible',
              motivo: 'Teste operacional reject TESTE 11-15',
            }),
          });
          const after = await request(`${BACKEND}/api/atendimentos/${testReject.id}`, { headers: authH });
          const st = String(after.data?.atendimento?.status || '').toLowerCase();
          return {
            ok: reject.ok && (st === 'rejected' || st === 'recusado'),
            http: reject.status,
            after_status: st,
            error: reject.data?.error,
          };
        });
        report.approve_reject.reject = report.testes_operacionais.find((t) => t.step === '5_reprovar');
      }

      await runTest('6_atualizacao_fila', async () => {
        const q = await request(`${BACKEND}/api/atendimentos/queue`, { headers: authH });
        const testes = (q.data?.atendimentos || []).filter((a) => /PACIENTE TESTE 1[1-5]/i.test(a.paciente_nome || ''));
        return {
          ok: q.ok,
          total_queue: q.data?.atendimentos?.length,
          testes_visiveis: testes.length,
          testes_por_status: testes.map((a) => ({ nome: a.paciente_nome, status: a.status })),
        };
      });

      await runTest('7_mudanca_status', async () => {
        const q = await request(`${BACKEND}/api/atendimentos/queue`, { headers: authH });
        const moved = (q.data?.atendimentos || []).find((a) => a.id === id);
        const ps = moved ? toPanelStatus(moved.status) : null;
        return {
          ok: Boolean(moved),
          patient_id: id,
          status_backend: moved?.status,
          status_painel: ps,
          coluna: ps ? columnForPanelStatus(ps) : null,
        };
      });

      await runTest('8_persistencia_banco', async () => {
        const d1 = await request(`${BACKEND}/api/atendimentos/${id}`, { headers: authH });
        await new Promise((r) => setTimeout(r, 500));
        const d2 = await request(`${BACKEND}/api/atendimentos/${id}`, { headers: authH });
        const a1 = d1.data?.atendimento;
        const a2 = d2.data?.atendimento;
        return {
          ok: a1?.id === a2?.id && a1?.paciente_nome === a2?.paciente_nome,
          historico_persistido: a2?.dados_clinicos?.historico_clinico === editMarker,
          status_persistido: a2?.status,
        };
      });
    } else {
      report.problemas.push('Nenhum paciente TESTE 11-15 disponível para testes operacionais.');
    }
  } else {
    report.problemas.push('MEDICO_PASS ausente — seed e testes operacionais não executados.');
  }

  // Recomendações
  report.recomendacoes = [
    'Manter pacientes homologação identificados via homologacao_painel=true e prefixo PACIENTE TESTE.',
    'Após ATENDER, paciente sai da FILA DE ESPERA imediatamente — repor fila com novos ingressos ou reset de status em staging.',
    'Garantir foto_receita_url em todo ingresso Typebot/n8n para passar isVisibleInMedicalPanel.',
    'Monitorar registros ORFAO (status approved vs colunas do painel).',
    'Executar teste humano no painel staging: /fila sem visualSim para validar modal + botões.',
    'Limpar pacientes TESTE 11-15 após homologação para não poluir fila operacional.',
  ];

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const intRows = Object.entries(report.integracoes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `| ${k.replace(/^\d+_/, '')} | **${v.status}** | ${JSON.stringify(v.detail || v).slice(0, 120)} |`);

  const testRows = report.testes_operacionais.map(
    (t) => `| ${t.step} | ${t.ok ? '✅ OK' : '❌ FALHA'} | ${JSON.stringify(t).slice(0, 100)} |`
  );

  const md = [
    '# Fase Integração Painel — Relatório Completo',
    '',
    `**Gerado:** ${report.generated_at}`,
    `**Ambiente:** STAGING/HOMOLOGAÇÃO`,
    '',
    '## 1. Estado das integrações',
    '',
    '| Integração | Veredito | Detalhe |',
    '| --- | --- | --- |',
    ...intRows,
    '',
    '## 2. Estado da fila',
    '',
    `- Total API /queue: **${report.fila.total_api_queue}**`,
    `- FILA DE ESPERA: **${report.fila.contagem_por_coluna?.FILA_DE_ESPERA ?? 0}**`,
    `- EM ATENDIMENTO: **${report.fila.contagem_por_coluna?.EM_ATENDIMENTO ?? 0}**`,
    `- RECEITAS PRONTAS: **${report.fila.contagem_por_coluna?.RECEITAS_PRONTAS ?? 0}**`,
    `- Fila vazia + EM ATENDIMENTO cheio: **${report.fila.fila_vazia_com_em_atendimento ? 'SIM' : 'NÃO'}**`,
    '',
    '### Filtros backend',
    ...(report.fila.filtros_backend || []).map((f) => `- ${f}`),
    '',
    '## 3. Estado Supabase',
    '',
    `- Configurado: ${report.supabase.configured}`,
    `- Conectado: ${report.supabase.connected}`,
    `- Modo: ${report.supabase.mode}`,
    '',
    '## 4. Pacientes TESTE 11–15',
    '',
    '| # | Nome | ID | Status | Na fila |',
    '| --- | --- | --- | --- | --- |',
    ...(report.pacientes_teste || []).map(
      (p) =>
        `| ${p.num} | ${p.nome} | \`${p.atendimentoId || '—'}\` | ${p.status || '—'} | ${p.checks?.na_fila ? 'sim' : 'não'} |`
    ),
    '',
    '## 5. Testes operacionais',
    '',
    '| Teste | Resultado | Evidência |',
    '| --- | --- | --- |',
    ...testRows,
    '',
    '## 6. Problemas encontrados',
    '',
    ...(report.problemas.length ? report.problemas.map((p) => `- ${p}`) : ['- Nenhum bloqueador crítico registrado nesta execução.']),
    '',
    '## 7. Recomendações',
    '',
    ...report.recomendacoes.map((r) => `- ${r}`),
    '',
    `JSON completo: \`docs/FASE-INTEGRACAO-PAINEL-RELATORIO.json\``,
  ].join('\n');

  fs.writeFileSync(OUT_MD, md, 'utf8');
  console.log(JSON.stringify({ success: true, report: OUT_MD, integracoes: report.integracoes, fila: report.fila.contagem_por_coluna }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
