/**
 * Injeta 10 novos pacientes de teste no staging.
 * Prontos para o fluxo: ATENDER → APROVAR → MEMED → EMITIR.
 * Cada paciente tem CPF único gerado matematicamente válido.
 */
require('./load-dotenv');

const BACKEND = (
  process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app'
).replace(/\/$/, '');

const INGRESS_SECRET =
  process.env.INGRESS_SERVICE_SECRET || process.env.N8N_WEBHOOK_SECRET || '';

const MEDICO_USER =
  process.env.MEDICO_USER || process.env.MEDICO_OFFICIAL_USER || 'drmax.matos';
const MEDICO_PASS =
  process.env.MEDICO_PASS || process.env.MEDICO_OFFICIAL_PASS || '';

// Gera CPF matematicamente válido a partir de 9 dígitos base.
function makeCpf(base9) {
  const d = base9.split('').map(Number);

  let s1 = 0;
  for (let i = 0; i < 9; i++) s1 += d[i] * (10 - i);
  const v1 = 11 - (s1 % 11);
  d.push(v1 >= 10 ? 0 : v1);

  let s2 = 0;
  for (let i = 0; i < 10; i++) s2 += d[i] * (11 - i);
  const v2 = 11 - (s2 % 11);
  d.push(v2 >= 10 ? 0 : v2);

  return d.join('');
}

const DUMMY_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

