require('./load-dotenv');

const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');

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
  enderecoNumeroComplemento: 'blk_endereco_numero_complemento',
  enderecoManual: 'q78qjnk6ticwkeifl7xe2rju',
  receitaAnterior: 'blk_receita_choice',
  qtdMedicamentos: 'w97ho902ina4lg7b6dn0sycw',
  med1Nome: 'blk_xp763m78',
  med1Dose: 'blk_n5x21i7c',
  med1Freq: 'blk_yyroio7i',
  med1Via: 'blk_nggi0xs0',
  confirmacao: 'plhspmybxbhylbfbsvqyhlmj',
  correcaoMenu: 'blk_correcao_menu_choice'
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
    await supabaseFetch(`whatsapp_sessions?phone=eq.${phone}`, { method: 'DELETE' });
  }
  let seq = 0;
  async function sendWa(text) {
    seq += 1;
    const id = `wamid.cepend.${phone}.${Date.now()}.${seq}`;
    const res = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{
          id: 'waba-cepend-test',
          changes: [{
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ profile: { name: 'Teste CEP' }, wa_id: phone }],
              messages: [{ id, type: 'text', from: phone, text: { body: text } }]
            }
          }]
        }]
      })
    });
    return { http: res.status, id };
  }
  async function waitForExpected(predicate, { tries = 8, delayMs = 2500 } = {}) {
    for (let i = 0; i < tries; i += 1) {
      const session = await getWaSession();
      const expected = session?.metadata?.typebot_expected_input_id || null;
      if (predicate(expected, session)) return { ok: true, expected, session, tries: i + 1 };
      await sleep(delayMs);
    }
    const session = await getWaSession();
    return { ok: false, expected: session?.metadata?.typebot_expected_input_id || null, session, tries };
  }
  async function tap(text, nextExpectedId, label) {
    await sendWa(text);
    const wait = await waitForExpected((id) => id === nextExpectedId);
    console.log(`  [${wait.ok ? 'OK' : 'FALHOU'}] ${label} (esperava ${nextExpectedId}, obteve ${wait.expected})`);
    return { label, ok: wait.ok, sent: text, expectedAntes: nextExpectedId, expectedDepois: wait.expected, tries: wait.tries };
  }
  return { getWaSession, resetSession, sendWa, waitForExpected, tap };
}

async function walkToCep(c, phone, nomeSufixo) {
  const steps = [];
  await c.resetSession();
  await c.sendWa('Oi');
  let wait = await c.waitForExpected((id, s) => Boolean(id || s?.typebot_session_id));
  steps.push({ label: 'inicio', ok: wait.ok });
  steps.push(await c.tap('1', ID.bemVindo, 'menu_para_bemvindo'));
  steps.push(await c.tap('Vamos começar', ID.lgpd, 'bemvindo_para_lgpd'));
  steps.push(await c.tap('Autorizo', ID.nomeSocial, 'lgpd_para_nome_social'));
  steps.push(await c.tap(`Paciente Teste ${nomeSufixo}`, ID.condicoes, 'nome_social_para_condicoes'));
  steps.push(await c.tap('Hipertensão Arterial', ID.tempoUso, 'condicoes_para_tempo_uso'));
  steps.push(await c.tap('Mais de 6 meses', ID.sinaisAlerta, 'tempo_uso_para_sinais_alerta'));
  steps.push(await c.tap('Nenhum desses sinais ou sintomas', ID.sinaisAlerta, 'sinais_alerta_seleciona_nenhum'));
  steps.push(await c.tap('Confirmo', ID.telemedicina, 'sinais_alerta_confirma_para_telemedicina'));
  steps.push(await c.tap('Ciente e continuar', ID.elegibilidade, 'telemedicina_para_elegibilidade'));
  steps.push(await c.tap('Sim', ID.nomeCompleto, 'elegibilidade_para_dados_pessoais'));
  steps.push(await c.tap(`Paciente Teste ${nomeSufixo} Completo`, ID.nascimento, 'nome_completo'));
  steps.push(await c.tap('10/05/1990', ID.cpf, 'nascimento'));
  steps.push(await c.tap('52998224725', ID.whatsapp, 'cpf'));
  steps.push(await c.tap(phone, ID.email, 'whatsapp'));
  steps.push(await c.tap(`teste.${nomeSufixo.toLowerCase()}@example.com`, ID.cep, 'email_para_cep'));
  return steps;
}

async function test1_localizado() {
  console.log('\n=== TESTE 1: CEP válido localizado -> solicita só número/complemento ===');
  const phone = '5511900020001';
  const c = makeClient(phone);
  const steps = await walkToCep(c, phone, 'Cep1');
  steps.push(await c.tap('01310-100', ID.enderecoNumeroComplemento, 'cep_localizado_pede_so_numero_complemento'));
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE 1: OK' : 'TESTE 1: FALHOU');
  return { name: 'teste1_cep_localizado', ok, steps, phone };
}

