/**
 * Antirregressão de RBAC do ciclo administrativo → médico → administrativo
 * do ticket de Suporte Geral (support_tickets).
 *
 * Não toca no banco: o gate de role (requireRole) intercepta a requisição
 * ANTES de qualquer handler chegar a support-tickets.store.js, então basta
 * montar o router real com um app Express isolado e afirmar o status HTTP.
 *
 * Regra sob teste: abrir/encaminhar/encerrar ticket é exclusivo do perfil
 * administrativo (role 'administrativo'); responder ao ticket encaminhado é
 * exclusivo do perfil médico (role 'admin'/'doctor' — MEDICO_ROLE=admin por
 * padrão neste projeto, ver README/.env.example). Administrativo nunca pode
 * registrar resposta médica, e médico nunca abre/encaminha/encerra ticket.
 */
const assert = require('assert');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../src/auth/auth.middleware');

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/atendimentos', require('../src/routes/atendimentos.routes'));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  function tokenFor(role) {
    return jwt.sign({ sub: 'test', username: `test-${role}`, role, name: `Test ${role}` }, getJwtSecret(), {
      expiresIn: '5m'
    });
  }

  const adminToken = tokenFor('administrativo'); // perfil administrativo real
  const doctorToken = tokenFor('admin'); // perfil médico real (MEDICO_ROLE=admin)
  const unknownRoleToken = tokenFor('paciente'); // nem admin nem médico

  async function call(method, path, token, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return res.status;
  }

  const FAKE_ID = '00000000-0000-0000-0000-000000000000';
  const results = [];

  async function expectStatus(label, promise, allowed) {
    const status = await promise;
    const ok = allowed.includes(status);
    results.push({ label, status, ok });
  }

  // ── Abrir (start) — só administrativo ──────────────────────────────────
  await expectStatus(
    'médico NÃO pode abrir ticket (start)',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/start`, doctorToken),
    [403]
  );
  await expectStatus(
    'administrativo PODE abrir ticket (start)',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/start`, adminToken),
    [404, 409, 500] // passou do RBAC; ticket fake não existe de verdade
  );
  await expectStatus(
    'sem token não pode abrir ticket (start)',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/start`, null),
    [401]
  );

  // ── Encaminhar ao médico — só administrativo ────────────────────────────
  await expectStatus(
    'médico NÃO pode encaminhar ticket ao médico',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/forward-to-doctor`, doctorToken, { motivo: 'x' }),
    [403]
  );
  await expectStatus(
    'administrativo PODE encaminhar ticket ao médico',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/forward-to-doctor`, adminToken, { motivo: 'x' }),
    [404, 409, 500]
  );
  await expectStatus(
    'perfil desconhecido NÃO pode encaminhar ticket ao médico',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/forward-to-doctor`, unknownRoleToken, { motivo: 'x' }),
    [403]
  );

  // ── Responder ticket médico — só médico (núcleo do Commit 3) ───────────
  await expectStatus(
    'ADMINISTRATIVO NÃO PODE responder ticket médico (regra central)',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/answer`, adminToken, { resposta: 'x' }),
    [403]
  );
  await expectStatus(
    'médico PODE responder ticket médico',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/answer`, doctorToken, { resposta: 'x' }),
    [404, 409, 500]
  );
  await expectStatus(
    'perfil desconhecido não pode responder ticket médico',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/answer`, unknownRoleToken, { resposta: 'x' }),
    [403]
  );

  // ── Encerrar (close) — só administrativo ────────────────────────────────
  await expectStatus(
    'médico NÃO pode encerrar ticket administrativamente',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/close`, doctorToken),
    [403]
  );
  await expectStatus(
    'administrativo PODE encerrar ticket administrativamente',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/close`, adminToken),
    [404, 409, 500]
  );

  // ── Finalize (fluxo de decisão do paciente) — só administrativo ────────
  await expectStatus(
    'médico NÃO pode finalizar ticket (perguntar decisão ao paciente)',
    call('POST', `/api/atendimentos/${FAKE_ID}/support/finalize`, doctorToken),
    [403]
  );

  // ── Visualizar fila médica — administrativo e médico, ninguém mais ─────
  // [200, 500]: sem Supabase configurado neste teste isolado, a rota chega a
  // consultar o banco (RBAC já passou) e falha por falta de DB — o mesmo
  // "passou do RBAC" das demais verificações acima, só que aqui a rota tenta
  // responder antes de qualquer erro de "recurso não encontrado" ser possível.
  await expectStatus(
    'médico PODE ver fila de tickets encaminhados',
    call('GET', '/api/atendimentos/support-queue/medical', doctorToken),
    [200, 500]
  );
  await expectStatus(
    'administrativo PODE ver fila de tickets encaminhados',
    call('GET', '/api/atendimentos/support-queue/medical', adminToken),
    [200, 500]
  );
  await expectStatus(
    'perfil desconhecido NÃO pode ver fila de tickets encaminhados',
    call('GET', '/api/atendimentos/support-queue/medical', unknownRoleToken),
    [403]
  );

  server.close();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} — ${r.label} (status ${r.status})`);
  }

  assert.strictEqual(failed.length, 0, `${failed.length} verificação(ões) de RBAC falharam`);
  console.log(`\nOK: ${results.length}/${results.length} verificações de RBAC do ciclo de suporte passaram.`);
}

main().catch((err) => {
  console.error('FALHOU:', err.message);
  process.exit(1);
});
