// Teste isolado (sem rede, sem banco) do tratamento específico de sessão
// obsoleta parada no choice input "Vamos começar" (grupo Bem-Vindo).
// Incidente 2026-07-21: sessão parada nesse input + "1" era encaminhada via
// continueChat, e o próprio Typebot respondia "Invalid message. Please, try
// again." (o texto "1" não é uma resposta válida para aquele choice input).
// Injeta stubs no require.cache das dependências de banco ANTES de carregar
// whatsapp-support.service.js, para exercitar a função real.
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'whatsapp-support.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

stub(resolveFrom('../store/atendimentos.store'), {
  STATUS: { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento' },
  createAtendimento: async (row) => ({ id: 'atd-mock', ...row }),
  listAtendimentos: async () => [],
  getAtendimento: async () => null,
  updateAtendimentoStatus: async () => ({})
});
stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
stub(resolveFrom('./clinical-persistence.service'), { recordSupportTicket: async () => {} });
stub(resolveFrom('./post-delivery-survey.service'), { handleSurveyInbound: async () => ({ handled: false }) });
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  getActiveSurveySession: () => null,
  getSessionByPhone: async () => null
});

const supportServicePath = require.resolve(base);
delete require.cache[supportServicePath];
const support = require(base);

const WELCOME_CHOICE_INPUT_ID = 'sbjZWLJGVkHAkDqS4JQeGow';

async function main() {
  const results = {};

  // 1) Sessão obsoleta parada em "Vamos começar" + "1" -> considera obsoleta,
  //    reinicia via typebot_clean (não encaminha "1" como resposta ao choice).
  const staleWelcomeSession = {
    typebot_session_id: 'sess-stale-welcome',
    metadata: { typebot_expected_input_id: WELCOME_CHOICE_INPUT_ID }
  };
  const r1 = await support.resolveMetaInboundRouting({ phone: '5511999990001', text: '1', session: staleWelcomeSession });
  assert.equal(r1.handled, true, '"1" com sessão obsoleta em Vamos começar deveria ser tratado (handled:true)');
  assert.equal(r1.action, 'typebot_clean', '"1" com sessão obsoleta em Vamos começar deveria reiniciar (typebot_clean)');
  results.sessaoObsoletaVamosComecarMais1RetornaTypebotClean = 'ok';

  // 2) Mesma sessão obsoleta + "2" -> direciona ao suporte, sem passar pelo
  //    choice input "Vamos começar" e sem virar typebot_clean.
  const r2 = await support.resolveMetaInboundRouting({ phone: '5511999990002', text: '2', session: staleWelcomeSession });
  assert.equal(r2.handled, true);
  assert.notEqual(r2.action, 'typebot_clean', '"2" não deveria reiniciar o Typebot');
  assert.equal(r2.action, 'reply');
  assert.equal(r2.reply, support.SUPPORT_WAITING_TEXT, '"2" com sessão obsoleta em Vamos começar deveria ir para o suporte');
  results.sessaoObsoletaVamosComecarMais2VaiParaSuporte = 'ok';

  // 3) Sessão ativa em OUTRO input (não é o choice do Bem-Vindo) + "1" deve
  //    continuar indo para o Typebot via continueChat (comportamento
  //    inalterado) — a correção é restrita ao input "Vamos começar".
  const activeOtherInputSession = {
    typebot_session_id: 'sess-abc',
    metadata: { typebot_expected_input_id: 'blk_algum_input' }
  };
  const r3 = await support.resolveMetaInboundRouting({ phone: '5511999990003', text: '1', session: activeOtherInputSession });
  assert.equal(r3.handled, false, '"1" durante fluxo ativo em outro input deveria manter continueChat (handled:false)');
  assert.equal(r3.action, 'typebot');
  results.sessaoAtivaOutroInputMais1MantemContinueChat = 'ok';

  // 4) Mesmo em "Vamos começar", texto que NÃO é "1"/"2" (ex.: a própria
  //    resposta legítima do choice) continua indo para o Typebot — "1"/"2"
  //    não viram comando global, só esse caso específico é tratado.
  const r4 = await support.resolveMetaInboundRouting({ phone: '5511999990004', text: 'Vamos começar', session: staleWelcomeSession });
  assert.equal(r4.handled, false, 'Resposta legítima ao choice "Vamos começar" deveria continuar indo ao Typebot');
  assert.equal(r4.action, 'typebot');
  results.respostaLegitimaVamosComecarMantemTypebot = 'ok';

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
