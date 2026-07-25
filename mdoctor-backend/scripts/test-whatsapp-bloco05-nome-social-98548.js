require('./load-dotenv');

const PHONE = '5511985485777';
const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');

const BLOCK_NOME_INPUT = 'oq3zsok0c2tdl3qamma8tush';
const BLOCK_CONDICOES_CHOICE = 'b156nm008xh7gb52n7w3egzn';
const NOME_TESTE = 'Maria Teste 98548';

const report = { steps: [], errors: [] };

function step(name, ok, extra = {}) {
  report.steps.push({ name, ok, ...extra });
  if (!ok) report.errors.push(name);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function supabaseFetch(queryPath, { method = 'GET', body = null } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
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

async function getWaSession() {
  const rows = await supabaseFetch(`whatsapp_sessions?phone=eq.${PHONE}&select=id,phone,typebot_session_id,metadata,status&order=updated_at.desc&limit=1`);
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

async function sendWa(text, suffix = '') {
  const id = `wamid.bloco05.${Date.now()}${suffix}`;
  const res = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-bloco05-test',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ profile: { name: 'Teste Bloco05' }, wa_id: PHONE }],
            messages: [{ id, type: 'text', from: PHONE, text: { body: text } }]
          }
        }]
      }]
    })
  });
  return { http: res.status, id };
}

async function waitForExpected(predicate, { tries = 20, delayMs = 2500 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const session = await getWaSession();
    const expected = session?.metadata?.typebot_expected_input_id || null;
    const typebotSessionId = session?.typebot_session_id || null;
    if (predicate(expected, session, typebotSessionId)) {
      return { ok: true, expected, typebotSessionId, session, tries: i + 1 };
    }
    await sleep(delayMs);
  }
  const session = await getWaSession();
  return {
    ok: false,
    expected: session?.metadata?.typebot_expected_input_id || null,
    typebotSessionId: session?.typebot_session_id || null,
    session,
    tries
  };
}

async function main() {
  await resetSession();
  step('sessao_resetada', true);

  await sendWa('Oi', 'a');
  let wait = await waitForExpected((id, _s, tbId) => Boolean(id || tbId));
  step('oi_iniciou_typebot', wait.ok, { expected: wait.expected, tries: wait.tries });

  await sendWa('Iniciar Atendimento', 'b');
  wait = await waitForExpected((id) => id === 'ivbr3o1a7lv8izhfteuerhqx');
  step('chegou_lgpd', wait.ok, { expected: wait.expected, tries: wait.tries });

  await sendWa('Autorizo', 'c');
  wait = await waitForExpected((id) => id === BLOCK_NOME_INPUT);
  step('pergunta_nome_social_sem_idade', wait.ok, { expected: wait.expected, tries: wait.tries });

  await sendWa(NOME_TESTE, 'd');
  wait = await waitForExpected((id) => id === BLOCK_CONDICOES_CHOICE);
  step('apos_nome_vai_condicoes', wait.ok, { expected: wait.expected, tries: wait.tries });

  const ok = report.errors.length === 0;
  console.log(JSON.stringify({ ok, report }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }));
  process.exit(1);
});
