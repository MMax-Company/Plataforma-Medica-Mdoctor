require('./load-dotenv');

const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');

// IDs confirmados no JSON publicado do Typebot higij2z0xihxxkr378rmljgu
const ID = {
  bemVindo: 'sbjZWLJGVkHAkDqS4JQeGow',
  lgpd: 'ivbr3o1a7lv8izhfteuerhqx',
  nomeSocial: 'oq3zsok0c2tdl3qamma8tush',
  condicoes: 'b156nm008xh7gb52n7w3egzn',
  tempoUso: 'r0imrcgaiv1idzkykt891q4u',
  sinaisAlerta: 's5VQGsVF4hQgziQsXVdwPDW',
  telemedicina: 'blk_tele_choice',
  elegibilidade: 'w9v6g0rlkucnfmxc3qh2a2qt',
  nomeCompleto: 'ds9z9lnz3yayokyy8d81fudj',
  nascimento: 'ar8jtu7sa8gfndqeebrvyj15',
  cpf: 'dein7u2qnr8q32p2lv1krd5p',
  whatsapp: 'tbla9w2i2kbeyzun88hai3s9',
  email: 'dwoaqosurlamebpra9yf7pm4',
  cep: 'blk_0oydu2f7',
  endereco: 'q78qjnk6ticwkeifl7xe2rju',
  receitaAnterior: 'blk_receita_choice',
  qtdMedicamentos: 'w97ho902ina4lg7b6dn0sycw',
  med1Nome: 'blk_xp763m78',
  med1Dose: 'blk_n5x21i7c',
  med1Freq: 'blk_yyroio7i',
  med1Via: 'blk_nggi0xs0',
  med2Nome: 'blk_fjhq98ob',
  med2Dose: 'blk_e3e58xjk',
  med2Freq: 'blk_g7zx538s',
  med2Via: 'blk_upxrgzun',
  med3Nome: 'blk_k8s4myef',
  med3Dose: 'blk_g0v3kz80',
  med3Freq: 'blk_mefdgbik',
  med3Via: 'blk_gxda5jr4',
  confirmacao: 'plhspmybxbhylbfbsvqyhlmj'
};

async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }

async function supabaseFetch(queryPath, { method = 'GET', body = null } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${url}/rest/v1/${queryPath}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!res.ok) return { error: await res.text(), status: res.status };
  if (method === 'DELETE') return { ok: true };
  return res.json();
}

function makeClient(phone) {
  async function getWaSession() {
    const rows = await supabaseFetch(`whatsapp_sessions?phone=eq.${phone}&select=id,phone,typebot_session_id,metadata,status&order=updated_at.desc&limit=1`);
    return Array.isArray(rows) ? rows[0] : null;
  }

  async function resetSession() {
    const session = await getWaSession();
    if (!session?.id) return null;
    await supabaseFetch(`whatsapp_sessions?id=eq.${session.id}`, {
      method: 'PATCH',
      body: { typebot_session_id: null, metadata: {} }
    });
    return getWaSession();
  }

  let seq = 0;
  async function sendWa(text) {
    seq += 1;
    const id = `wamid.medfreqvia.${phone}.${Date.now()}.${seq}`;
    const res = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{
          id: 'waba-medfreqvia-test',
          changes: [{
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ profile: { name: 'Teste Medicamentos' }, wa_id: phone }],
              messages: [{ id, type: 'text', from: phone, text: { body: text } }]
            }
          }]
        }]
      })
    });
    return { http: res.status, id };
  }

  async function waitForExpected(predicate, { tries = 6, delayMs = 2000 } = {}) {
    for (let i = 0; i < tries; i += 1) {
      const session = await getWaSession();
      const expected = session?.metadata?.typebot_expected_input_id || null;
      if (predicate(expected, session)) return { ok: true, expected, session, tries: i + 1 };
      await sleep(delayMs);
    }
    const session = await getWaSession();
    return { ok: false, expected: session?.metadata?.typebot_expected_input_id || null, session, tries };
  }

  // envia e espera avançar para o próximo input esperado em UM único toque
  async function tap(text, nextExpectedId, label) {
    await sendWa(text);
    const wait = await waitForExpected((id) => id === nextExpectedId);
    return { label, ok: wait.ok, sent: text, expectedAntes: nextExpectedId, expectedDepois: wait.expected, tries: wait.tries };
  }

  return { getWaSession, resetSession, sendWa, waitForExpected, tap };
}

