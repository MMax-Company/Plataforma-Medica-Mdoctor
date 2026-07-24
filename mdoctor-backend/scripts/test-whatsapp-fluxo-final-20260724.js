require('./load-dotenv');

// Testa LGPD -> Telemedicina -> Termos -> Pagamento via WhatsApp real (staging).
// Uso: node test-whatsapp-fluxo-final-20260724.js <cenario> <telefone>
// cenario: accept_full | lgpd_decline | telemedicina_decline | termos_decline

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
  receitaAnterior: 'blk_receita_choice',
  qtdMedicamentos: 'w97ho902ina4lg7b6dn0sycw',
  med1Nome: 'blk_xp763m78',
  med1Dose: 'blk_n5x21i7c',
  med1Freq: 'blk_yyroio7i',
  med1Via: 'blk_nggi0xs0',
  confirmacao: 'plhspmybxbhylbfbsvqyhlmj',
  termos: 'blk_terms_choice',
  pagamento: 'rapfykn1f1uno89ypqmwi43f'
};

async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }

async function supabaseFetch(queryPath, { method = 'GET', body = null } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${url}/rest/v1/${queryPath}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}) },
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
  async function resetSession() { await supabaseFetch(`whatsapp_sessions?phone=eq.${phone}`, { method: 'DELETE' }); }
  let seq = 0;
  async function sendWa(text) {
    seq += 1;
    const id = `wamid.fluxofinal.${phone}.${Date.now()}.${seq}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba-fluxofinal-test', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts: [{ profile: { name: 'Teste Fluxo Final' }, wa_id: phone }], messages: [{ id, type: 'text', from: phone, text: { body: text } }] } }] }] })
      });
      return { http: res.status, id };
    } finally { clearTimeout(timeout); }
  }
  async function waitForExpected(predicate, { tries = 5, delayMs = 1800 } = {}) {
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

async function walkToLgpd(c, phone, sufixo) {
  const steps = [];
  await c.resetSession();
  await c.sendWa('Oi');
  let wait = await c.waitForExpected((id, s) => Boolean(id || s?.typebot_session_id));
  steps.push({ label: 'inicio', ok: wait.ok });
  steps.push(await c.tap('1', ID.bemVindo, 'menu_para_bemvindo'));
  steps.push(await c.tap('Vamos começar', ID.lgpd, 'bemvindo_para_lgpd_caixa3'));
  return steps;
}

async function walkFromLgpdAcceptToTelemedicina(c, phone, sufixo) {
  const steps = [];
  steps.push(await c.tap('Autorizo', ID.nomeSocial, 'lgpd_autorizo_para_nome_social'));
  steps.push(await c.tap(`Paciente Teste ${sufixo}`, ID.condicoes, 'nome_social_para_condicoes'));
  steps.push(await c.tap('Hipertensão Arterial', ID.tempoUso, 'condicoes_para_tempo_uso'));
  steps.push(await c.tap('Mais de 6 meses', ID.sinaisAlerta, 'tempo_uso_para_sinais_alerta'));
  steps.push(await c.tap('Nenhum desses sinais ou sintomas', ID.sinaisAlerta, 'sinais_alerta_seleciona_nenhum'));
  steps.push(await c.tap('Confirmo', ID.telemedicina, 'sinais_alerta_confirma_para_telemedicina_caixa3'));
  return steps;
}

async function walkFromTelemedicinaAcceptToPayment(c, phone, sufixo) {
  const steps = [];
  steps.push(await c.tap('Ciente e continuar', ID.elegibilidade, 'telemedicina_ciente_para_elegibilidade'));
  steps.push(await c.tap('Sim', ID.nomeCompleto, 'elegibilidade_para_dados_pessoais'));
  steps.push(await c.tap(`Paciente Teste ${sufixo} Completo`, ID.nascimento, 'nome_completo'));
  steps.push(await c.tap('10/05/1990', ID.cpf, 'nascimento'));
  steps.push(await c.tap('52998224725', ID.whatsapp, 'cpf'));
  steps.push(await c.tap(phone, ID.email, 'whatsapp'));
  steps.push(await c.tap(`teste.${sufixo.toLowerCase()}@example.com`, ID.cep, 'email_para_cep'));
  steps.push(await c.tap('01310100', ID.enderecoNumeroComplemento, 'cep_localizado'));
  steps.push(await c.tap('321', ID.receitaAnterior, 'numero_complemento_para_receita_anterior'));
  steps.push(await c.tap('Sim, possuo', ID.qtdMedicamentos, 'receita_anterior_para_qtd_medicamentos'));
  steps.push(await c.tap('1', ID.med1Nome, 'qtd_medicamentos_1'));
  steps.push(await c.tap('Losartana', ID.med1Dose, 'med1_nome'));
  steps.push(await c.tap('50 mg', ID.med1Freq, 'med1_dose'));
  steps.push(await c.tap('Uma vez ao dia', ID.med1Via, 'med1_freq'));
  steps.push(await c.tap('Via oral', ID.confirmacao, 'med1_via_para_resumo'));
  steps.push(await c.tap('Sim, estão corretos', ID.termos, 'resumo_para_termos'));
  return steps;
}

async function testAcceptFull() {
  console.log('\n=== TESTE 1+2+3 (aceite): LGPD 3 caixas -> Telemedicina 3 caixas -> Termos -> Pagamento (1 Checkout R$69,90) ===');
  const phone = '5511900040001';
  const c = makeClient(phone);
  let steps = await walkToLgpd(c, phone, 'Fluxo1');
  steps = steps.concat(await walkFromLgpdAcceptToTelemedicina(c, phone, 'Fluxo1'));
  steps = steps.concat(await walkFromTelemedicinaAcceptToPayment(c, phone, 'Fluxo1'));
  steps.push(await c.tap('Li e concordo', ID.pagamento, 'termos_aceito_para_pagamento'));
  await sleep(4000);
  const session = await c.getWaSession();
  const payment = session?.metadata?.typebot_payment || null;
  const temCheckout = Boolean(payment?.checkout_session_id);
  const valorCorreto = payment?.amount_cents === 6990 || payment?.amount_label === 'R$ 69,90';
  console.log(`  [${temCheckout ? 'OK' : 'FALHOU'}] checkout_criado (checkout_session_id: ${payment?.checkout_session_id})`);
  console.log(`  [${valorCorreto ? 'OK' : 'FALHOU'}] valor_correto (amount_cents: ${payment?.amount_cents}, amount_label: ${payment?.amount_label})`);
  steps.push({ label: 'checkout_criado', ok: temCheckout });
  steps.push({ label: 'valor_correto', ok: valorCorreto });
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE ACCEPT_FULL: OK' : 'TESTE ACCEPT_FULL: FALHOU');
  return { name: 'accept_full', ok, steps, phone, payment };
}

async function testLgpdDecline() {
  console.log('\n=== TESTE 2 (recusa LGPD): encerra sem cobrança ===');
  const phone = '5511900040002';
  const c = makeClient(phone);
  const steps = await walkToLgpd(c, phone, 'LgpdDecline');
  await c.sendWa('Não autorizo');
  await sleep(4000);
  const session = await c.getWaSession();
  const expectedAfter = session?.metadata?.typebot_expected_input_id || null;
  const encerrou = expectedAfter === null || expectedAfter === undefined;
  console.log(`  [${encerrou ? 'OK' : 'FALHOU'}] lgpd_recusa_encerra (expected depois: ${expectedAfter})`);
  steps.push({ label: 'lgpd_recusa_encerra', ok: encerrou });
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE LGPD_DECLINE: OK' : 'TESTE LGPD_DECLINE: FALHOU');
  return { name: 'lgpd_decline', ok, steps, phone };
}

async function testTelemedicinaDecline() {
  console.log('\n=== TESTE 2 (recusa Telemedicina): encerra sem cobrança ===');
  const phone = '5511900040003';
  const c = makeClient(phone);
  let steps = await walkToLgpd(c, phone, 'TeleDecline');
  steps = steps.concat(await walkFromLgpdAcceptToTelemedicina(c, phone, 'TeleDecline'));
  await c.sendWa('Não continuar');
  await sleep(4000);
  const session = await c.getWaSession();
  const expectedAfter = session?.metadata?.typebot_expected_input_id || null;
  const encerrou = expectedAfter === null || expectedAfter === undefined;
  console.log(`  [${encerrou ? 'OK' : 'FALHOU'}] telemedicina_recusa_encerra (expected depois: ${expectedAfter})`);
  steps.push({ label: 'telemedicina_recusa_encerra', ok: encerrou });
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE TELEMEDICINA_DECLINE: OK' : 'TESTE TELEMEDICINA_DECLINE: FALHOU');
  return { name: 'telemedicina_decline', ok, steps, phone };
}

async function testTermosDecline() {
  console.log('\n=== TESTE 3 (recusa Termos): não cria Checkout ===');
  const phone = '5511900040004';
  const c = makeClient(phone);
  let steps = await walkToLgpd(c, phone, 'TermosDecline');
  steps = steps.concat(await walkFromLgpdAcceptToTelemedicina(c, phone, 'TermosDecline'));
  steps = steps.concat(await walkFromTelemedicinaAcceptToPayment(c, phone, 'TermosDecline'));
  await c.sendWa('Não concordo');
  await sleep(4000);
  const session = await c.getWaSession();
  const payment = session?.metadata?.typebot_payment || null;
  const semCheckout = !payment?.checkout_session_id;
  console.log(`  [${semCheckout ? 'OK' : 'FALHOU'}] termos_recusa_sem_checkout (checkout_session_id: ${payment?.checkout_session_id})`);
  steps.push({ label: 'termos_recusa_sem_checkout', ok: semCheckout });
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE TERMOS_DECLINE: OK' : 'TESTE TERMOS_DECLINE: FALHOU');
  return { name: 'termos_decline', ok, steps, phone };
}

const scenario = process.argv[2];

(async () => {
  let result;
  if (scenario === 'accept_full') result = await testAcceptFull();
  else if (scenario === 'lgpd_decline') result = await testLgpdDecline();
  else if (scenario === 'telemedicina_decline') result = await testTelemedicinaDecline();
  else if (scenario === 'termos_decline') result = await testTermosDecline();
  else throw new Error('cenário desconhecido: ' + scenario);

  const fs = require('fs');
  fs.writeFileSync(require('path').join(__dirname, '..', '..', 'backups', `test-fluxo-final-${scenario}-20260724.json`), JSON.stringify(result, null, 2));
  console.log('\n=== RESULTADO', scenario.toUpperCase(), '===', result.ok ? 'OK' : 'FALHOU');
  process.exit(result.ok ? 0 : 1);
})().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }));
  process.exit(1);
});
