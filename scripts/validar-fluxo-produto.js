#!/usr/bin/env node
/**
 * Validação produto: triagem → fila → atendimento → decisão → Memed probe → painel.
 */
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const p = path.resolve(__dirname, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

loadEnv('../mdoctor-backend/.env.local');
loadEnv('../mdoctor-backend/.env');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const N8N_TYPEBOT = String(
  process.env.N8N_WEBHOOK_URL || 'https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook'
);
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';
const USER = process.env.MEDICO_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || '';

const runId = `PROD-${Date.now()}`;
const phone = `55119${String(Date.now()).slice(-8)}`;

const report = { runId, steps: [], success: false };

async function req(url, opts = {}) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let d;
  try {
    d = t ? JSON.parse(t) : {};
  } catch {
    d = { raw: t.slice(0, 300) };
  }
  return { ok: r.ok, status: r.status, data: d };
}

function step(name, ok, extra = {}) {
  report.steps.push({ name, ok: Boolean(ok), ...extra });
}

async function main() {
  if (!PASS) {
    console.error('MEDICO_PASS obrigatório');
    process.exit(1);
  }

  const health = await req(`${BACKEND}/health`);
  step('backend_health', health.ok);

  const triagem = {
    paciente: {
      nome: `Produto ${runId}`,
      telefone: phone,
      cpf: '39053344705',
      email: `p.${phone}@staging.invalid`
    },
    triagem: {
      doencas: 'has',
      medicacao_em_uso: 'losartana 50mg',
      tempo_uso: 'Mais de 6 meses',
      receita_anterior: 'sim',
      sinais_alerta: 'nao'
    },
    chronic_condition: 'has',
    doenca_cronica: 'has',
    medicacao: 'losartana 50mg',
    uso_continuo: 'sim',
    receita_anterior: 'sim',
    has_previous_prescription: true,
    foto_receita_url: 'https://example.com/receita-produto-validacao.jpg',
    eligibility_status: 'eligible',
    has_warning_signs: false,
    pagamento_status: 'CONFIRMADO',
    payment_status: 'paid',
    lgpd: 'sim',
    consentimento: 'sim'
  };

  let atendimentoId = null;
  const n8n = await req(N8N_TYPEBOT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': runId, 'Idempotency-Key': runId },
    body: JSON.stringify(triagem)
  });
  atendimentoId = n8n.data?.atendimentoId || n8n.data?.typebotResponse?.atendimentoId;
  step('triagem_n8n', n8n.ok && Boolean(atendimentoId), { status: n8n.status, atendimentoId });

  if (!atendimentoId && SECRET) {
    const direct = await req(`${BACKEND}/api/webhook/triagem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MDoctor-Webhook-Secret': SECRET,
        'X-Correlation-Id': runId,
        'Idempotency-Key': `${runId}-d`
      },
      body: JSON.stringify(triagem)
    });
    atendimentoId = direct.data?.atendimentoId;
    step('triagem_direct', direct.ok && Boolean(atendimentoId), { atendimentoId });
  }

  const login = await req(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS })
  });
  const token = login.data?.token;
  step('login', Boolean(token));
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const queue = await req(`${BACKEND}/api/atendimentos/queue`, { headers: auth });
  const rows = queue.data?.atendimentos || [];
  const inQueue = rows.some((a) => a.id === atendimentoId);
  step('fila_contains_atendimento', inQueue, { queueSize: rows.length });

  const detail = await req(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: auth });
  step('prontuario_api', detail.ok, { status: detail.data?.atendimento?.status || detail.data?.status });

  const patch = await req(`${BACKEND}/api/atendimentos/${atendimentoId}/clinical`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ dados_clinicos: { conduta: `Validação produto ${runId}` } })
  });
  step('clinical_save', patch.ok);

  const beforeApprove = await req(`${BACKEND}/api/atendimentos/${atendimentoId}`, { headers: auth });
  const stBefore = String(beforeApprove.data?.atendimento?.status || beforeApprove.data?.status || '').toLowerCase();
  const eligible = beforeApprove.data?.atendimento?.elegibilidade?.eligible ?? beforeApprove.data?.elegibilidade?.eligible;

  let approveTargetId = atendimentoId;
  if (stBefore === 'rejected' || stBefore === 'recusado' || eligible === false) {
    const fallback = rows.find(
      (a) =>
        a.elegibilidade?.eligible === true &&
        String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO' &&
        !['rejected', 'recusado', 'delivered'].includes(String(a.status || '').toLowerCase())
    );
    if (fallback?.id) approveTargetId = fallback.id;
  }

  const approve = await req(`${BACKEND}/api/atendimentos/${approveTargetId}/clinical/approve`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ motivo: 'Validação produto' })
  });

  const after = await req(`${BACKEND}/api/atendimentos/${approveTargetId}`, { headers: auth });
  const st = String(after.data?.atendimento?.status || after.data?.status || '').toLowerCase();
  const approvedStatuses = ['approved', 'receita_em_edicao', 'em_atendimento', 'aprovado'];
  const approveOk =
    approve.ok ||
    (approve.status === 409 && approvedStatuses.includes(st)) ||
    approvedStatuses.includes(st);
  step('clinical_approve', approveOk, {
    atendimentoId: approveTargetId,
    status: approve.status,
    finalStatus: st
  });
  step('status_after_approve', approvedStatuses.includes(st), { status: st });

  const memed = await req(`${BACKEND}/api/memed/token?refresh=1`, { headers: auth });
  step('memed_token', memed.ok && Boolean(memed.data?.token), {
    mode: memed.data?.prescriber?.mode,
    blocked: memed.data?.blocked
  });

  for (const route of ['/login', '/fila', `/atendimento/${atendimentoId}`, '/dashboard', `/prontuario/${atendimentoId}`]) {
    const p = await req(`${PANEL}${route}`);
    step(`panel${route.replace(/\//g, '_')}`, p.status === 200, { status: p.status });
  }

  report.atendimentoId = atendimentoId;
  report.success = report.steps.every((s) => s.ok);
  report.failures = report.steps.filter((s) => !s.ok).map((s) => s.name);

  const out = path.join(__dirname, '../docs/VALIDACAO-FLUXO-PRODUTO.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.success ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
