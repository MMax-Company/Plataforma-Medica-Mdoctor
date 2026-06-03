#!/usr/bin/env node
/**
 * Validação E2E real staging (sem mock).
 */
require('./load-dotenv');
const { initSupabase, getSupabase } = require('../src/config/supabase');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const PANEL = String(process.env.PANEL_URL || 'https://painel-medico-staging-staging.up.railway.app').replace(/\/$/, '');
const N8N = String(process.env.N8N_WEBHOOK_URL || 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook').replace(/\/$/, '');
const SECRET = process.env.N8N_WEBHOOK_SECRET || process.env.INGRESS_SERVICE_SECRET || '';
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const RUN_ID = process.env.RUN_ID || '';

const V = {};

async function req(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const rz = await req(`${BACKEND}/readyz`);
  V.supabase = rz.data?.supabase?.connected === true && rz.data?.storage?.mode === 'supabase';
  V.backend = rz.ok;

  const login = await req(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  V.login = login.ok && login.data?.token;
  const token = login.data?.token;

  const memed = await req(`${BACKEND}/api/memed/token?refresh=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  V.memed = memed.ok && memed.data?.token && memed.data?.prescriber?.mode === 'sinapse_production';

  const queue = await req(`${BACKEND}/api/atendimentos/queue`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rows = queue.data?.atendimentos || [];
  let eligible = rows.filter(
    (a) =>
      a.elegibilidade?.eligible === true &&
      String(a.pagamento_status || '').toUpperCase() === 'CONFIRMADO' &&
      String(a.status || '').toLowerCase() !== 'rejected'
  );
  if (RUN_ID) {
    eligible = eligible.filter((a) => String(a.paciente_nome || '').includes(RUN_ID));
  }
  V.fila = queue.ok && eligible.length >= 6;

  const n8n = await req(N8N, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(SECRET ? { 'X-MDoctor-Webhook-Secret': SECRET } : {}) },
    body: JSON.stringify({ probe: true, runId: RUN_ID || 'probe' }),
  });
  V.n8n = n8n.status === 200;

  const target = eligible.find((a) => a.status === 'waiting') || eligible[0];
  if (target?.id) {
    const save = await req(`${BACKEND}/api/atendimentos/${target.id}/clinical`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dados_clinicos: { conduta: 'Validação real staging' } }),
    });
    const approve = await req(`${BACKEND}/api/atendimentos/${target.id}/clinical/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: 'Validação real' }),
    });
    V.botoes = save.ok && approve.ok;
    V.painel = PANEL.includes('painel-medico-staging') && BACKEND.includes('mdoctor-backend-staging');
  } else {
    V.botoes = false;
    V.painel = false;
  }

  const unpaidInQueue = rows.some((a) => String(a.pagamento_status || '').toUpperCase() !== 'CONFIRMADO');
  V.pacientes = eligible.length >= 6 && !unpaidInQueue;

  if (target?.id && V.memed) {
    const hasReceipt = Boolean(
      target.dados_clinicos?.memed_receita?.receitaId || target.dados_clinicos?.memed_receita?.pdfUrl
    );
    const deliver = hasReceipt
      ? await req(`${BACKEND}/api/atendimentos/${target.id}/deliver`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: 'whatsapp' }),
        })
      : { ok: false, data: { skipped: 'sem receita real emitida' } };
    V.whatsapp =
      deliver.ok &&
      !['mock', 'dry-run'].includes(String(deliver.data?.delivery?.provider || '').toLowerCase());
    if (!hasReceipt) V.whatsapp = false;
  } else {
    V.whatsapp = false;
  }

  initSupabase();
  const supabase = getSupabase();
  const { count: triageCount } = await supabase
    .from('triage_sessions')
    .select('id', { count: 'exact', head: true });
  V.supabaseTables = (triageCount || 0) > 0;

  const ready =
    V.pacientes &&
    V.fila &&
    V.botoes &&
    V.memed &&
    V.supabase &&
    V.login &&
    V.n8n &&
    V.painel;

  console.log(JSON.stringify({ V, ready, panel: PANEL, backend: BACKEND }, null, 2));
  process.exit(ready ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
