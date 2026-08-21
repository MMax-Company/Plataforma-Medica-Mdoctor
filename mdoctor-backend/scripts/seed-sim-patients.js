/**
 * Seeds 3 fresh test patients for the Playwright simulation.
 * Run: node scripts/seed-sim-patients.js
 */
const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';
const SECRET = 'staging-n8n-webhook-20260528';
const DUMMY_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

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

const PATIENTS = [
  { nome: 'Teste Sim P4 Carvalho', cpf: makeCpf('312947586'), med: 'losartana',    dose: '50mg',  freq: '1x ao dia'  },
  { nome: 'Teste Sim P5 Andrade',  cpf: makeCpf('324058697'), med: 'metformina',   dose: '500mg', freq: '2x ao dia'  },
  { nome: 'Teste Sim P6 Nunes',    cpf: makeCpf('336169708'), med: 'sinvastatina', dose: '20mg',  freq: '1x ao dia'  },
];

async function seed() {
  console.log('Seeding 3 simulation patients...\n');
  const ids = [];

  for (const p of PATIENTS) {
    const body = {
      paciente_nome: p.nome,
      paciente_cpf:  p.cpf,
      cpf:           p.cpf,
      paciente_telefone: '11999999999',
      pagamento_status: 'CONFIRMADO',
      lgpd_accepted: true,
      privacy_policy_accepted: true,
      telemedicine_consent_accepted: true,
      non_urgency_notice_accepted: true,
      terms_of_use_accepted: true,
      accepted_terms_at: new Date().toISOString(),
      dados_clinicos: {
        data_nascimento: '01/01/1970',
        sexo: 'M',
        doenca_cronica: 'HAS',
        chronic_condition: 'has',
        medication_count: 1,
        medicacao_em_uso: `${p.med} ${p.dose} ${p.freq}`,
        med1_nome: p.med,
        med1_dose: p.dose,
        med1_frequencia: p.freq,
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
    };

    const r = await fetch(BACKEND + '/api/atendimentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    const id      = data.atendimento?.id || data.id;
    const status  = data.atendimento?.status || data.status;
    const eligible = data.atendimento?.elegibilidade?.eligible ?? data.elegibilidade?.eligible;

    if (r.ok && id) {
      ids.push({ id, name: p.nome });
      console.log(`OK  ${p.nome}`);
      console.log(`    id=${id}  status=${status}  eligible=${eligible}`);
    } else {
      console.error(`ERR ${p.nome}  HTTP ${r.status}  ${JSON.stringify(data).slice(0, 200)}`);
    }
  }

  console.log('\n--- IDs for simulate-3-patients.mjs ---');
  ids.forEach((p, i) => console.log(`P${i + 1}: { id: '${p.id}', name: '${p.name}' }`));
}

seed().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
