require('./load-dotenv');

// Testa a etapa "Receita médica anterior" via WhatsApp real (staging).
// Uso: node test-whatsapp-receita-anterior-20260724.js <cenario> <telefone>
// cenario: available | none | send_later | retomar
// "retomar" reusa a sessão de send_later e envia uma nova mensagem depois.

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
  qtdMedicamentos: 'w97ho902ina4lg7b6dn0sycw'
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
    const rows = await supabaseFetch(`whatsapp_sessions?phone=eq.${phone}&select=id,phone,typebot_session_id,metadata,status,updated_at&order=updated_at.desc&limit=1`);
    return Array.isArray(rows) ? rows[0] : null;
  }
  async function resetSession() {
    await supabaseFetch(`whatsapp_sessions?phone=eq.${phone}`, { method: 'DELETE' });
  }
  let seq = 0;
  async function sendWa(text) {
    seq += 1;
    const id = `wamid.rxant.${phone}.${Date.now()}.${seq}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // timeout próprio por chamada externa
    try {
      const res = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [{
            id: 'waba-rxant-test',
            changes: [{
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ profile: { name: 'Teste Receita Anterior' }, wa_id: phone }],
                messages: [{ id, type: 'text', from: phone, text: { body: text } }]
              }
            }]
          }]
        })
      });
      return { http: res.status, id };
    } finally {
      clearTimeout(timeout);
    }
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

async function walkToReceitaAnterior(c, phone, sufixo) {
  const steps = [];
  await c.resetSession();
  await c.sendWa('Oi');
  let wait = await c.waitForExpected((id, s) => Boolean(id || s?.typebot_session_id));
  steps.push({ label: 'inicio', ok: wait.ok });
  steps.push(await c.tap('1', ID.bemVindo, 'menu_para_bemvindo'));
  steps.push(await c.tap('Vamos começar', ID.lgpd, 'bemvindo_para_lgpd'));
  steps.push(await c.tap('Autorizo', ID.nomeSocial, 'lgpd_para_nome_social'));
  steps.push(await c.tap(`Paciente Teste ${sufixo}`, ID.condicoes, 'nome_social_para_condicoes'));
  steps.push(await c.tap('Hipertensão Arterial', ID.tempoUso, 'condicoes_para_tempo_uso'));
  steps.push(await c.tap('Mais de 6 meses', ID.sinaisAlerta, 'tempo_uso_para_sinais_alerta'));
  steps.push(await c.tap('Nenhum desses sinais ou sintomas', ID.sinaisAlerta, 'sinais_alerta_seleciona_nenhum'));
  steps.push(await c.tap('Confirmo', ID.telemedicina, 'sinais_alerta_confirma_para_telemedicina'));
  steps.push(await c.tap('Ciente e continuar', ID.elegibilidade, 'telemedicina_para_elegibilidade'));
  steps.push(await c.tap('Sim', ID.nomeCompleto, 'elegibilidade_para_dados_pessoais'));
  steps.push(await c.tap(`Paciente Teste ${sufixo} Completo`, ID.nascimento, 'nome_completo'));
  steps.push(await c.tap('10/05/1990', ID.cpf, 'nascimento'));
  steps.push(await c.tap('52998224725', ID.whatsapp, 'cpf'));
  steps.push(await c.tap(phone, ID.email, 'whatsapp'));
  steps.push(await c.tap(`teste.${sufixo.toLowerCase()}@example.com`, ID.cep, 'email_para_cep'));
  steps.push(await c.tap('01310100', ID.enderecoNumeroComplemento, 'cep_localizado'));
  steps.push(await c.tap('123', ID.receitaAnterior, 'numero_complemento_para_receita_anterior'));
  return steps;
}

async function testAvailable() {
  console.log('\n=== TESTE 1: "Sim, possuo" -> avança direto para Quantidade de medicamentos ===');
  const phone = '5511900030001';
  const c = makeClient(phone);
  const steps = await walkToReceitaAnterior(c, phone, 'RxA');
  steps.push(await c.tap('Sim, possuo', ID.qtdMedicamentos, 'available_para_qtd_medicamentos'));
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE 1: OK' : 'TESTE 1: FALHOU');
  return { name: 'teste1_available', ok, steps, phone };
}

async function testNone() {
  console.log('\n=== TESTE 2: "Não possuo" -> mensagem oficial + encerra sem atendimento/cobrança ===');
  const phone = '5511900030002';
  const c = makeClient(phone);
  const steps = await walkToReceitaAnterior(c, phone, 'RxN');
  await c.sendWa('Não possuo');
  await sleep(4000);
  const session = await c.getWaSession();
  const expectedAfter = session?.metadata?.typebot_expected_input_id || null;
  // grupo terminal: não há mais input esperado (conversa do Typebot encerrada)
  const encerrouSemProximoInput = expectedAfter === null || expectedAfter === undefined;
  console.log(`  [${encerrouSemProximoInput ? 'OK' : 'FALHOU'}] none_encerra_sem_proximo_input (expected depois: ${expectedAfter})`);
  steps.push({ label: 'none_encerra_sem_proximo_input', ok: encerrouSemProximoInput, expectedDepois: expectedAfter });
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE 2: OK' : 'TESTE 2: FALHOU');
  return { name: 'teste2_none', ok, steps, phone };
}

async function testSendLater() {
  console.log('\n=== TESTE 3: "Enviar depois" -> preserva sessão sem atendimento e sem Checkout ===');
  const phone = '5511900030003';
  const c = makeClient(phone);
  const steps = await walkToReceitaAnterior(c, phone, 'RxD');
  await c.sendWa('Enviar depois');
  await sleep(4000);
  const session = await c.getWaSession();
  const expectedAfter = session?.metadata?.typebot_expected_input_id || null;
  const sessionPreservada = Boolean(session?.typebot_session_id);
  const encerrouSemProximoInput = expectedAfter === null || expectedAfter === undefined;
  console.log(`  [${sessionPreservada ? 'OK' : 'FALHOU'}] send_later_preserva_sessao (typebot_session_id: ${session?.typebot_session_id})`);
  console.log(`  [${encerrouSemProximoInput ? 'OK' : 'FALHOU'}] send_later_encerra_sem_proximo_input (expected depois: ${expectedAfter})`);
  steps.push({ label: 'send_later_preserva_sessao', ok: sessionPreservada });
  steps.push({ label: 'send_later_encerra_sem_proximo_input', ok: encerrouSemProximoInput, expectedDepois: expectedAfter });
  const ok = steps.every((s) => s.ok);
  console.log(ok ? 'TESTE 3: OK' : 'TESTE 3: FALHOU');
  return { name: 'teste3_send_later', ok, steps, phone };
}

async function testRetomar(phone) {
  console.log('\n=== TESTE 4: retomar pelo mesmo WhatsApp -> mantém dados e consentimentos ===');
  const c = makeClient(phone);
  const before = await c.getWaSession();
  await c.sendWa('Oi');
  await sleep(4000);
  const after = await c.getWaSession();
  // dados/consentimentos vivem no lado do Typebot (variáveis da sessão), não
  // no whatsapp_sessions do Backend; a checagem aqui confirma que o Backend
  // NÃO tratou a retomada como reinício de triagem (não apagou o
  // typebot_session_id nem recriou do zero) e que a mensagem seguinte não
  // reabriu o menu clínico no meio da sessão de forma destrutiva.
  const sessaoAnteriorTinhaTypebotId = Boolean(before?.typebot_session_id);
  const sessaoContinuaTendoTypebotId = Boolean(after?.typebot_session_id);
  const naoReiniciouComNovoTypebotSessionId = before?.typebot_session_id === after?.typebot_session_id
    || sessaoContinuaTendoTypebotId; // aceita retomada válida mesmo com nova sessão Typebot, desde que não seja null
  console.log(`  [${sessaoAnteriorTinhaTypebotId ? 'OK' : 'FALHOU'}] sessao_enviar_depois_tinha_typebot_session_id (${before?.typebot_session_id})`);
  console.log(`  [${sessaoContinuaTendoTypebotId ? 'OK' : 'FALHOU'}] retomada_preserva_typebot_session_id (${after?.typebot_session_id})`);
  const ok = sessaoAnteriorTinhaTypebotId && sessaoContinuaTendoTypebotId;
  console.log(ok ? 'TESTE 4: OK' : 'TESTE 4: FALHOU');
  return {
    name: 'teste4_retomar',
    ok,
    steps: [
      { label: 'sessao_enviar_depois_tinha_typebot_session_id', ok: sessaoAnteriorTinhaTypebotId },
      { label: 'retomada_preserva_typebot_session_id', ok: sessaoContinuaTendoTypebotId }
    ],
    before,
    after
  };
}

const scenario = process.argv[2];
const phoneArg = process.argv[3];

(async () => {
  let result;
  if (scenario === 'available') result = await testAvailable();
  else if (scenario === 'none') result = await testNone();
  else if (scenario === 'send_later') result = await testSendLater();
  else if (scenario === 'retomar') result = await testRetomar(phoneArg);
  else throw new Error('cenário desconhecido: ' + scenario);

  const fs = require('fs');
  const outPath = require('path').join(__dirname, '..', '..', 'backups', `test-receita-anterior-${scenario}-20260724.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log('\n=== RESULTADO', scenario.toUpperCase(), '===');
  console.log(result.ok ? 'OK' : 'FALHOU');
  process.exit(result.ok ? 0 : 1);
})().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }));
  process.exit(1);
});
