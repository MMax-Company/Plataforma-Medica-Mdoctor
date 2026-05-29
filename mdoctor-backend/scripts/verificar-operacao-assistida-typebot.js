#!/usr/bin/env node
/**
 * Valida atendimento após passagem real no Typebot publicado.
 *
 * Env:
 *   ATENDIMENTO_ID — ID retornado pelo Typebot/n8n (preferencial)
 *   PACIENTE_NOME_CONTAINS — filtro parcial no nome (ex.: sobrenome do teste)
 *   BACKEND_URL
 *   MINUTES_AGO — buscar atendimentos recentes (default 120)
 */
const BACKEND = String(process.env.BACKEND_URL || 'https://web-production-5f178.up.railway.app').replace(
  /\/$/,
  ''
);
const ATENDIMENTO_ID = String(process.env.ATENDIMENTO_ID || '').trim();
const NAME_FILTER = String(process.env.PACIENTE_NOME_CONTAINS || '').trim().toLowerCase();
const MINUTES_AGO = Number(process.env.MINUTES_AGO || 120);

function pickRx(clinical = {}) {
  return (
    clinical.previous_prescription_file ||
    clinical.foto_receita_url ||
    clinical.previous_prescription_url ||
    clinical.prescription_photo_url ||
    clinical.normalized_payload?.previous_prescription_file ||
    clinical.clean_payload?.previous_prescription_file ||
    null
  );
}

function assertField(report, key, ok, detail) {
  report.checks[key] = { ok, detail };
  if (!ok) report.pending.push(`${key}: ${detail}`);
}

function analyze(atendimento) {
  const c = atendimento.dados_clinicos || {};
  const rx = pickRx(c);
  const report = {
    atendimento_id: atendimento.id,
    origem: atendimento.origem,
    status: atendimento.status,
    pagamento_status: atendimento.pagamento_status,
    elegibilidade: atendimento.elegibilidade,
    created_at: atendimento.created_at || atendimento.createdAt,
    paciente_nome: atendimento.paciente_nome,
    condicao: atendimento.condicao,
    previous_prescription_file: rx,
    prontuario: {
      doenca: atendimento.condicao || c.triagem_nested?.triagem?.doencas,
      medicacao: c.triagem_nested?.triagem?.medicacao_em_uso || c.medications?.[0]?.name,
      conduta: c.conduta_sugerida,
      orientacoes: c.orientacoes_clinicas,
      exame_fisico: c.exame_fisico_telemedicina
    },
    checks: {},
    pending: [],
    ok: true
  };

  assertField(report, 'origem_typebot_triagem', atendimento.origem === 'typebot-triagem', atendimento.origem);
  assertField(report, 'status_waiting', String(atendimento.status).toLowerCase() === 'waiting', atendimento.status);
  assertField(
    report,
    'pagamento_confirmado',
    String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO',
    atendimento.pagamento_status
  );
  assertField(report, 'elegivel', atendimento.elegibilidade?.eligible === true, JSON.stringify(atendimento.elegibilidade));
  assertField(
    report,
    'risco_baixo',
    String(atendimento.elegibilidade?.riskLevel || '').toUpperCase() === 'BAIXO',
    atendimento.elegibilidade?.riskLevel
  );
  assertField(report, 'prontuario_doenca', Boolean(report.prontuario.doenca), 'vazio');
  assertField(report, 'prontuario_medicacao', Boolean(report.prontuario.medicacao), 'vazio');
  assertField(report, 'prontuario_conduta', Boolean(report.prontuario.conduta), 'vazio');
  assertField(report, 'prontuario_orientacoes', Boolean(report.prontuario.orientacoes), 'vazio');
  assertField(report, 'prontuario_exame', Boolean(report.prontuario.exame_fisico), 'vazio');
  assertField(report, 'receita_anterior', Boolean(rx), 'sem URL/storage — atendimento pode não aparecer na fila médica');

  report.ok = report.pending.length === 0;
  return report;
}

async function findCandidate() {
  const res = await fetch(`${BACKEND}/api/atendimentos?scope=all`);
  if (!res.ok) throw new Error(`list atendimentos -> ${res.status}`);
  const data = await res.json();
  const list = data.atendimentos || [];
  const cutoff = Date.now() - MINUTES_AGO * 60 * 1000;

  const filtered = list
    .filter((a) => a.origem === 'typebot-triagem')
    .filter((a) => {
      const raw = a.created_at || a.createdAt || a.updated_at || a.updatedAt;
      if (!raw) return true;
      const t = new Date(raw).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    })
    .filter((a) => {
      if (!NAME_FILTER) return true;
      return String(a.paciente_nome || '').toLowerCase().includes(NAME_FILTER);
    })
    .sort((a, b) => {
      const ta = new Date(a.created_at || a.createdAt || a.updated_at || 0).getTime();
      const tb = new Date(b.created_at || b.createdAt || b.updated_at || 0).getTime();
      return tb - ta;
    });

  return filtered[0] || null;
}

async function inMedicalQueue(id) {
  const res = await fetch(`${BACKEND}/api/atendimentos?scope=medical`);
  if (!res.ok) return { ok: false, error: res.status };
  const data = await res.json();
  const list = data.atendimentos || [];
  return {
    ok: true,
    in_queue: list.some((a) => a.id === id),
    total: list.length
  };
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    backend_url: BACKEND,
    lookup: { ATENDIMENTO_ID, NAME_FILTER, MINUTES_AGO },
    atendimento: null,
    fila_medica: null,
    ok: false,
    pending: []
  };

  let atendimento;
  if (ATENDIMENTO_ID) {
    const res = await fetch(`${BACKEND}/api/atendimentos/${ATENDIMENTO_ID}`);
    if (!res.ok) {
      report.pending.push(`GET atendimento ${ATENDIMENTO_ID} -> ${res.status}`);
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }
    const data = await res.json();
    atendimento = data.atendimento || data;
  } else {
    atendimento = await findCandidate();
    if (!atendimento) {
      report.pending.push(
        'Nenhum atendimento typebot-triagem recente encontrado — informe ATENDIMENTO_ID após passagem no Typebot'
      );
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }
  }

  report.atendimento = analyze(atendimento);
  report.fila_medica = await inMedicalQueue(atendimento.id);
  if (!report.fila_medica.in_queue) {
    report.pending.push('Atendimento ausente em GET /api/atendimentos?scope=medical');
    if (!report.atendimento.previous_prescription_file) {
      report.pending.push('Provável causa: previous_prescription_file ausente ou pagamento/elegibilidade');
    }
  }

  report.ok = report.atendimento.ok && report.fila_medica.in_queue === true;
  report.pending = [...new Set([...report.pending, ...report.atendimento.pending])];

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