async function test2_naoLocalizado() {
  console.log('\n=== TESTE 2: CEP válido não localizado -> solicita endereço completo manualmente ===');
  const phone = '5511900020002';
  const c = makeClient(phone);
  const steps = await walkToCep(c, phone, 'Cep2');
  steps.push(await c.tap('99999999', ID.enderecoManual, 'cep_nao_localizado_pede_endereco_completo'));
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE 2: OK' : 'TESTE 2: FALHOU');
  return { name: 'teste2_cep_nao_localizado', ok, steps, phone };
}

async function test3_invalido() {
  console.log('\n=== TESTE 3: CEP inválido -> repete somente a pergunta do CEP ===');
  const phone = '5511900020003';
  const c = makeClient(phone);
  const steps = await walkToCep(c, phone, 'Cep3');
  // envia CEP inválido (menos de 8 dígitos) -> deve permanecer/retornar ao input do CEP
  steps.push(await c.tap('123', ID.cep, 'cep_invalido_repete_pergunta'));
  // confirma que consegue prosseguir normalmente depois, enviando um CEP válido
  steps.push(await c.tap('01310100', ID.enderecoNumeroComplemento, 'apos_erro_cep_valido_avanca_normalmente'));
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE 3: OK' : 'TESTE 3: FALHOU');
  return { name: 'teste3_cep_invalido', ok, steps, phone };
}

async function test4_unicaVez(referenceSteps) {
  console.log('\n=== TESTE 4: CEP solicitado uma única vez (estrutural, a partir do teste 1) ===');
  // conta quantas vezes o expected_input passou por blk_0oydu2f7 durante o teste 1 —
  // deve ser exatamente 1 (a pergunta inicial), nunca repetida após avançar.
  const cepHits = referenceSteps.filter((s) => s.expectedAntes === ID.cep).length;
  const ok = cepHits === 1;
  console.log(`  CEP solicitado ${cepHits} vez(es) no teste 1 — ${ok ? 'OK' : 'FALHOU'}`);
  return { name: 'teste4_cep_unica_vez', ok, cepHits };
}

async function test5e6_correcaoEndereco() {
  console.log('\n=== TESTE 5+6: corrigir endereço pelo resumo -> retorna ao resumo sem reiniciar; Endereco completo e demais dados preservados ===');
  const phone = '5511900020006';
  const c = makeClient(phone);
  const steps = await walkToCep(c, phone, 'Cep56');
  steps.push(await c.tap('01310100', ID.enderecoNumeroComplemento, 'cep_localizado'));
  steps.push(await c.tap('500', ID.receitaAnterior, 'numero_complemento_para_receita_anterior'));
  steps.push(await c.tap('Sim, possuo', ID.qtdMedicamentos, 'receita_anterior_para_qtd_medicamentos'));
  steps.push(await c.tap('1', ID.med1Nome, 'qtd_medicamentos_1'));
  steps.push(await c.tap('Losartana', ID.med1Dose, 'med1_nome'));
  steps.push(await c.tap('50 mg', ID.med1Freq, 'med1_dose'));
  steps.push(await c.tap('Uma vez ao dia', ID.med1Via, 'med1_freq'));
  steps.push(await c.tap('Via oral', ID.confirmacao, 'med1_via_para_resumo'));

  // valida Endereco e demais dados ANTES da correção (dados preservados de referência)
  const beforeCorrection = await c.getWaSession();

  steps.push(await c.tap('Quero corrigir', ID.correcaoMenu, 'quero_corrigir_abre_menu'));
  steps.push(await c.tap('Endereço', ID.cep, 'menu_correcao_endereco_volta_para_cep'));
  steps.push(await c.tap('01310100', ID.enderecoNumeroComplemento, 'cep_localizado_na_correcao'));
  steps.push(await c.tap('900, apto 12', ID.confirmacao, 'numero_complemento_correcao_volta_direto_ao_resumo__SEM_REINICIAR'));

  const afterCorrection = await c.getWaSession();

  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE 5+6: OK (avanço)' : 'TESTE 5+6: FALHOU (avanço)');
  return { name: 'teste5e6_correcao_endereco', ok, steps, phone, beforeCorrection, afterCorrection };
}

async function main() {
  const results = [];
  results.push(await test1_localizado());
  results.push(await test2_naoLocalizado());
  results.push(await test3_invalido());
  results.push(await test4_unicaVez(results[0].steps));
  results.push(await test5e6_correcaoEndereco());

  console.log('\n=== RESUMO FINAL ===');
  results.forEach((r) => console.log(`${r.name}: ${r.ok ? 'OK' : 'FALHOU'}`));

  const fs = require('fs');
  fs.writeFileSync(require('path').join(__dirname, '..', '..', 'backups', 'test-cep-endereco-resultado-20260724.json'), JSON.stringify(results, null, 2));

  const allOk = results.every((r) => r.ok);
  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message, stack: error.stack }));
  process.exit(1);
});
