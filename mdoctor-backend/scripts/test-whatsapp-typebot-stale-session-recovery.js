// Regressão do incidente real (09/09/2026, 08:45 BRT): o backend guardava um
// typebot_session_id que o Typebot runtime já não reconhecia mais
// ("Session not found" no continueChat). O erro subia sem tratamento
// específico até o catch genérico de whatsapp.routes.js, que só loga —
// nenhuma resposta era enviada ao paciente. Ver diagnóstico com evidências de
// log entregue antes desta correção.
//
// Este arquivo cobre o cenário pedido na autorização da correção:
//   A. backend contém sessionId inexistente no Typebot;
//   B. paciente envia "Oi";
//   C. Typebot retorna "Session not found";
//   D. backend limpa apenas o estado transitório inválido (nunca
//      paciente/atendimento/pagamento/receita/consentimento/histórico);
//   E. paciente recebe resposta útil (menu inicial, ou a regra de retomada já
//      existente quando ela reivindica a mensagem);
//   F. nenhuma duplicidade de sessão Typebot (uma única chamada ao Typebot,
//      nunca um continueChat repetido nem um startChat automático);
//   G. o processamento termina como "processed" (o webhook em si sempre
//      responde 200 de forma síncrona, antes deste processamento assíncrono
//      — ver whatsapp.routes.js — o que este teste garante é que o
//      processamento assíncrono não fica mais sem resposta ao paciente).
// Também cobre: sessão Typebot válida continua funcionando normalmente
// (nenhuma regressão no caminho feliz do continueChat).

const assert = require('assert');
const { createTypebotWhatsAppBridge } = require('../src/services/typebot-whatsapp.bridge');
const { MENU_TEXT, MENU_CTA, MENU_STATE_AWAITING_CHOICE } = require('../src/services/whatsapp-support.service');

process.env.TYPEBOT_VIEWER_URL = 'https://viewer.example.test';
process.env.TYPEBOT_PUBLIC_ID = 'doctor-prescreve-8rmljgu';
process.env.TYPEBOT_RETRY_ATTEMPTS = '4';
process.env.TYPEBOT_RETRY_BASE_DELAY_MS = '300';
process.env.TYPEBOT_RETRY_MAX_DELAY_MS = '2500';

const uploadBridgeMocks = {
  findPendingUploadContext: async () => null,
  findUploadContextForPhone: async () => null,
  persistUploadContext: async () => {},
  uploadContextFromSession: () => null,
  augmentOutputsWithUploadLink: (outputs) => outputs,
  responseLooksLikeUploadStage: () => false,
  isUploadChoiceInput: () => false,
  isUploadConfirmationText: () => false,
  getUploadStatus: async () => ({ upload_completed: false })
};

function sessionNotFoundError() {
  return Object.assign(new Error('Session not found'), { code: 'TYPEBOT_RUNTIME_ERROR', status: 404 });
}

