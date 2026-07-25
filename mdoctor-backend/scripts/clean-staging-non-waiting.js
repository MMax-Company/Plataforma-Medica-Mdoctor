/**
 * Limpa atendimentos em staging que não estão em status de espera (waiting).
 * Move tudo para FINISHED, deixando apenas os pacientes na fila de espera.
 */
require('./load-dotenv');

const BACKEND = (
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');

const MEDICO_USER = process.env.MEDICO_USER || process.env.MEDICO_OFFICIAL_USER || '';
const MEDICO_PASS = process.env.MEDICO_PASS || process.env.MEDICO_OFFICIAL_PASS || '';

// Status que significam "aguardando" — esses ficam intocados
const WAITING_STATUSES = new Set(['waiting', 'WAITING', 'QUEUE', 'FILA', 'TRIAGED']);

async function req(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 400) }; }
  return { status: res.status, ok: res.ok, data };
}

async function login() {
  const r = await req(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  if (!r.ok || !r.data?.token) throw new Error(`Login falhou: HTTP ${r.status}`);
  return r.data.token;
}

async function main() {
  console.log(`\nBackend: ${BACKEND}`);

  if (!MEDICO_PASS) {
    console.error('MEDICO_PASS não definido — impossível fazer login.');
    process.exit(1);
  }

  const token = await login();
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const queueRes = await req(`${BACKEND}/api/atendimentos/queue`, { headers: authHeaders });
  if (!queueRes.ok) {
    console.error(`Erro ao buscar fila: HTTP ${queueRes.status}`);
    process.exit(1);
  }

  const all = queueRes.data?.atendimentos || [];
  console.log(`\nTotal de atendimentos na fila: ${all.length}`);

  const toClose = all.filter((a) => !WAITING_STATUSES.has(a.status));
  const toKeep  = all.filter((a) =>  WAITING_STATUSES.has(a.status));

  console.log(`  → manter (waiting): ${toKeep.length}`);
  console.log(`  → fechar (não-waiting): ${toClose.length}\n`);

  if (toClose.length === 0) {
    console.log('Nada a limpar. Fila já está apenas com pacientes em espera.');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const a of toClose) {
    const r = await req(`${BACKEND}/api/atendimentos/${a.id}/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: 'FINISHED', notes: 'Limpeza de staging antes de novo teste' }),
    });
    if (r.ok) {
      ok++;
      console.log(`✓ ${a.paciente_nome || a.id} (${a.status} → FINISHED)`);
    } else {
      fail++;
      console.error(`✗ ${a.paciente_nome || a.id} — HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);
    }
  }

  console.log(`\nLimpeza concluída: ${ok} fechados, ${fail} erros.`);
  console.log(`Restam ${toKeep.length} atendimento(s) em waiting na fila.\n`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
