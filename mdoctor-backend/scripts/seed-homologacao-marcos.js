/**
 * Seed do paciente de teste para homologação ponta a ponta do Doctor Prescreve.
 * Dados exatos fornecidos por Cláudio para o teste real Painel → Memed → Backend → WhatsApp.
 * Run: node scripts/seed-homologacao-marcos.js
 */
const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';
const SECRET  = 'staging-n8n-webhook-20260528';
const DUMMY_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

const body = {
  paciente_nome: 'Marcos da Serra Mar',
  paciente_cpf: '01739134150',
  cpf: '01739134150',
  paciente_telefone: '11968123900',
  cep: '01200101',
  pagamento_status: 'CONFIRMADO',
  lgpd_accepted: true,
  privacy_policy_accepted: true,
  telemedicine_consent_accepted: true,
  non_urgency_notice_accepted: true,
  terms_of_use_accepted: true,
  accepted_terms_at: new Date().toISOString(),
  dados_clinicos: {
    data_nascimento: '09/02/1988',
    sexo: 'M',
    doenca_cronica: 'HAS',
    chronic_condition: 'has',
    diagnosticos: 'HAS, Dislipidemia',
    medication_count: 3,
    medicacao_em_uso: 'Captopril 25mg 12/12h; Enalapril 5mg pela manhã; Hidroclorotiazida 25mg pela manhã',
    med1_nome: 'Captopril',
    med1_dose: '25mg',
    med1_frequencia: 'a cada 12 horas',
    med1_via: 'oral',
    med2_nome: 'Enalapril',
    med2_dose: '5mg',
    med2_frequencia: '1x ao dia pela manhã',
    med2_via: 'oral',
    med3_nome: 'Hidroclorotiazida',
    med3_dose: '25mg',
    med3_frequencia: '1x ao dia pela manhã',
    med3_via: 'oral',
    tempo_uso: 'Mais de 6 meses',
    sinais_alerta: 'NAO',
    has_warning_signs: false,
    eligibility_status: 'eligible',
    has_previous_prescription: true,
    uso_continuo: true,
    continuous_use_proof: true,
    foto_receita_url: DUMMY_PDF,
    previous_prescription_file: DUMMY_PDF,
    data_ultima_receita: '15/06/2026',
    receita_vencida_dias: 18,
  },
};

async function seed() {
  console.log('Seeding paciente de homologação: Marcos da Serra Mar\n');
  const r = await fetch(BACKEND + '/api/atendimentos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  console.log(`HTTP ${r.status}`);
  console.log(JSON.stringify(data, null, 2));

  const id       = data.atendimento?.id || data.id;
  const status   = data.atendimento?.status || data.status;
  const eligible = data.atendimento?.elegibilidade?.eligible ?? data.elegibilidade?.eligible;

  console.log('\n─── Resultado ───');
  console.log(`id=${id}  status=${status}  eligible=${eligible}`);
}

seed().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