async function main() {
  const identity = { phone: '5511945328724', bsuid: null };

  // ---------------------------------------------------------------------
  // Cenário 1 (A-G): sem regra de retomada aplicável -> cai no menu inicial.
  // ---------------------------------------------------------------------
  const sent = [];
  const finishes = [];
  const clearCalls = [];
  const persistCalls = [];
  const typebotCalls = [];
  const receipts = new Set();
  let storedSession = { id: 'wa-stale-1', typebot_session_id: 'stale-session-abc', metadata: { typebot_expected_input_id: 'rapfykn1f1uno89ypqmwi43f' } };

  const bridge = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    claimMetaMessage: async ({ messageId }) => {
      if (receipts.has(messageId)) return { claimed: false };
      receipts.add(messageId);
      return { claimed: true };
    },
    finishMetaMessage: async (row) => finishes.push(row),
    setTypebotSessionId: async () => {},
    reloadSession: async () => storedSession,
    persistExpectedInput: async (args) => { persistCalls.push(args); },
    createIntegrationError: async () => {},
    clearTypebotSession: async ({ sessionId }) => {
      clearCalls.push(sessionId);
      storedSession = { id: storedSession.id, typebot_session_id: null, metadata: {} };
      return storedSession;
    },
    // Simula a regra real: sessão com typebot_session_id é dona da conversa
    // (ver isActiveTypebotFlow); depois de limpa, "Oi" cai no menu, igual ao
    // comportamento real de resolveMetaInboundRouting para uma saudação sem
    // nenhum contexto de retomada.
    resolveMetaInboundRouting: async ({ session }) => {
      if (session?.typebot_session_id) return { handled: false, action: 'typebot' };
      return { handled: true, action: 'reply', reply: MENU_TEXT, cta: MENU_CTA };
    },
    callTypebot: async (path) => {
      typebotCalls.push(path);
      if (path.includes('/continueChat')) throw sessionNotFoundError();
      return { sessionId: 'novo-session', messages: [], input: { id: 'choice-1', type: 'choice input', items: [] } };
    },
    provider: {
      sendTextMessage: async (payload) => { sent.push({ kind: 'text', payload }); return { providerMessageId: `msg-${sent.length}` }; },
      sendButtonMessage: async (payload) => { sent.push({ kind: 'buttons', payload }); return { providerMessageId: `msg-${sent.length}` }; },
      sendListMessage: async (payload) => { sent.push({ kind: 'list', payload }); return { providerMessageId: `msg-${sent.length}` }; },
      sendCtaUrlMessage: async (payload) => { sent.push({ kind: 'cta', payload }); return { providerMessageId: `msg-${sent.length}` }; }
    }
  });

  const result = await bridge({
    messageId: 'wamid-stale-oi',
    text: 'Oi',
    identity,
    whatsappSession: { id: 'wa-stale-1', typebot_session_id: 'stale-session-abc' }
  });

  // B/C: a mensagem foi processada (não ficou presa) e o backend reconheceu
  // a sessão como residual, não como falha fatal.
  assert.equal(result.duplicate, false, 'a mensagem original não pode ser tratada como duplicada');
  assert.equal(result.staleSessionRecovered, true, 'o resultado deve sinalizar recuperação de sessão residual');

  // D: só o estado transitório do Typebot foi limpo (clearTypebotSession),
  // exatamente uma vez, para a sessão certa — nada de paciente/atendimento/
  // pagamento/receita foi tocado por este fluxo (os mocks acima não expõem
  // nenhuma tabela dessas; a única escrita é clearTypebotSession +
  // persistExpectedInput, ambos escopados a whatsapp_sessions).
  assert.deepEqual(clearCalls, ['wa-stale-1'], 'deve limpar a sessão do Typebot exatamente uma vez, para o telefone certo');

  // E: paciente recebe o menu inicial oficial (1 - Iniciar atendimento / 2 - Suporte).
  assert.equal(sent.length, 1, 'o paciente deve receber exatamente uma resposta útil');
  assert.equal(sent[0].kind, 'cta', 'o menu inicial vai como botão CTA (mesmo caminho já usado pela saudação normal)');
  assert.equal(sent[0].payload.body, MENU_TEXT);
  assert.equal(sent[0].payload.url, MENU_CTA.url);
  assert(
    persistCalls.some((c) => c.extraMetadataPatch?.whatsapp_menu_state === MENU_STATE_AWAITING_CHOICE),
    'deve gravar whatsapp_menu_state=awaiting_menu_choice, igual a uma saudação normal, para "1"/"2" serem entendidos na próxima mensagem'
  );

  // F: nenhuma duplicidade de sessão Typebot — a única chamada ao Typebot
  // nesta mensagem foi o continueChat que falhou; NENHUM startChat
  // automático foi disparado por trás do paciente.
  assert.deepEqual(typebotCalls, [`/sessions/stale-session-abc/continueChat`], 'não pode haver segunda chamada ao Typebot (nem continueChat repetido, nem startChat automático)');

  // G: processamento terminou como "processed" (nunca "failed"/silencioso).
  assert.deepEqual(finishes.map((f) => f.status), ['processed']);

  // Requisito 6 (idempotência): a mesma entrega da Meta (mesmo messageId) não
  // dispara um segundo processamento nem uma segunda mensagem ao paciente.
  const duplicateResult = await bridge({
    messageId: 'wamid-stale-oi',
    text: 'Oi',
    identity,
    whatsappSession: { id: 'wa-stale-1', typebot_session_id: null }
  });
  assert.equal(duplicateResult.duplicate, true, 'reentrega do mesmo messageId deve ser tratada como duplicata, sem reprocessar');
  assert.equal(sent.length, 1, 'reentrega não pode gerar uma segunda mensagem ao paciente');

  // Continuidade: com a sessão já limpa, uma mensagem NOVA do paciente ("1")
  // segue o fluxo normal (menu -> typebot_clean -> startChat), provando que a
  // conversa não fica travada depois da recuperação.
  const continued = await bridge({
    messageId: 'wamid-stale-start',
    text: '1',
    identity,
    whatsappSession: { id: 'wa-stale-1', typebot_session_id: null }
  });
  assert.equal(continued.duplicate, false);

  // ---------------------------------------------------------------------
  // Cenário 2: existe uma regra de retomada já existente (ex.: ticket de
  // suporte em aberto) — a recuperação deve USAR essa regra em vez de
  // sempre forçar o menu genérico, e não deve criar atendimento/sessão
  // nova por conta própria.
  // ---------------------------------------------------------------------
  const sent2 = [];
  const clearCalls2 = [];
  const persistCalls2 = [];
  const typebotCalls2 = [];
  let storedSession2 = { id: 'wa-stale-2', typebot_session_id: 'stale-session-xyz', metadata: {} };

  const bridge2 = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    reloadSession: async () => storedSession2,
    persistExpectedInput: async (args) => { persistCalls2.push(args); },
    createIntegrationError: async () => {},
    clearTypebotSession: async ({ sessionId }) => {
      clearCalls2.push(sessionId);
      storedSession2 = { id: storedSession2.id, typebot_session_id: null, metadata: {} };
      return storedSession2;
    },
    resolveMetaInboundRouting: async ({ session }) => {
      if (session?.typebot_session_id) return { handled: false, action: 'typebot' };
      // Regra já existente de retomada (ex.: paciente com pendência de
      // suporte em aberto no mesmo telefone) — não é o menu genérico.
      return { handled: true, action: 'reply', reply: 'Você já tem um atendimento aguardando nossa equipe de suporte.' };
    },
    callTypebot: async (path) => {
      typebotCalls2.push(path);
      throw sessionNotFoundError();
    },
    provider: {
      sendTextMessage: async (payload) => { sent2.push({ kind: 'text', payload }); return { providerMessageId: `s2-${sent2.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({}),
      sendCtaUrlMessage: async (payload) => { sent2.push({ kind: 'cta', payload }); return { providerMessageId: `s2-${sent2.length}` }; }
    }
  });

  const result2 = await bridge2({
    messageId: 'wamid-stale-support',
    text: 'oi',
    identity,
    whatsappSession: { id: 'wa-stale-2', typebot_session_id: 'stale-session-xyz' }
  });
  assert.equal(result2.staleSessionRecovered, true);
  assert.deepEqual(clearCalls2, ['wa-stale-2']);
  assert.equal(sent2.length, 1);
  assert.equal(sent2[0].kind, 'text');
  assert.equal(sent2[0].payload.text, 'Você já tem um atendimento aguardando nossa equipe de suporte.', 'deve usar a resposta da regra de retomada já existente, não o menu genérico');
  assert.equal(
    persistCalls2.some((c) => c.extraMetadataPatch?.whatsapp_menu_state === MENU_STATE_AWAITING_CHOICE),
    false,
    'quando a regra de retomada já respondeu, não deve forçar o estado de menu por cima'
  );
  assert.deepEqual(typebotCalls2, ['/sessions/stale-session-xyz/continueChat'], 'não deve chamar o Typebot de novo quando a retomada já resolveu por texto');

  // ---------------------------------------------------------------------
  // Cenário 3 (não-regressão): sessão Typebot VÁLIDA — continueChat continua
  // funcionando normalmente, sem passar pela recuperação.
  // ---------------------------------------------------------------------
  const sent3 = [];
  let clearCalled3 = false;
  const bridge3 = createTypebotWhatsAppBridge({
    ...uploadBridgeMocks,
    resolveMetaInboundRouting: async () => ({ handled: false, action: 'typebot' }),
    claimMetaMessage: async () => ({ claimed: true }),
    finishMetaMessage: async () => {},
    setTypebotSessionId: async () => {},
    clearTypebotSession: async () => { clearCalled3 = true; return null; },
    reloadSession: async ({ whatsappSession }) => ({
      ...whatsappSession,
      typebot_session_id: 'sessao-valida-123',
      metadata: { typebot_expected_input_id: 'blk_qualquer' }
    }),
    persistExpectedInput: async () => {},
    createIntegrationError: async () => {},
    callTypebot: async (path) => {
      assert(path.includes('/sessions/sessao-valida-123/continueChat'));
      return { messages: [{ type: 'text', content: { plainText: 'Sessão continuada normalmente.' } }] };
    },
    provider: {
      sendTextMessage: async (payload) => { sent3.push(payload); return { providerMessageId: `s3-${sent3.length}` }; },
      sendButtonMessage: async () => ({}),
      sendListMessage: async () => ({})
    }
  });
  const result3 = await bridge3({
    messageId: 'wamid-valid-1',
    text: 'Continuar',
    identity,
    whatsappSession: { id: 'wa-valid', typebot_session_id: 'sessao-valida-123' }
  });
  assert.equal(result3.duplicate, false);
  assert.equal(result3.staleSessionRecovered, undefined, 'sessão válida não deve acionar a recuperação');
  assert.equal(result3.sessionIdReused, true);
  assert.equal(clearCalled3, false, 'sessão válida não deve ter seu estado limpo');
  assert.equal(sent3[0].text, 'Sessão continuada normalmente.');

  console.log(JSON.stringify({
    staleSessionFallsBackToMenu: 'ok',
    staleSessionClearsOnlyTransientState: 'ok',
    staleSessionNeverCallsTypebotTwice: 'ok',
    staleSessionMetaRedeliveryIsIdempotent: 'ok',
    staleSessionUsesExistingResumeRuleWhenAvailable: 'ok',
    validSessionContinueChatUnaffected: 'ok'
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });
