/**
 * Prepara pacientes de teste completos para staging.
 * Cria 3 novos atendimentos com todos os campos obrigatórios para emissão de receita Memed.
 */
require('./load-dotenv');

const BACKEND = (
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');

const INGRESS_SECRET =
  process.env.INGRESS_SERVICE_SECRET || process.env.N8N_WEBHOOK_SECRET || '';

const MEDICO_USER =
  process.env.MEDICO_USER || process.env.MEDICO_OFFICIAL_USER || '';
const MEDICO_PASS = process.env.MEDICO_PASS || process.env.MEDICO_OFFICIAL_PASS || '';

// CPFs matematicamente válidos (gerados para teste, não vinculados a pessoas reais)
const TEST_PATIENTS = [
  {
    paciente_nome: 'Ana Maria Souza',
    cpf: '52998224725',
    paciente_telefone: '11987654321',
    condicao: 'HAS',
    dados_clinicos: {
      data_nascimento: '15/03/1985',
      sexo: 'F',
      medicacao_em_uso: 'Losartana 50mg 1x ao dia',
      doenca_cronica: 'HAS',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'losartana',
      med1_dose: '50mg',
      med1_frequencia: '1x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      previous_prescription_file: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    },
  },
  {
    paciente_nome: 'Carlos Eduardo Lima',
    cpf: '12345678909',
    paciente_telefone: '11976543210',
    condicao: 'HAS',
    dados_clinicos: {
      data_nascimento: '22/07/1978',
      sexo: 'M',
      medicacao_em_uso: 'Atenolol 25mg 1x ao dia',
      doenca_cronica: 'HAS',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'atenolol',
      med1_dose: '25mg',
      med1_frequencia: '1x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      previous_prescription_file: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    },
  },
  {
    paciente_nome: 'Fernanda Oliveira Costa',
    cpf: '71428793860',
    paciente_telefone: '11965432109',
    condicao: 'Diabetes Tipo 2',
    dados_clinicos: {
      data_nascimento: '08/11/1992',
      sexo: 'F',
      medicacao_em_uso: 'Metformina 500mg 2x ao dia',
      doenca_cronica: 'Diabetes Tipo 2',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'metformina',
      med1_dose: '500mg',
      med1_frequencia: '2x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
      previous_prescription_file: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    },
  },
];

async function req(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 400) }; }
  return { status: res.status, ok: res.ok, data };
}

async function login() {
  if (!MEDICO_PASS) return null;
  const r = await req(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: MEDICO_USER, password: MEDICO_PASS }),
  });
  return r.data?.token || null;
}

function cpfValid(cpf) {
  const d = String(cpf).replace(/\D/g, '');
  return d.length === 11;
}

