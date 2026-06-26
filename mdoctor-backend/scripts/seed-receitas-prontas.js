/**
 * Prepara exatamente 3 pacientes na coluna "Receitas Prontas" para homologação.
 *
 * 1. Limpa atendimentos não-waiting (move para FINISHED)
 * 2. Cria 3 pacientes → waiting
 * 3. Aprova cada um → approved
 * 4. Salva receita com pdfUrl → receita_emitida
 * 5. Valida → ready  (dados_clinicos.memed_receita.validated_at + status ready)
 *
 * Run: node scripts/seed-receitas-prontas.js
 */
require('./load-dotenv');

const BACKEND   = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const SECRET    = 'staging-n8n-webhook-20260528';
const MEDICO_USER = process.env.MEDICO_USER || '';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const DUMMY_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

const WAITING_STATUSES = new Set(['waiting', 'WAITING', 'QUEUE', 'FILA', 'TRIAGED']);

function makeCpf(base9) {
  const d = base9.split('').map(Number);
  let s1 = 0; for (let i = 0; i < 9; i++) s1 += d[i] * (10 - i);
  const v1 = 11 - (s1 % 11); d.push(v1 >= 10 ? 0 : v1);
  let s2 = 0; for (let i = 0; i < 10; i++) s2 += d[i] * (11 - i);
  const v2 = 11 - (s2 % 11); d.push(v2 >= 10 ? 0 : v2);
  return d.join('');
}

const PATIENTS = [
  { nome: 'Homol WA P1 Santos',  cpf: makeCpf('560714823'), med: 'losartana',    dose: '50mg',  freq: '1x ao dia', cond: 'HAS',          sexo: 'M', nasc: '10/04/1965', tel: '11999990001' },
  { nome: 'Homol WA P2 Torres',  cpf: makeCpf('572825934'), med: 'metformina',   dose: '500mg', freq: '2x ao dia', cond: 'DM2',          sexo: 'F', nasc: '22/07/1972', tel: '11999990002' },
  { nome: 'Homol WA P3 Vieira',  cpf: makeCpf('584936045'), med: 'sinvastatina', dose: '20mg',  freq: '1x ao dia', cond: 'dislipidemia', sexo: 'M', nasc: '15/11/1968', tel: '11999990003' },
];

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 400) }; }
  return { status: res.status, ok: res.ok, data };
}

async function login() {
  if (!MEDICO_PASS) throw new Error('MEDICO_PASS não definido');
  const r = await request(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  if (!r.ok || !r.data?.token) throw new Error(`Login falhou HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data.token;
}

async function cleanNonWaiting(token) {
  console.log('\n── Limpeza ──────────────────────────────────');
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const q = await request(`${BACKEND}/api/atendimentos/queue`, { headers: auth });
  if (!q.ok) { console.error(`Erro ao buscar fila: HTTP ${q.status}`); return; }

  const all     = q.data?.atendimentos || [];
  const toClose = all.filter(a => !WAITING_STATUSES.has(a.status));
  console.log(`Total na fila: ${all.length}  |  a fechar: ${toClose.length}`);

  for (const a of toClose) {
    const r = await request(`${BACKEND}/api/atendimentos/${a.id}/status`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ status: 'FINISHED', motivo: 'Limpeza pré-homologação WhatsApp' }),
    });
    const tag = r.ok ? '✓' : '✗';
    console.log(`${tag} ${a.paciente_nome || a.id}  (${a.status} → FINISHED)${r.ok ? '' : '  ERR: ' + JSON.stringify(r.data).slice(0, 120)}`);
  }
}

async function createPatient(p) {
  const body = {
    paciente_nome:     p.nome,
    paciente_cpf:      p.cpf,
    cpf:               p.cpf,
    paciente_telefone: p.tel,
    pagamento_status:  'CONFIRMADO',
    lgpd_accepted: true, privacy_policy_accepted: true,
    telemedicine_consent_accepted: true, non_urgency_notice_accepted: true,
    terms_of_use_accepted: true, accepted_terms_at: new Date().toISOString(),
    dados_clinicos: {
      data_nascimento: p.nasc, sexo: p.sexo,
      doenca_cronica: p.cond, chronic_condition: p.cond.toLowerCase(),
      medication_count: 1,
      medicacao_em_uso: `${p.med} ${p.dose} ${p.freq}`,
      med1_nome: p.med, med1_dose: p.dose, med1_frequencia: p.freq, med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses', sinais_alerta: 'NAO', has_warning_signs: false,
      eligibility_status: 'eligible', has_previous_prescription: true,
      uso_continuo: true, continuous_use_proof: true,
      foto_receita_url: DUMMY_PDF, previous_prescription_file: DUMMY_PDF,
    },
  };
  const r = await request(`${BACKEND}/api/atendimentos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
    body: JSON.stringify(body),
  });
  const id = r.data?.atendimento?.id || r.data?.id;
  if (!r.ok || !id) throw new Error(`create falhou HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return id;
}

async function approve(id, token) {
  const r = await request(`${BACKEND}/api/atendimentos/${id}/clinical/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo: 'Aprovação automática seed homologação' }),
  });
  if (!r.ok) throw new Error(`approve falhou HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
}

async function saveReceipt(id, token) {
  const r = await request(`${BACKEND}/api/memed/receita`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      atendimentoId: id,
      pdfUrl: DUMMY_PDF,
      receitaUrl: DUMMY_PDF,
    }),
  });
  if (!r.ok && r.status !== 409) throw new Error(`receita falhou HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
}

async function validate(id, token) {
  const r = await request(`${BACKEND}/api/atendimentos/${id}/clinical/validate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo: 'Validação automática seed homologação' }),
  });
  if (!r.ok) throw new Error(`validate falhou HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data?.atendimento?.status || r.data?.status;
}

async function main() {
  console.log(`Backend: ${BACKEND}\n`);

  const token = await login();
  console.log('Login OK');

  await cleanNonWaiting(token);

  console.log('\n── Seed 3 pacientes ─────────────────────────');
  const results = [];
  for (const p of PATIENTS) {
    try {
      const id = await createPatient(p);
      await approve(id, token);
      await saveReceipt(id, token);
      const finalStatus = await validate(id, token);
      results.push({ ok: true, id, nome: p.nome, status: finalStatus });
      console.log(`✓ ${p.nome}  →  ${finalStatus}  id=${id}`);
    } catch (e) {
      results.push({ ok: false, nome: p.nome, error: e.message });
      console.error(`✗ ${p.nome}  ERRO: ${e.message}`);
    }
  }

  const prontos = results.filter(r => r.ok && r.status === 'ready');
  console.log('\n── Resultado ────────────────────────────────');
  console.log(`Prontos para homologação: ${prontos.length}/3`);
  console.log(`pdfUrl configurado:       ${DUMMY_PDF}`);
  console.log(`Aptos para WhatsApp:      ${prontos.length === 3 ? 'SIM ✓' : 'VERIFICAR'}`);
  if (prontos.length < 3) {
    console.error('\nALGUNS PACIENTES FALHARAM — verifique os erros acima.');
    process.exit(1);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
