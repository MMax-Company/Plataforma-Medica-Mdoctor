#!/usr/bin/env node
/**
 * Cria 10 pacientes de teste via fluxo REAL: POST /api/webhook/triagem
 * (mesmo caminho Typebot → persistência Supabase oficial).
 *
 *   MEDICO_PASS não necessário. N8N_WEBHOOK_SECRET ou INGRESS_SERVICE_SECRET obrigatório.
 *   STAGING_RX_PHOTO_URL opcional (HTTPS); senão busca URL real já persistida no projeto.
 */
require('./load-dotenv');
const { initSupabase, getSupabase } = require('../src/config/supabase');

const BACKEND = String(process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const SECRET = process.env.N8N_WEBHOOK_SECRET || process.env.INGRESS_SERVICE_SECRET || '';
const RUN_ID = process.env.RUN_ID || `staging-real-${Date.now()}`;

const CPFS = [
  '52998224725',
  '39053344705',
  '15350946056',
  '11144477735',
  '93642479859',
  '74816998030',
  '60783309080',
  '45317828791',
  '23100299900',
  '28625587860',
];

const PATIENTS = [
  { n: 1, g: 'elegivel', nome: 'Staging Real E1 HAS', cpf: CPFS[0], doenca: 'Hipertensão arterial (HAS)', med: 'Losartana 50mg 24h', dias: 30, paid: true, alerta: 'não' },
  { n: 2, g: 'elegivel', nome: 'Staging Real E2 DM2', cpf: CPFS[1], doenca: 'Diabetes mellitus tipo 2', med: 'Metformina 850mg 12/12h', dias: 45, paid: true, alerta: 'não' },
  { n: 3, g: 'elegivel', nome: 'Staging Real E3 HAS+DM', cpf: CPFS[2], doenca: 'HAS + Diabetes tipo 2', med: 'Losartana 50mg + Metformina 850mg', dias: 60, paid: true, alerta: 'não' },
  { n: 4, g: 'elegivel', nome: 'Staging Real E4 Hipotireoidismo', cpf: CPFS[3], doenca: 'Hipotireoidismo', med: 'Levotiroxina 50mcg jejum', dias: 75, paid: true, alerta: 'não' },
  { n: 5, g: 'elegivel', nome: 'Staging Real E5 DLP', cpf: CPFS[4], doenca: 'Dislipidemia', med: 'Sinvastatina 20mg noite', dias: 90, paid: true, alerta: 'não' },
  { n: 6, g: 'elegivel', nome: 'Staging Real E6 HAS', cpf: CPFS[5], doenca: 'Hipertensão arterial', med: 'Losartana 100mg + Anlodipino 5mg', dias: 120, paid: true, alerta: 'não' },
  { n: 7, g: 'inelegivel', nome: 'Staging Real I7 Alerta', cpf: CPFS[6], doenca: 'HAS com sinais de alerta', med: 'Losartana 50mg', dias: 40, paid: true, alerta: 'sim' },
  { n: 8, g: 'inelegivel', nome: 'Staging Real I8 Controlado', cpf: CPFS[7], doenca: 'HAS — benzodiazepínico', med: 'Clonazepam 2mg 12/12h', dias: 50, paid: true, alerta: 'não', medOverride: true },
  { n: 9, g: 'inelegivel', nome: 'Staging Real I9 Receita 220d', cpf: CPFS[8], doenca: 'HAS receita vencida', med: 'Losartana 50mg', dias: 220, paid: true, alerta: 'não' },
  { n: 10, g: 'nao_pago', nome: 'Staging Real P10 Sem pagamento', cpf: CPFS[9], doenca: 'HAS pendente pagamento', med: 'Losartana 50mg', dias: 35, paid: false, alerta: 'não' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resolveRxPhotoUrl() {
  const fromEnv = String(process.env.STAGING_RX_PHOTO_URL || '').trim();
  if (fromEnv.startsWith('https://')) return fromEnv;
  initSupabase();
  const supabase = getSupabase();
  const { data } = await supabase
    .from('appointments')
    .select('dados_clinicos')
    .order('created_at', { ascending: false })
    .limit(40);
  for (const row of data || []) {
    const dc = row.dados_clinicos || {};
    const url = dc.foto_receita_url || dc.previous_prescription_url || dc.previous_prescription_file;
    if (url && String(url).startsWith('https://') && !/example\.(com|invalid)/i.test(url)) return url;
  }
  const { data: legacy } = await supabase.from('atendimentos').select('dados_clinicos').limit(40);
  for (const row of legacy || []) {
    const dc = row.dados_clinicos || {};
    const url = dc.foto_receita_url || dc.previous_prescription_url;
    if (url && String(url).startsWith('https://') && !/example\.(com|invalid)/i.test(url)) return url;
  }
  throw new Error('STAGING_RX_PHOTO_URL obrigatório (HTTPS real no Storage Supabase staging)');
}

async function createViaTriagem(p, phone, rxUrl) {
  const idempotencyKey = `${RUN_ID}-p${p.n}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Correlation-Id': `triagem-${RUN_ID}-p${p.n}`,
    'Idempotency-Key': idempotencyKey,
  };
  if (SECRET) headers['X-MDoctor-Webhook-Secret'] = SECRET;

  const payload = {
    paciente: {
      nome: `${p.nome} ${RUN_ID}`,
      telefone: phone,
      cpf: p.cpf,
      email: `staging.real.p${p.n}.${RUN_ID}@mdoctor.staging`,
      data_nascimento: '15/08/1988',
      endereco: `Rua Oficial ${p.n}, 100`,
      cep: '01310100',
    },
    triagem: {
      doencas: p.doenca,
      medicacao_em_uso: p.medOverride ? p.med : p.med,
      tempo_uso: 'Mais de 6 meses',
      receita_anterior: 'sim',
      sinais_alerta: p.alerta,
      observacoes: `Triagem oficial staging ${RUN_ID}`,
      receita_vencida_dias: p.dias,
    },
    typebot_context: {
      pagamento_status: p.paid ? 'CONFIRMADO' : 'PENDENTE',
      payment_status: p.paid ? 'paid' : 'unpaid',
      payment_confirmed: p.paid,
      has_previous_prescription: 'sim',
      receita_anterior: 'sim',
      previous_prescription_file: rxUrl,
      foto_receita_url: rxUrl,
      previous_prescription_url: rxUrl,
      eligibility_status: p.g === 'inelegivel' ? 'ineligible' : 'eligible',
    },
  };

  const res = await fetch(`${BACKEND}/api/webhook/triagem`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok && data.success !== false,
    status: res.status,
    atendimentoId: data.atendimentoId || data.atendimento?.id,
    data,
  };
}

async function verifySupabase(ids) {
  initSupabase();
  const supabase = getSupabase();
  const out = {};
  for (const [table, col] of [
    ['patients', 'id'],
    ['appointments', 'id'],
    ['triage_sessions', 'appointment_id'],
    ['medical_records', 'appointment_id'],
    ['audit_logs', 'entity_id'],
  ]) {
    const { count, error } = await supabase
      .from(table)
      .select(col, { count: 'exact', head: true })
      .in(col, ids);
    out[table] = error ? { error: error.message } : { count: count || 0 };
  }
  return out;
}

async function main() {
  if (!SECRET) {
    console.error('N8N_WEBHOOK_SECRET obrigatório');
    process.exit(1);
  }
  const rxUrl = await resolveRxPhotoUrl();
  const created = [];

  for (let i = 0; i < PATIENTS.length; i++) {
    const p = PATIENTS[i];
    const phone = `55118${String(Date.now() + i).slice(-8)}`;
    if (i > 0) await sleep(1500);
    const r = await createViaTriagem(p, phone, rxUrl);
    created.push({ ...p, ...r });
    console.log(`P${p.n} ${p.g} ${r.ok ? 'OK' : 'ERRO'} ${r.atendimentoId || ''} ${r.data?.error || ''}`);
  }

  const ids = created.map((c) => c.atendimentoId).filter(Boolean);
  const tables = await verifySupabase(ids);
  const elig = created.filter((c) => c.g === 'elegivel' && c.ok).length;
  const inelig = created.filter((c) => c.g === 'inelegivel' && c.ok).length;
  const unpaid = created.filter((c) => c.g === 'nao_pago' && c.ok).length;

  console.log(
    JSON.stringify(
      {
        runId: RUN_ID,
        rxUrl,
        created: created.length,
        elegivel: elig,
        inelegivel: inelig,
        nao_pago: unpaid,
        tables,
        ids,
      },
      null,
      2
    )
  );

  const ok = elig === 6 && inelig === 3 && unpaid === 1;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