async function runFlow(medicationCount, phone) {
  const c = makeClient(phone);
  const steps = [];
  function push(r) { steps.push(r); console.log(`  [${r.ok ? 'OK' : 'FALHOU'}] ${r.label} (esperava ${r.expectedAntes || '-'}, obteve ${r.expectedDepois})`); return r; }

  await c.resetSession();

  await c.sendWa('Oi');
  let wait = await c.waitForExpected((id, s) => Boolean(id || s?.typebot_session_id));
  push({ label: 'inicio_typebot', ok: wait.ok, expectedDepois: wait.expected, tries: wait.tries });

  push(await c.tap('1', ID.bemVindo, 'menu_para_bemvindo'));
  push(await c.tap('Vamos começar', ID.lgpd, 'bemvindo_para_lgpd'));
  push(await c.tap('Autorizo', ID.nomeSocial, 'lgpd_para_nome_social'));
  push(await c.tap(`Paciente Teste Med${medicationCount}`, ID.condicoes, 'nome_social_para_condicoes'));
  push(await c.tap('Hipertensão Arterial', ID.tempoUso, 'condicoes_para_tempo_uso'));
  push(await c.tap('Mais de 6 meses', ID.sinaisAlerta, 'tempo_uso_para_sinais_alerta'));
  push(await c.tap('Nenhum desses sinais ou sintomas', ID.sinaisAlerta, 'sinais_alerta_seleciona_nenhum'));
  push(await c.tap('Confirmo', ID.telemedicina, 'sinais_alerta_confirma_para_telemedicina'));
  push(await c.tap('Ciente e continuar', ID.elegibilidade, 'telemedicina_para_elegibilidade'));
  push(await c.tap('Sim', ID.nomeCompleto, 'elegibilidade_para_dados_pessoais'));
  push(await c.tap(`Paciente Teste Medicamento ${medicationCount}`, ID.nascimento, 'nome_completo'));
  push(await c.tap('10/05/1990', ID.cpf, 'nascimento'));
  push(await c.tap('52998224725', ID.whatsapp, 'cpf'));
  push(await c.tap(phone, ID.email, 'whatsapp'));
  push(await c.tap(`teste.med${medicationCount}@example.com`, ID.cep, 'email'));
  push(await c.tap('01310100', ID.endereco, 'cep'));
  push(await c.tap('Avenida Paulista 1000, Bela Vista', ID.receitaAnterior, 'endereco'));
  push(await c.tap('Sim, possuo', ID.qtdMedicamentos, 'receita_anterior_para_qtd_medicamentos'));

  // ===== ETAPA SOB TESTE: quantidade de medicamentos =====
  push(await c.tap(String(medicationCount), ID.med1Nome, 'qtd_medicamentos_para_med1_nome__UM_TOQUE'));

  // ===== Medicamento 1 =====
  push(await c.tap('Losartana', ID.med1Dose, 'med1_nome'));
  push(await c.tap('50 mg', ID.med1Freq, 'med1_dose'));
  push(await c.tap('Uma vez ao dia', ID.med1Via, 'med1_freq__UM_TOQUE'));

  if (medicationCount === 1) {
    push(await c.tap('Via oral', ID.confirmacao, 'med1_via__UM_TOQUE__DIRETO_PARA_RESUMO'));
  } else {
    push(await c.tap('Via oral', ID.med2Nome, 'med1_via__UM_TOQUE__PARA_MED2'));

    // ===== Medicamento 2 =====
    push(await c.tap('Sinvastatina', ID.med2Dose, 'med2_nome'));
    push(await c.tap('20 mg', ID.med2Freq, 'med2_dose'));
    push(await c.tap('Duas vezes ao dia', ID.med2Via, 'med2_freq__UM_TOQUE'));

    if (medicationCount === 2) {
      push(await c.tap('Via sublingual', ID.confirmacao, 'med2_via__UM_TOQUE__DIRETO_PARA_RESUMO'));
    } else {
      push(await c.tap('Via sublingual', ID.med3Nome, 'med2_via__UM_TOQUE__PARA_MED3'));

      // ===== Medicamento 3 =====
      push(await c.tap('Levotiroxina', ID.med3Dose, 'med3_nome'));
      push(await c.tap('75 mcg', ID.med3Freq, 'med3_dose'));
      push(await c.tap('Três vezes ao dia', ID.med3Via, 'med3_freq__UM_TOQUE'));
      push(await c.tap('Via subcutânea', ID.confirmacao, 'med3_via__UM_TOQUE__DIRETO_PARA_RESUMO'));
    }
  }

  const finalSession = await c.getWaSession();
  const ok = steps.every((s) => s.ok);
  return { medicationCount, phone, ok, steps, finalExpected: finalSession?.metadata?.typebot_expected_input_id || null };
}

async function main() {
  const targets = [
    { medicationCount: 1, phone: '5511900010001' },
    { medicationCount: 2, phone: '5511900010002' },
    { medicationCount: 3, phone: '5511900010003' }
  ];
  const results = [];
  for (const target of targets) {
    console.log(`\n=== Rodando fluxo com ${target.medicationCount} medicamento(s) — ${target.phone} ===`);
    const result = await runFlow(target.medicationCount, target.phone);
    results.push(result);
    console.log(JSON.stringify(result, null, 2));
  }
  const allOk = results.every((r) => r.ok);
  console.log('\n=== RESUMO FINAL ===');
  results.forEach((r) => {
    const failed = r.steps.filter((s) => !s.ok);
    console.log(`medication_count=${r.medicationCount} (${r.phone}): ${r.ok ? 'OK' : 'FALHOU'}${failed.length ? ' — falhou em: ' + failed.map((f) => f.label).join(', ') : ''}`);
  });
  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message, stack: error.stack }));
  process.exit(1);
});