async function main() {
  console.log(`\nBackend: ${BACKEND}`);
  console.log(`Ingress secret configurado: ${Boolean(INGRESS_SECRET)}\n`);

  const ingressHeaders = {
    'Content-Type': 'application/json',
    ...(INGRESS_SECRET ? { 'X-MDoctor-Webhook-Secret': INGRESS_SECRET } : {}),
  };

  // ── 1. Criar pacientes ──────────────────────────────────────────────────────
  const created = [];
  for (const patient of TEST_PATIENTS) {
    const payload = {
      ...patient,
      paciente_cpf: patient.cpf,
      pagamento_status: 'CONFIRMADO',
      lgpd_accepted: true,
      privacy_policy_accepted: true,
      telemedicine_consent_accepted: true,
      non_urgency_notice_accepted: true,
      terms_of_use_accepted: true,
      accepted_terms_at: new Date().toISOString(),
    };

    const r = await req(`${BACKEND}/api/atendimentos`, {
      method: 'POST',
      headers: ingressHeaders,
      body: JSON.stringify(payload),
    });

    const id = r.data?.atendimento?.id || r.data?.id || null;
    const status = r.data?.atendimento?.status || r.data?.status || null;
    const eligible = r.data?.atendimento?.elegibilidade?.eligible;

    if (r.ok && id) {
      created.push({ nome: patient.paciente_nome, id, status, eligible });
      console.log(`✓ Criado: ${patient.paciente_nome} → id=${id} status=${status} eligible=${eligible}`);
    } else {
      console.error(`✗ Falha ao criar ${patient.paciente_nome}: HTTP ${r.status}`, JSON.stringify(r.data).slice(0, 200));
    }
  }

  if (created.length === 0) {
    console.error('\nNenhum paciente criado. Verifique credenciais e URL do backend.');
    process.exit(1);
  }

  // ── 2. Verificar na fila (requer login de médico) ───────────────────────────
  console.log('\nFazendo login para verificar fila…');
  const token = await login();
  if (!token) {
    console.warn('MEDICO_PASS não definido — pulando verificação de fila.');
  } else {
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const queueRes = await req(`${BACKEND}/api/atendimentos/queue`, { headers: authHeaders });

    if (!queueRes.ok) {
      console.error(`Erro ao buscar fila: HTTP ${queueRes.status}`);
    } else {
      const queueIds = new Set((queueRes.data?.atendimentos || []).map((a) => a.id));
      console.log(`\nFila contém ${queueIds.size} atendimento(s) visíveis no painel.\n`);

      for (const p of created) {
        const inQueue = queueIds.has(p.id);
        console.log(`${inQueue ? '✓' : '✗'} ${p.nome} (${p.id}) — ${inQueue ? 'VISÍVEL NO PAINEL' : 'NÃO aparece na fila'}`);
      }
    }
  }

  // ── 3. Checklist final ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log('CHECKLIST — PACIENTES CRIADOS PARA TESTE HUMANO');
  console.log('══════════════════════════════════════════════════\n');

  const fields = [
    { key: 'cpf', label: 'CPF válido (11 dígitos)', check: (p) => cpfValid(p.cpf) },
    { key: 'paciente_telefone', label: 'Telefone válido', check: (p) => String(p.paciente_telefone || '').replace(/\D/g,'').length >= 10 },
    { key: 'data_nascimento', label: 'Data de nascimento', check: (p) => Boolean(p.dados_clinicos?.data_nascimento) },
    { key: 'sexo', label: 'Sexo/gênero', check: (p) => ['M','F'].includes(String(p.dados_clinicos?.sexo || '').toUpperCase()) },
    { key: 'medicacao_em_uso', label: 'Medicamento e posologia', check: (p) => Boolean(p.dados_clinicos?.medicacao_em_uso?.trim()) },
    { key: 'foto_receita_url', label: 'Foto receita (visibilidade no painel)', check: (p) => Boolean(p.dados_clinicos?.foto_receita_url) },
  ];

  let allOk = true;
  for (const patient of TEST_PATIENTS) {
    const createdEntry = created.find((c) => c.nome === patient.paciente_nome);
    console.log(`Paciente: ${patient.paciente_nome}`);
    console.log(`  ID: ${createdEntry?.id || '(falha na criação)'}`);
    console.log(`  CPF: ${patient.cpf}`);
    console.log(`  Telefone: ${patient.paciente_telefone}`);
    console.log(`  Data nascimento: ${patient.dados_clinicos.data_nascimento}`);
    console.log(`  Sexo: ${patient.dados_clinicos.sexo}`);
    console.log(`  Medicação: ${patient.dados_clinicos.medicacao_em_uso}`);
    console.log(`  Status: ${createdEntry?.status || '—'}`);
    console.log(`  Elegível: ${createdEntry?.eligible ?? '—'}`);

    for (const f of fields) {
      const ok = f.check(patient);
      if (!ok) allOk = false;
      console.log(`  ${ok ? '✓' : '✗'} ${f.label}`);
    }
    console.log('');
  }

  console.log(allOk ? '✓ Todos os pacientes prontos para teste humano.' : '✗ Alguns campos obrigatórios ausentes — revisar acima.');
  console.log(`\nTotal criados: ${created.length}/${TEST_PATIENTS.length}`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
