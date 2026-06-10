#!/usr/bin/env node
/**
 * Fecha todos os atendimentos na coluna "Emitir Receita" (EM_ATENDIMENTO, UNDER_REVIEW,
 * MEMED_PROCESSING) movendo-os para FINISHED.
 * Não toca em pacientes nas colunas QUEUE, AWAITING_VALIDATION, RECEITA_EMITIDA ou FINISHED.
 *
 *   node scripts/clean-emitir-receita.js
 */
require('./load-dotenv');

const BACKEND = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';

// DB retorna lowercase; toPanelAtendimentoStatus mapeia para EM_ATENDIMENTO e MEMED_PROCESSING
const EMITIR_STATUSES = new Set([
  'em_atendimento', 'under_review', 'memed_processing', 'receita_em_edicao',
  'EM_ATENDIMENTO', 'UNDER_REVIEW', 'MEMED_PROCESSING',
]);

async function req(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, data };
}

async function main() {
  console.log(`\nBackend: ${BACKEND}`);
  if (!MEDICO_PASS) { console.error('MEDICO_PASS não definido.'); process.exit(1); }

  const login = await req(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  if (!login.ok || !login.data?.token) throw new Error(`Login falhou: HTTP ${login.status}`);
  const token = login.data.token;
  const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const queueRes = await req(`${BACKEND}/api/atendimentos/queue`, { headers: authH });
  if (!queueRes.ok) { console.error(`Erro ao buscar fila: HTTP ${queueRes.status}`); process.exit(1); }

  const all = queueRes.data?.atendimentos || [];
  const toClose = all.filter((a) => EMITIR_STATUSES.has(a.status));

  console.log(`\nAtendimentos na fila: ${all.length}`);
  console.log(`Coluna "Emitir Receita" para fechar: ${toClose.length}\n`);

  if (toClose.length === 0) {
    console.log('Nenhum paciente na coluna Emitir Receita. Nada a fazer.');
    return;
  }

  let ok = 0, fail = 0;
  for (const a of toClose) {
    const r = await req(`${BACKEND}/api/atendimentos/${a.id}/status`, {
      method: 'PATCH',
      headers: authH,
      body: JSON.stringify({ status: 'FINISHED', notes: 'Limpeza coluna Emitir Receita — staging' }),
    });
    if (r.ok) {
      ok++;
      console.log(`✓ ${a.paciente_nome || a.id} (${a.status} → FINISHED)`);
    } else {
      fail++;
      console.error(`✗ ${a.paciente_nome || a.id} — HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`);
    }
  }

  console.log(`\nFechados: ${ok}, erros: ${fail}`);
}

main().catch((err) => { console.error('Erro fatal:', err); process.exit(1); });
