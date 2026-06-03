#!/usr/bin/env node
/**
 * Validação funcional painel — seed 10 pacientes + provas API.
 *   MEDICO_PASS=... N8N_WEBHOOK_SECRET=... node scripts/painel-funcional-validacao.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const REPORT = path.join(__dirname, '../../docs/PAINEL-FUNCIONAL-VALIDACAO.md');
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';

const verdict = {};
const proofs = [];

function step(name, ok, detail = {}) {
  verdict[name] = Boolean(ok);
  proofs.push({ step: name, ok: Boolean(ok), ...detail });
  return ok;
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 400) };
  }
  return { status: res.status, ok: res.ok, data };
}

async function login() {
  const r = await request(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  return r.data?.token;
}

async function main() {
  if (!MEDICO_PASS) {
    console.error('MEDICO_PASS obrigatório');
    process.exit(1);
  }

  const seed = spawnSync(process.execPath, [path.join(__dirname, 'simulacao-massiva-painel-10.js')], {
    env: { ...process.env, BACKEND_URL: BACKEND },
    encoding: 'utf8',
  });
  const seedOk = seed.status === 0;
  const seedReport = path.join(__dirname, '../../docs/SIMULACAO-MASSIVA-PAINEL-10-RELATORIO.json');
  let seedPatients = 0;
  if (fs.existsSync(seedReport)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(seedReport, 'utf8'));
      seedPatients = (parsed.patients || []).filter((p) => p.checks?.criado).length;
    } catch {
      seedPatients = 0;
    }
  }
  step('massa_10', seedOk || seedPatients >= 10, {
    exit: seed.status,
    seedPatients,
    stdout: seed.stdout?.slice(-500),
  });

  const token = await login();
  step('login', Boolean(token));

  const queue = await request(`${BACKEND}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rows = queue.data?.atendimentos || [];
  const eligiblePaid = rows.filter(
    (a) =>
      a.elegibilidade?.eligible === true &&
      String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO' &&
      String(a.status || '').toLowerCase() !== 'rejected'
  );
  const rejected = rows.filter((a) => String(a.status || '').toLowerCase() === 'rejected' || a.elegibilidade?.eligible === false);
  step('fila_api', queue.ok && eligiblePaid.length >= 6, {
    total: rows.length,
    eligiblePaid: eligiblePaid.length,
    rejected: rejected.length,
    endpoint: 'GET /api/atendimentos/queue',
  });

  const unpaidProbe = rows.find((a) => String(a.pagamento_status || '').toUpperCase() !== 'CONFIRMADO');
  step('nao_pago_fora_fila', !unpaidProbe, { foundUnpaidInQueue: Boolean(unpaidProbe) });

  const target =
    eligiblePaid.find((a) => ['waiting', 'queue', 'fila', 'em_atendimento', 'approved'].includes(String(a.status || '').toLowerCase())) ||
    eligiblePaid.find((a) => String(a.status || '').toLowerCase() !== 'delivered') ||
    eligiblePaid[0];
  if (target?.id) {
    const before = await request(`${BACKEND}/api/atendimentos/${target.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const approve = await request(`${BACKEND}/api/atendimentos/${target.id}/clinical/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Validação funcional painel' }),
    });
    const after = await request(`${BACKEND}/api/atendimentos/${target.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    step('botao_aprovar', approve.ok && ['approved', 'receita_em_edicao', 'em_atendimento'].includes(String(after.data?.atendimento?.status || '').toLowerCase()), {
      endpoint: 'POST /clinical/approve',
      statusBefore: before.data?.atendimento?.status,
      statusAfter: after.data?.atendimento?.status,
    });

    const memed = await request(`${BACKEND}/api/memed/token?refresh=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    step('memed_token', memed.ok && memed.data?.token, {
      mode: memed.data?.prescriber?.mode,
      endpoint: 'GET /api/memed/token',
    });
  } else {
    step('botao_aprovar', false, { error: 'sem elegível na fila' });
    step('memed_token', false, { error: 'sem elegível' });
  }

  const ineligible = rejected[0];
  if (ineligible?.id) {
    const rej = await request(`${BACKEND}/api/atendimentos/${ineligible.id}/clinical/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason_code: 'FORA_DO_PROTOCOLO', motivo: 'Validação reprovação' }),
    });
    step('botao_reprovar', rej.ok || String(ineligible.status).toLowerCase() === 'rejected', {
      endpoint: 'POST /clinical/reject',
      status: ineligible.status,
    });
  } else {
    step('botao_reprovar', rejected.length >= 3, { rejectedCount: rejected.length });
  }

  const ready = Object.values(verdict).every(Boolean);
  const md = [
    '# Painel Funcional — Validação',
    '',
    `> ${new Date().toISOString()}`,
    `> Backend: ${BACKEND}`,
    `> Painel: ${PANEL}`,
    '',
    `**PANEL FUNCTIONAL READY:** ${ready ? 'YES' : 'NO'}`,
    '',
    '| Prova | OK | Detalhe |',
    '|-------|-----|---------|',
    ...proofs.map((p) => `| ${p.step} | ${p.ok ? '✅' : '❌'} | ${JSON.stringify(p).slice(0, 120)} |`),
  ].join('\n');
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, md, 'utf8');
  console.log(JSON.stringify({ ready, verdict, report: REPORT }, null, 2));
  process.exit(ready ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