const TEST_PATIENTS = [
  {
    paciente_nome: 'João Carlos Ferreira',
    cpf: makeCpf('015623748'),
    paciente_telefone: '11991230001',
    dados_clinicos: {
      data_nascimento: '14/02/1970',
      sexo: 'M',
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
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Maria das Graças Alves',
    cpf: makeCpf('028374615'),
    paciente_telefone: '21992340002',
    dados_clinicos: {
      data_nascimento: '05/09/1965',
      sexo: 'F',
      medicacao_em_uso: 'Metformina 850mg 2x ao dia',
      doenca_cronica: 'Diabetes Tipo 2',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'metformina',
      med1_dose: '850mg',
      med1_frequencia: '2x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Roberto Silva Santos',
    cpf: makeCpf('034817265'),
    paciente_telefone: '31993450003',
    dados_clinicos: {
      data_nascimento: '20/06/1982',
      sexo: 'M',
      medicacao_em_uso: 'Sinvastatina 20mg 1x ao dia',
      doenca_cronica: 'Dislipidemia',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'sinvastatina',
      med1_dose: '20mg',
      med1_frequencia: '1x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Aparecida Ramos Gomes',
    cpf: makeCpf('046253817'),
    paciente_telefone: '41994560004',
    dados_clinicos: {
      data_nascimento: '30/11/1958',
      sexo: 'F',
      medicacao_em_uso: 'Levotiroxina 50mcg 1x ao dia em jejum',
      doenca_cronica: 'Hipotireoidismo',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'levotiroxina',
      med1_dose: '50mcg',
      med1_frequencia: '1x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Paulo Henrique Mendes',
    cpf: makeCpf('053718426'),
    paciente_telefone: '51995670005',
    dados_clinicos: {
      data_nascimento: '11/04/1975',
      sexo: 'M',
      medicacao_em_uso: 'Enalapril 10mg 1x ao dia',
      doenca_cronica: 'HAS',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'enalapril',
      med1_dose: '10mg',
      med1_frequencia: '1x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Rosangela Pereira Lima',
    cpf: makeCpf('062843751'),
    paciente_telefone: '62996780006',
    dados_clinicos: {
      data_nascimento: '25/08/1989',
      sexo: 'F',
      medicacao_em_uso: 'Losartana 25mg 1x ao dia',
      doenca_cronica: 'HAS',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'losartana',
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
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Antônio Marcos Rodrigues',
    cpf: makeCpf('071263845'),
    paciente_telefone: '71997890007',
    dados_clinicos: {
      data_nascimento: '03/01/1968',
      sexo: 'M',
      medicacao_em_uso: 'Amlodipina 5mg 1x ao dia',
      doenca_cronica: 'HAS',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'amlodipina',
      med1_dose: '5mg',
      med1_frequencia: '1x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Francisca Neves Costa',
    cpf: makeCpf('083752641'),
    paciente_telefone: '81998900008',
    dados_clinicos: {
      data_nascimento: '18/07/1955',
      sexo: 'F',
      medicacao_em_uso: 'Levotiroxina 75mcg 1x ao dia em jejum',
      doenca_cronica: 'Hipotireoidismo',
      chronic_condition: 'hipotireoidismo',
      medication_count: 1,
      med1_nome: 'levotiroxina',
      med1_dose: '75mcg',
      med1_frequencia: '1x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Benedito Almeida Souza',
    cpf: makeCpf('094263758'),
    paciente_telefone: '85999010009',
    dados_clinicos: {
      data_nascimento: '09/12/1980',
      sexo: 'M',
      medicacao_em_uso: 'Glibenclamida 5mg 1x ao dia',
      doenca_cronica: 'Diabetes Tipo 2',
      chronic_condition: 'diabetes',
      medication_count: 1,
      med1_nome: 'glibenclamida',
      med1_dose: '5mg',
      med1_frequencia: '1x ao dia',
      med1_via: 'oral',
      tempo_uso: 'Mais de 6 meses',
      sinais_alerta: 'NAO',
      has_warning_signs: false,
      eligibility_status: 'eligible',
      has_previous_prescription: true,
      uso_continuo: true,
      continuous_use_proof: true,
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
    },
  },
  {
    paciente_nome: 'Luciana Vieira Barbosa',
    cpf: makeCpf('107384265'),
    paciente_telefone: '91990120010',
    dados_clinicos: {
      data_nascimento: '27/03/1993',
      sexo: 'F',
      medicacao_em_uso: 'Hidroclorotiazida 25mg 1x ao dia',
      doenca_cronica: 'HAS',
      chronic_condition: 'has',
      medication_count: 1,
      med1_nome: 'hidroclorotiazida',
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
      foto_receita_url: DUMMY_PDF,
      previous_prescription_file: DUMMY_PDF,
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

async function main() {
  console.log(`\nBackend: ${BACKEND}`);
  console.log(`Ingress secret configurado: ${Boolean(INGRESS_SECRET)}`);
  console.log(`Médico: ${MEDICO_USER}\n`);

  // Print CPFs to help diagnose conflicts
  console.log('CPFs gerados:');
  TEST_PATIENTS.forEach((p) => console.log(`  ${p.paciente_nome}: ${p.cpf}`));
  console.log('');

  const ingressHeaders = {
    'Content-Type': 'application/json',
    ...(INGRESS_SECRET ? { 'X-MDoctor-Webhook-Secret': INGRESS_SECRET } : {}),
  };

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
      console.log(`✓ ${patient.paciente_nome} → id=${id} status=${status} eligible=${eligible}`);
    } else {
      console.error(`✗ Falha: ${patient.paciente_nome} HTTP ${r.status}`, JSON.stringify(r.data).slice(0, 300));
    }
  }

  console.log(`\nCriados: ${created.length}/${TEST_PATIENTS.length}`);

  if (created.length === 0) {
    console.error('Nenhum paciente criado. Verifique INGRESS_SERVICE_SECRET e URL do backend.');
    process.exit(1);
  }

  // Verificar na fila
  console.log('\nVerificando fila (login médico)…');
  const token = await login();
  if (!token) {
    console.warn('Sem token de médico — pulando verificação de fila.');
    console.warn('Defina MEDICO_PASS no .env para verificar automaticamente.');
  } else {
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const queueRes = await req(`${BACKEND}/api/atendimentos/queue`, { headers: authHeaders });

    if (!queueRes.ok) {
      console.error(`Erro ao buscar fila: HTTP ${queueRes.status}`);
    } else {
      const queueIds = new Set((queueRes.data?.atendimentos || []).map((a) => a.id));
      console.log(`\nFila total: ${queueIds.size} atendimento(s)\n`);

      let allVisible = true;
      for (const p of created) {
        const inQueue = queueIds.has(p.id);
        if (!inQueue) allVisible = false;
        console.log(`${inQueue ? '✓' : '✗'} ${p.nome} (${p.id}) — ${inQueue ? 'VISÍVEL' : 'não aparece na fila'}`);
      }

      console.log(allVisible
        ? '\n✓ Todos os pacientes visíveis no painel. Atualize a página para confirmar.'
        : '\n✗ Alguns pacientes não aparecem na fila — verifique status e elegibilidade acima.');
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
