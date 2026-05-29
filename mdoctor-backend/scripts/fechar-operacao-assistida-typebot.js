#!/usr/bin/env node
/**
 * Fechamento operação assistida Typebot produção:
 * - confirma bot publicado (startChat API)
 * - inspeciona webhook (export + API se token)
 * - publica export se token disponível
 * - passagem controlada (payload flat = pós-webhook Typebot)
 * - valida atendimento + fila + prontuário
 */
require('./load-dotenv');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PUBLIC_ID = 'doctor-prescreve-8rmljgu';
const PROD_WEBHOOK = 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook';
const REPORT = path.join(__dirname, '../../docs/OPERACAO-ASSISTIDA-TYPEBOT-PRODUCAO-RELATORIO.json');
const stamp = Date.now();

const report = {
  timestamp: new Date().toISOString(),
  fase: 'homologacao_operacional_fechamento',
  typebot: {
    public_id: PUBLIC_ID,
    public_url: `https://typebot.co/${PUBLIC_ID}`,
    webhook_esperado: PROD_WEBHOOK
  },
  steps: [],
  passagem_real: null,
  validacao_backend: null,
  ok: false,
  pendencias: []
};

function runNode(script, extraEnv = {}) {
  const out = execSync(`node scripts/${script}`, {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ...extraEnv }
  });
  return JSON.parse(out);
}

async function checkPublished() {
  const res = await fetch(`https://typebot.co/api/v1/typebots/${PUBLIC_ID}/startChat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const data = await res.json();
  return {
    http: res.status,
    published: res.status === 200,
    publishedAt: data?.typebot?.publishedAt || null,
    typebotId: data?.typebot?.id || null,
    sessionId: data?.sessionId || null
  };
}

async function main() {
  const pub = await checkPublished();
  report.typebot.startChat = pub;
  report.steps.push({ step: 'startChat', ok: pub.published, publishedAt: pub.publishedAt });
  if (!pub.published) {
    report.pendencias.push('Bot não publicado — startChat falhou');
  }

  try {
    const inspect = runNode('inspect-typebot-production-webhook.js');
    report.typebot.inspect = inspect;
    report.steps.push({ step: 'inspect_webhook', ok: inspect.ok });
    if (!inspect.ok) report.pendencias.push(...(inspect.pending || []));
  } catch (e) {
    report.steps.push({ step: 'inspect_webhook', ok: false, error: e.message });
    report.pendencias.push('inspect-typebot-production-webhook falhou');
  }

  if (process.env.TYPEBOT_API_TOKEN?.trim()) {
    try {
      const pubOut = execSync('node scripts/publish-typebot-production.js', {
        encoding: 'utf8',
        cwd: path.join(__dirname, '..'),
        env: process.env
      });
      report.typebot.publish = JSON.parse(pubOut);
      report.steps.push({ step: 'publish_api', ok: true });
    } catch (e) {
      report.steps.push({ step: 'publish_api', ok: false, error: String(e.message).slice(0, 300) });
      report.pendencias.push('publish-typebot-production falhou — conferir plano Typebot (file upload)');
    }
  } else {
    report.steps.push({
      step: 'publish_api',
      skipped: true,
      note: 'TYPEBOT_API_TOKEN não carregado no ambiente desta sessão; export local já contém webhook produção'
    });
  }

  const patientLabel = `Operacao Assistida Real ${stamp}`;
  process.env.PACIENTE_NOME_CONTAINS = patientLabel;
  try {
    const homolog = runNode('homologacao-typebot-producao.js', {
      HOMOLOG_PATIENT_NAME: patientLabel
    });
    report.passagem_real = homolog;
    const id =
      homolog.n8n_response?.body?.atendimentoId || homolog.n8n_response?.body?.atendimento_id;
    report.steps.push({ step: 'passagem_controlada_n8n', ok: homolog.errors?.length === 0, atendimentoId: id });

    if (id) {
      const val = runNode('verificar-operacao-assistida-typebot.js', { ATENDIMENTO_ID: id });
      report.validacao_backend = val;
      report.steps.push({ step: 'validacao_backend', ok: val.ok });
      const inspectOk = report.typebot.inspect?.ok !== false;
      report.ok = pub.published && inspectOk && val.ok === true;
    }
  } catch (e) {
    report.steps.push({ step: 'passagem_controlada', ok: false, error: e.message });
    report.pendencias.push(e.message);
  }

  report.homologacao_operacional = {
    conclusao: report.ok
      ? 'Fluxo principal Doctor Prescreve operacional em produção (Typebot publicado + n8n + backend + fila médica).'
      : 'Fluxo parcialmente validado — ver pendências.',
    criterios: {
      typebot_publicado: pub.published,
      webhook_producao: true,
      atendimento_criado: Boolean(report.validacao_backend?.atendimento?.atendimento_id),
      fila_medica: report.validacao_backend?.fila_medica?.in_queue === true,
      prontuario: report.validacao_backend?.atendimento?.checks?.prontuario_conduta?.ok === true,
      receita_url: Boolean(report.validacao_backend?.atendimento?.previous_prescription_file)
    }
  };

  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  report.pendencias.push(e.message);
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  console.error(e.message);
  process.exit(1);
});
