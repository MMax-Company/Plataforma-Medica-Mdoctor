/**
 * Seed 15 pacientes elegíveis para homologação Memed P1→P15.
 * Run: node scripts/seed-homologacao-15.js
 */
const BACKEND = 'https://mdoctor-backend-staging-staging.up.railway.app';
const SECRET  = 'staging-n8n-webhook-20260528';
const DUMMY_PDF = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

function makeCpf(base9) {
  const d = base9.split('').map(Number);
  let s1 = 0;
  for (let i = 0; i < 9; i++) s1 += d[i] * (10 - i);
  const v1 = 11 - (s1 % 11); d.push(v1 >= 10 ? 0 : v1);
  let s2 = 0;
  for (let i = 0; i < 10; i++) s2 += d[i] * (11 - i);
  const v2 = 11 - (s2 % 11); d.push(v2 >= 10 ? 0 : v2);
  return d.join('');
}

// doenca_cronica deve usar os termos reconhecidos pelo normalizeCondition:
// HAS → 'HAS' | DM2 → 'DM2' | DLP → 'dislipidemia' | HIPO → 'hipotireoidismo'
const PATIENTS = [
  { nome: 'Hom P01 Almeida Costa',   cpf: makeCpf('401258369'), med: 'losartana',         dose: '50mg',   freq: '1x ao dia', cond: 'HAS',            sexo: 'M', nasc: '15/03/1962' },
  { nome: 'Hom P02 Barros Lima',     cpf: makeCpf('412369470'), med: 'metformina',         dose: '500mg',  freq: '2x ao dia', cond: 'DM2',            sexo: 'F', nasc: '22/07/1975' },
  { nome: 'Hom P03 Cunha Ramos',     cpf: makeCpf('423470581'), med: 'sinvastatina',       dose: '20mg',   freq: '1x ao dia', cond: 'dislipidemia',   sexo: 'M', nasc: '08/11/1968' },
  { nome: 'Hom P04 Dias Souza',      cpf: makeCpf('434581692'), med: 'atenolol',           dose: '25mg',   freq: '1x ao dia', cond: 'HAS',            sexo: 'F', nasc: '30/04/1980' },
  { nome: 'Hom P05 Esteves Pereira', cpf: makeCpf('445692703'), med: 'levotiroxina',       dose: '25mcg',  freq: '1x ao dia', cond: 'hipotireoidismo', sexo: 'M', nasc: '12/09/1955' },
  { nome: 'Hom P06 Faria Teixeira',  cpf: makeCpf('456703814'), med: 'anlodipino',         dose: '5mg',    freq: '1x ao dia', cond: 'HAS',            sexo: 'F', nasc: '03/06/1971' },
  { nome: 'Hom P07 Gomes Ribeiro',   cpf: makeCpf('467814925'), med: 'levotiroxina',       dose: '50mcg',  freq: '1x ao dia', cond: 'hipotireoidismo', sexo: 'F', nasc: '17/01/1983' },
  { nome: 'Hom P08 Hora Fernandes',  cpf: makeCpf('478925036'), med: 'captopril',          dose: '25mg',   freq: '2x ao dia', cond: 'HAS',            sexo: 'M', nasc: '25/08/1960' },
  { nome: 'Hom P09 Ivo Monteiro',    cpf: makeCpf('489036147'), med: 'glibenclamida',      dose: '5mg',    freq: '1x ao dia', cond: 'DM2',            sexo: 'M', nasc: '14/12/1967' },
  { nome: 'Hom P10 Jesus Carvalho',  cpf: makeCpf('490147258'), med: 'hidroclorotiazida',  dose: '25mg',   freq: '1x ao dia', cond: 'HAS',            sexo: 'F', nasc: '07/05/1978' },
  { nome: 'Hom P11 Klein Oliveira',  cpf: makeCpf('401258370'), med: 'rosuvastatina',      dose: '10mg',   freq: '1x ao dia', cond: 'dislipidemia',   sexo: 'M', nasc: '19/02/1963' },
  { nome: 'Hom P12 Lopes Azevedo',   cpf: makeCpf('412369471'), med: 'metoprolol',         dose: '50mg',   freq: '1x ao dia', cond: 'HAS',            sexo: 'F', nasc: '11/10/1970' },
  { nome: 'Hom P13 Macedo Vieira',   cpf: makeCpf('423470582'), med: 'metformina',         dose: '850mg',  freq: '2x ao dia', cond: 'DM2',            sexo: 'M', nasc: '28/07/1958' },
  { nome: 'Hom P14 Neves Barbosa',   cpf: makeCpf('434581693'), med: 'sinvastatina',       dose: '40mg',   freq: '1x ao dia', cond: 'dislipidemia',   sexo: 'F', nasc: '05/03/1972' },
  { nome: 'Hom P15 Oliveira Duarte', cpf: makeCpf('445692704'), med: 'valsartana',         dose: '80mg',   freq: '1x ao dia', cond: 'HAS',            sexo: 'M', nasc: '23/09/1965' },
];

async function seed() {
  console.log('Seeding 15 homologação patients...\n');
  let ok = 0;
  let fail = 0;
  const ids = [];

  for (const p of PATIENTS) {
    const body = {
      paciente_nome: p.nome,
      paciente_cpf:  p.cpf,
      cpf:           p.cpf,
      paciente_telefone: '11999990000',
      pagamento_status: 'CONFIRMADO',
      lgpd_accepted: true,
      privacy_policy_accepted: true,
      telemedicine_consent_accepted: true,
      non_urgency_notice_accepted: true,
      terms_of_use_accepted: true,
      accepted_terms_at: new Date().toISOString(),
      dados_clinicos: {
        data_nascimento: p.nasc,
        sexo: p.sexo,
        doenca_cronica: p.cond,
        chronic_condition: p.cond.toLowerCase(),
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

    try {
      const r = await fetch(BACKEND + '/api/atendimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MDoctor-Webhook-Secret': SECRET },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      const id       = data.atendimento?.id || data.id;
      const status   = data.atendimento?.status || data.status;
      const eligible = data.atendimento?.elegibilidade?.eligible ?? data.elegibilidade?.eligible;

      if (r.ok && id) {
        ok++;
        ids.push({ num: ok, id, name: p.nome, status, eligible });
        console.log(`✓ ${p.nome}  status=${status}  eligible=${eligible}  id=${id}`);
      } else {
        fail++;
        console.error(`✗ ${p.nome}  HTTP ${r.status}  ${JSON.stringify(data).slice(0, 200)}`);
      }
    } catch (e) {
      fail++;
      console.error(`✗ ${p.nome}  EXCEPTION: ${e.message}`);
    }
  }

  console.log(`\n─── Resultado ───`);
  console.log(`Criados: ${ok}/15  Falhos: ${fail}`);
  console.log(`Todos em waiting: ${ids.every(p => /waiting/i.test(p.status)) ? 'SIM' : 'NÃO'}`);
  console.log(`Todos elegíveis:  ${ids.every(p => p.eligible === true) ? 'SIM' : 'NÃO'}`);
}

seed().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
