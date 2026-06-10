#!/usr/bin/env node
/**
 * Cria 5 pacientes de teste no status QUEUE (primeira coluna "Fila de Atendimento").
 * Sem approve automático — prontos para teste manual do fluxo Emitir Receita.
 *
 *   node scripts/seed-5-pacientes-fila.js
 */
require('./load-dotenv');

const BACKEND = String(
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');
const MEDICO_USER = process.env.MEDICO_USER || 'drmax.matos';
const MEDICO_PASS = process.env.MEDICO_PASS || '';
const INGRESS_SECRET = process.env.INGRESS_SERVICE_SECRET || process.env.N8N_WEBHOOK_SECRET || '';
const RUN_TAG = `seed-${Date.now()}`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Gera CPF com dígitos verificadores corretos a partir de 9 dígitos base
function cpfFromSeed(nineDigits) {
  const d = Array.from(String(nineDigits).padStart(9, '0')).map(Number);
  let s = 0;
  for (let i = 0; i < 9; i++) s += d[i] * (10 - i);
  const v1 = (s % 11) < 2 ? 0 : 11 - (s % 11);
  d.push(v1);
  s = 0;
  for (let i = 0; i < 10; i++) s += d[i] * (11 - i);
  const v2 = (s % 11) < 2 ? 0 : 11 - (s % 11);
  d.push(v2);
  return d.join('');
}

const PATIENTS = [
  {
    num: 1, nome: 'TESTE FILA A - HIPERTENSAO', sexo: 'F', idade: 45,
    data_nascimento: '10/03/1981', cpfSeed: '987654301',
    condicao: 'Hipertensão arterial (HAS)', conditionCode: 'hipertensao',
    meds: [{ name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' }],
  },
  {
    num: 2, nome: 'TESTE FILA B - DIABETES', sexo: 'M', idade: 52,
    data_nascimento: '22/07/1973', cpfSeed: '987654302',
    condicao: 'Diabetes mellitus tipo 2', conditionCode: 'diabetes_tipo_2',
    meds: [{ name: 'Metformina', dose: '500', unit: 'mg', frequency: '12/12h' }],
  },
  {
    num: 3, nome: 'TESTE FILA C - HIPOTIREOIDISMO', sexo: 'F', idade: 38,
    data_nascimento: '05/11/1987', cpfSeed: '987654303',
    condicao: 'Hipotireoidismo', conditionCode: 'hipotireoidismo',
    meds: [{ name: 'Levotiroxina', dose: '50', unit: 'mcg', frequency: '24h' }],
  },
  {
    num: 4, nome: 'TESTE FILA D - COLESTEROL', sexo: 'M', idade: 30,
    data_nascimento: '18/09/1995', cpfSeed: '987654304',
    condicao: 'Dislipidemia', conditionCode: 'dislipidemia',
    meds: [{ name: 'Sinvastatina', dose: '20', unit: 'mg', frequency: '24h' }],
  },
  {
    num: 5, nome: 'TESTE FILA E - HAS MULTIDROGA', sexo: 'F', idade: 60,
    data_nascimento: '01/01/1965', cpfSeed: '987654305',
    condicao: 'Hipertensão arterial (HAS)', conditionCode: 'hipertensao',
    meds: [
      { name: 'Losartana', dose: '50', unit: 'mg', frequency: '24h' },
      { name: 'Hidroclorotiazida', dose: '25', unit: 'mg', frequency: '24h' },
    ],
  },
];

async function req(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
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

function buildBody(p) {
  const medLabel = p.meds.map((m) => `${m.name} ${m.dose}${m.unit}`).join(' + ');
  const clinical = {
    condition: p.conditionCode,
    doenca_cronica: p.condicao,
    previous_prescription: true,
    continuous_use_proof: true,
    uso_continuo: true,
    tempo_uso: 'Mais de 6 meses',
    continuous_use_days: 365,
    receita_vencida_dias: 30,
    eligibility_status: 'eligible',
    medicacao_em_uso: medLabel,
    medications: p.meds.map((m, i) => ({ index: i + 1, ...m, continuous: true })),
    medication_count: p.meds.length,
    queixa_principal: `Renovação de receita crônica — ${RUN_TAG}`,
    historico_clinico: `Seed de teste Memed — ${RUN_TAG}`,
    foto_receita_url: 'https://example.com/receita-teste.jpg',
    previous_prescription_file: 'https://example.com/receita-teste.jpg',
    paciente_sexo: p.sexo,
    paciente_idade: p.idade,
    data_nascimento: p.data_nascimento,
    flags: [],
    has_warning_signs: false,
    seed_run: RUN_TAG,
  };
  if (p.meds[0]) {
    clinical.primeiro_medicamento = `${p.meds[0].name} ${p.meds[0].dose}${p.meds[0].unit}`;
    clinical.med1_nome = p.meds[0].name;
    clinical.med1_dose = `${p.meds[0].dose}${p.meds[0].unit}`;
  }
  if (p.meds[1]) {
    clinical.segundo_medicamento = `${p.meds[1].name} ${p.meds[1].dose}${p.meds[1].unit}`;
    clinical.med2_nome = p.meds[1].name;
    clinical.med2_dose = `${p.meds[1].dose}${p.meds[1].unit}`;
  }
  return {
    paciente_nome: p.nome,
    paciente_telefone: `+55119900${String(p.num).padStart(5, '0')}`,
    paciente_cpf: cpfFromSeed(p.cpfSeed),
    paciente_email: `teste.fila${p.num}@mdoctor.local`,
    data_nascimento: p.data_nascimento,
    condicao: p.condicao,
    pagamento_status: 'CONFIRMADO',
    status: 'QUEUE',
    dados_clinicos: clinical,
  };
}

async function main() {
  console.log(`\nBackend: ${BACKEND}`);
  console.log(`Run tag: ${RUN_TAG}\n`);

  if (!MEDICO_PASS) { console.error('MEDICO_PASS não definido.'); process.exit(1); }

  const token = await login();
  const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let ok = 0;
  for (const p of PATIENTS) {
    const body = buildBody(p);
    const headers = {
      'Content-Type': 'application/json',
      ...(INGRESS_SECRET ? { 'X-MDoctor-Webhook-Secret': INGRESS_SECRET } : authH),
    };
    const r = await req(`${BACKEND}/api/atendimentos`, { method: 'POST', headers, body: JSON.stringify(body) });
    const id = r.data?.atendimento?.id || r.data?.id || '—';
    if (r.ok && id !== '—') {
      console.log(`✓ P${p.num} ${p.nome} → id: ${id} (CPF: ${body.paciente_cpf})`);
      ok++;
    } else {
      console.error(`✗ P${p.num} ${p.nome} — HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    await sleep(400);
  }

  console.log(`\nCriados: ${ok}/5`);
  if (ok < 5) process.exit(1);
}

main().catch((err) => { console.error('Erro fatal:', err); process.exit(1); });
