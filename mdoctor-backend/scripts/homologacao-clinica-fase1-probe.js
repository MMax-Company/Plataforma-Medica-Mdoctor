#!/usr/bin/env node
/**
 * Fase 1 — probe read-only da fila médica e prontuário (homologação clínica).
 *
 * Env:
 *   BACKEND_URL
 *   SAMPLE_SIZE (default 5)
 *   ATENDIMENTO_ID (opcional — analisa um ID específico)
 */
const BACKEND = String(
  process.env.BACKEND_URL || 'https://web-production-5f178.up.railway.app'
).replace(/\/$/, '');
const SAMPLE = Math.max(1, Number(process.env.SAMPLE_SIZE || 5));
const TARGET_ID = String(process.env.ATENDIMENTO_ID || '').trim();

const REPORT_PATH = require('path').join(
  __dirname,
  '../../docs/HOMOLOGACAO-CLINICA-FASE1-RELATORIO.json'
);

const PRONTUARIO_FIELDS = [
  'queixa_principal',
  'historico_clinico',
  'exame_fisico_telemedicina',
  'conduta_sugerida',
  'orientacoes_clinicas',
  'clinical_summary'
];

function pickRx(clinical = {}) {
  return (
    clinical.previous_prescription_file ||
    clinical.foto_receita_url ||
    clinical.previous_prescription_url ||
    clinical.prescription_photo_url ||
    null
  );
}

function analyzeAtendimento(a) {
  const c = a.dados_clinicos || {};
  const prontuario = {};
  const missingProntuario = [];
  for (const field of PRONTUARIO_FIELDS) {
    const ok = Boolean(c[field] && String(c[field]).trim().length > 3);
    prontuario[field] = ok;
    if (!ok) missingProntuario.push(field);
  }

  const checks = {
    origem_typebot: a.origem === 'typebot-triagem',
    status_valid: ['waiting', 'em_atendimento', 'memed_processing', 'ready', 'validated'].includes(
      String(a.status || '').toLowerCase()
    ),
    pagamento_confirmado: String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO',
    elegivel: a.elegibilidade?.eligible === true,
    risco_definido: Boolean(a.elegibilidade?.riskLevel),
    receita_url: Boolean(pickRx(c)),
    triagem_nested: Boolean(c.triagem_nested?.paciente && c.triagem_nested?.triagem),
    typebot_vars: Boolean(c.typebot_variables || c.clean_payload),
    prontuario_completo: missingProntuario.length === 0
  };

  return {
    id: a.id,
    paciente_nome: a.paciente_nome,
    status: a.status,
    origem: a.origem,
    pagamento_status: a.pagamento_status,
    condicao: a.condicao,
    elegibilidade: {
      eligible: a.elegibilidade?.eligible,
      riskLevel: a.elegibilidade?.riskLevel,
      reasonCode: a.elegibilidade?.reasonCode
    },
    created_at: a.created_at || a.createdAt,
    checks,
    missing_prontuario_fields: missingProntuario,
    previous_prescription_file: pickRx(c)
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

async function main() {
  const report = {
    timestamp: new Date().toISOString(),
    fase: 'homologacao_clinica_fase1_painel',
    backend_url: BACKEND,
    endpoints: {
      fila_medica: `${BACKEND}/api/atendimentos?scope=medical`,
      detalhe: `${BACKEND}/api/atendimentos/:id`,
      decisoes: `${BACKEND}/api/atendimentos/:id/decisoes`,
      approve: `POST ${BACKEND}/api/atendimentos/:id/clinical/approve (auth)`,
      reject: `POST ${BACKEND}/api/atendimentos/:id/clinical/reject (auth)`
    },
    fila: null,
    amostras: [],
    resumo: { total_fila: 0, amostra_analisada: 0, ok_prontuario: 0, pendencias: [] },
    ok: false
  };

  if (TARGET_ID) {
    const one = await fetchJson(`${BACKEND}/api/atendimentos/${TARGET_ID}`);
    if (one.status !== 200) {
      report.resumo.pendencias.push(`GET atendimento ${TARGET_ID} -> ${one.status}`);
    } else {
      const row = one.data.atendimento || one.data;
      const analyzed = analyzeAtendimento(row);
      report.amostras = [analyzed];
      report.resumo.amostra_analisada = 1;
      if (analyzed.checks.prontuario_completo) report.resumo.ok_prontuario = 1;
    }
  } else {
    const queue = await fetchJson(`${BACKEND}/api/atendimentos?scope=medical`);
    report.fila = { status: queue.status, scope: queue.data?.scope };
    if (queue.status !== 200) {
      report.resumo.pendencias.push(`GET fila médica -> ${queue.status}`);
    } else {
      const list = queue.data.atendimentos || [];
      report.resumo.total_fila = list.length;
      const sample = list.slice(0, SAMPLE);
      report.amostras = sample.map(analyzeAtendimento);
      report.resumo.amostra_analisada = report.amostras.length;
      report.resumo.ok_prontuario = report.amostras.filter((a) => a.checks.prontuario_completo).length;

      const withoutRx = report.amostras.filter((a) => !a.checks.receita_url).length;
      if (withoutRx) {
        report.resumo.pendencias.push(
          `${withoutRx} atendimento(s) na amostra sem URL de receita — podem falhar na aprovação médica`
        );
      }
    }
  }

  const allChecks = report.amostras.every(
    (a) =>
      a.checks.origem_typebot &&
      a.checks.pagamento_confirmado &&
      a.checks.elegivel &&
      a.checks.prontuario_completo
  );

  report.ok =
    report.resumo.pendencias.length === 0 &&
    report.resumo.amostra_analisada > 0 &&
    allChecks;

  require('fs').writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
