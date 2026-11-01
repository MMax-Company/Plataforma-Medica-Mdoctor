// Correção da revisão da etapa 3/6 (PR #106): comprova o "ponto de não
// retorno" após continueChat — falhas posteriores (contexto de upload,
// entrega WhatsApp) nunca revertem flow_resumed nem provocam uma segunda
// retomada do Typebot — e a recuperação segura de respostas ambíguas
// (timeout) e de falhas de entrega (reenvio controlado). Testes isolados
// (sem rede/Stripe/banco/Meta reais); nenhuma mensagem real é enviada.
const assert = require('assert');
const {
  completePaymentByToken,
  redeliverPendingPaymentMessages
} = require('../src/services/typebot-payment-link.service');

function makeSession(overrides = {}) {
  return {
    id: 'wa-session-recovery-1',
    phone: '5511999990002',
    bsuid: null,
    metadata: {
      typebot_payment: {
        token: 'tok-recovery',
        payment_status: 'paid',
        status: 'completed',
        checkout_session_id: 'cs_test_recovery',
        typebot_session_id: 'typebot-sess-recovery',
        amount_cents: 4990,
        amount_label: 'R$ 49,90',
        flow_resumed: false,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        ...overrides
      }
    }
  };
}

// Simula o claim atômico de claimPaymentFlowResume: só permite uma
// retomada enquanto "resumed" não tiver sido marcado.
function makeClaimTracker() {
  const state = { resumed: false, calls: 0 };
  return {
    state,
    claimFlowResume: async () => {
      state.calls += 1;
      if (state.resumed) return false;
      state.resumed = true;
      return true;
    }
  };
}

async function main() {
  const results = {};

  // 1) continueChat com sucesso + falha posterior no contexto de upload
  //    (persistência auxiliar): não reverte, não relança, e uma reentrega
  //    do webhook não provoca segunda retomada.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    const typebotCalls = [];
    let revertCalls = 0;
    const persisted = [];
    const deps = {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      revertFlowResume: async () => { revertCalls += 1; },
      persistPaymentRecord: async (s, patch) => { persisted.push(patch); return patch; },
      callTypebot: async (path, body) => { typebotCalls.push({ path, body }); return { input: { id: 'grp_final' }, messages: [] }; },
      convertTypebotResponse: () => [],
      provider: { sendTextMessage: async () => ({ providerMessageId: 'm-1' }) },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {},
      uploadHelpers: {
        responseLooksLikeUploadStage: () => true,
        findUploadContextForPhone: async () => { throw new Error('lookup indisponível'); },
        persistUploadContext: async () => {}
      }
    };

    const result1 = await completePaymentByToken('tok-recovery', { session, ...deps });
    assert.equal(result1.ok, true, 'falha de contexto de upload não propaga erro');
    assert.equal(typebotCalls.length, 1, 'continueChat chamado exatamente uma vez');
    assert.equal(revertCalls, 0, 'retomada confirmada não pode ser desfeita por falha posterior');

    // Reentrega do mesmo webhook (claim já usado): não chama continueChat de novo.
    const result2 = await completePaymentByToken('tok-recovery', { session, ...deps });
    assert.equal(result2.ok, true);
    assert.equal(result2.alreadyCompleted, true);
    assert.equal(typebotCalls.length, 1, 'reentrega não provoca segunda retomada');
    assert.equal(tracker.state.calls, 2);
    results.continueChatSucessoComFalhaPosteriorNaoRetomaDeNovo = 'ok';
  }

  // 2) Falha de entrega pela Meta (rejeição HTTP síncrona, ex.: token
  //     expirado/inválido — classificada failed_safe_to_retry): pagamento e
  //     retomada preservados, estado por mensagem persistido, e reenvio
  //     controlado depois entrega sem chamar continueChat de novo.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    const typebotCalls = [];
    let revertCalls = 0;
    let persistedPatch = null;
    const deps = {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      revertFlowResume: async () => { revertCalls += 1; },
      persistPaymentRecord: async (s, patch) => { persistedPatch = patch; return patch; },
      callTypebot: async (path, body) => {
        typebotCalls.push({ path, body });
        return { input: { id: 'grp_final' }, messages: [{ type: 'text', content: { plainText: 'Seu atendimento foi enviado para avaliação médica.' } }] };
      },
      convertTypebotResponse: (typebot) => (typebot.messages || []).map((m) => ({ kind: 'text', text: m.content.plainText })),
      // providerStatus presente = a Meta respondeu de forma síncrona com
      // rejeição (ex.: 401 por token expirado) — comprovadamente não
      // aceita/enfileirada, portanto failed_safe_to_retry, não ambígua.
      provider: { sendTextMessage: async () => { const e = new Error('Authentication Error'); e.code = 190; e.providerStatus = 401; throw e; } },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    };

    const result = await completePaymentByToken('tok-recovery', { session, ...deps });
    assert.equal(result.ok, true, 'falha de entrega não propaga erro');
    assert.equal(result.deliveryFailed, true);
    assert.equal(typebotCalls.length, 1);
    assert.equal(revertCalls, 0, 'falha de entrega não desfaz a retomada');
    assert(persistedPatch, 'estado de entrega falhada deve ser persistido');
    assert.equal(persistedPatch.delivery_failed, true);
    assert.equal(Array.isArray(persistedPatch.message_deliveries), true);
    assert.equal(persistedPatch.message_deliveries.length, 1);
    assert.equal(persistedPatch.message_deliveries[0].status, 'failed_safe_to_retry', 'rejeição HTTP síncrona da Meta é comprovadamente não enviada');
    assert.equal(persistedPatch.message_deliveries[0].providerMessageId, null);

    // Reenvio controlado: usa os registros pendentes, nunca chama continueChat.
    const redeliverySession = makeSession({
      flow_resumed: true,
      delivery_failed: true,
      delivery_correlation_id: 'typebot-payment-cs_test_recovery',
      message_deliveries: persistedPatch.message_deliveries
    });
    const sentOnRedelivery = [];
    let redeliveryPersisted = null;
    const redeliverResult = await redeliverPendingPaymentMessages('tok-recovery', {
      session: redeliverySession,
      claimRedeliveryAttempt: async () => true,
      provider: { sendTextMessage: async (payload) => { sentOnRedelivery.push(payload); return { providerMessageId: 'm-redelivery-1' }; } },
      persistPaymentRecord: async (s, patch) => { redeliveryPersisted = patch; return patch; },
      createIntegrationError: async () => {}
    });
    assert.equal(redeliverResult.ok, true);
    assert.equal(redeliverResult.responsesSent, 1);
    assert.equal(sentOnRedelivery.length, 1);
    assert.equal(sentOnRedelivery[0].idempotencyKey, persistedPatch.message_deliveries[0].key);
    assert.equal(redeliveryPersisted.delivery_failed, false);
    assert.equal(redeliveryPersisted.message_deliveries[0].status, 'sent');
    assert.equal(typebotCalls.length, 1, 'reenvio nunca chama continueChat de novo — sessão já retomada é preservada');
    results.falhaDeEntregaPreservaPagamentoERetomadaEPermiteReenvio = 'ok';
  }

  // 3) Reentrega do webhook Stripe (camada completePaymentByToken): mesmo
  //    token processado duas vezes não duplica retomada nem mensagens.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    const typebotCalls = [];
    const sent = [];
    const deps = {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      persistPaymentRecord: async (s, patch) => patch,
      callTypebot: async (path, body) => { typebotCalls.push({ path, body }); return { input: {}, messages: [] }; },
      convertTypebotResponse: () => [],
      provider: { sendTextMessage: async (p) => { sent.push(p); return { providerMessageId: `m-${sent.length}` }; } },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    };
    await completePaymentByToken('tok-recovery', { session, ...deps });
    await completePaymentByToken('tok-recovery', { session, ...deps });
    await completePaymentByToken('tok-recovery', { session, ...deps });
    assert.equal(typebotCalls.length, 1, 'três reentregas do mesmo evento, uma única retomada');
    assert.equal(sent.length, 0);
    results.reentregaRepetidaDoWebhookNaoDuplicaRetomada = 'ok';
  }

  // 4a) Falha local comprovada ANTES de enviar a requisicao:
  //     configuracao ausente reverte e permite nova tentativa.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    let revertCalls = 0;
    const err = new Error('TYPEBOT_VIEWER_URL nao configurada');
    err.code = 'TYPEBOT_NOT_CONFIGURED';
    const deps = {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      revertFlowResume: async () => { revertCalls += 1; tracker.state.resumed = false; },
      callTypebot: async () => { throw err; },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    };
    await assert.rejects(() => completePaymentByToken('tok-recovery', { session, ...deps }), /nao configurada/);
    assert.equal(revertCalls, 1, 'falha clara desfaz a reivindicação');

    // Nova tentativa (ex.: reentrega do webhook) agora é permitida.
    const typebotCalls = [];
    const result2 = await completePaymentByToken('tok-recovery', {
      session,
      ...deps,
      callTypebot: async (path, body) => { typebotCalls.push({ path, body }); return { input: {}, messages: [] }; }
    });
    assert.equal(result2.ok, true);
    assert.equal(typebotCalls.length, 1, 'após falha clara, nova tentativa chama o Typebot normalmente');
    results.falhaClaraAntesDaConfirmacaoPermiteNovaTentativa = 'ok';
  }

  // 4b) Resposta AMBÍGUA (timeout) antes da confirmação de continueChat:
  //     não reverte (não sabemos se o Typebot já processou), marca para
  //     reconciliação, e uma reentrega do webhook NÃO tenta retomar de
  //     novo (sem segunda chamada ao continueChat).
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    let revertCalls = 0;
    let persistedPatch = null;
    const err = new Error('Timeout na chamada ao Typebot');
    err.code = 'TYPEBOT_TIMEOUT';
    const deps = {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      revertFlowResume: async () => { revertCalls += 1; },
      persistPaymentRecord: async (s, patch) => { persistedPatch = patch; return patch; },
      callTypebot: async () => { throw err; },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    };
    await assert.rejects(() => completePaymentByToken('tok-recovery', { session, ...deps }), /Timeout/);
    assert.equal(revertCalls, 0, 'resposta ambígua NÃO desfaz a reivindicação de retomada');
    assert(persistedPatch, 'estado ambíguo deve ser persistido para reconciliação');
    assert.equal(persistedPatch.continue_chat_ambiguous, true);

    // Reentrega do webhook: claim permanece tomado (tracker.state.resumed
    // nunca voltou a false) — nenhuma segunda chamada ao Typebot.
    const typebotCalls = [];
    const result2 = await completePaymentByToken('tok-recovery', {
      session,
      ...deps,
      callTypebot: async (path, body) => { typebotCalls.push({ path, body }); return { input: {}, messages: [] }; }
    });
    assert.equal(result2.ok, true);
    assert.equal(result2.alreadyCompleted, true);
    assert.equal(typebotCalls.length, 0, 'estado ambíguo nunca permite uma segunda retomada automática');
    results.respostaAmbiguaNaoRevertEMasImpedeSegundaRetomada = 'ok';
  }

  // 5) Erro de transporte, erro HTTP 5xx e erros desconhecidos sao ambiguos:
  //    o servidor pode ter processado continueChat antes de falhar.
  for (const code of ['TYPEBOT_FETCH_FAILED', 'TYPEBOT_RUNTIME_ERROR', 'UNEXPECTED_ERROR']) {
    const session = makeSession();
    const tracker = makeClaimTracker();
    const persisted = [];
    let revertCalls = 0;
    let calls = 0;
    const error = Object.assign(new Error('falha potencialmente pos-envio'), { code, status: 503 });
    const deps = {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      revertFlowResume: async () => { revertCalls++; tracker.state.resumed = false; },
      persistPaymentRecord: async (_s, patch) => { persisted.push(patch); },
      callTypebot: async () => { calls++; throw error; },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    };
    await assert.rejects(() => completePaymentByToken('tok-recovery', { session, ...deps }), /pos-envio/);
    assert.equal(revertCalls, 0, code + ': claim nao deve ser revertido');
    assert(persisted.some(p => p.continue_chat_ambiguous === true), code + ': reconciliacao obrigatoria');
    const retry = await completePaymentByToken('tok-recovery', {
      session, ...deps, callTypebot: async () => { calls++; return { input: {}, messages: [] }; }
    });
    assert.equal(retry.alreadyCompleted, true, code + ': nao retomar automaticamente');
    assert.equal(calls, 1, code + ': exatamente uma chamada');
  }
  results.falhasDeRedeEHttpNaoDuplicamRetomada = 'ok';

  // --- Ponto 2 da revisão da etapa 3/6: rastreamento por mensagem e ---
  // --- reenvio controlado (a Meta não garante dedup por Idempotency-Key) ---

  function makeDeliveryEntry(overrides = {}) {
    return {
      index: 0,
      output: { kind: 'text', text: 'Seu atendimento foi enviado para avaliação médica.' },
      key: 'typebot-payment-cs_test_recovery:0',
      status: 'pending',
      providerMessageId: null,
      attempts: 0,
      lastError: null,
      updatedAt: new Date().toISOString(),
      ...overrides
    };
  }

  // 6) Envio já confirmado com providerMessageId: reenvio bloqueado.
  {
    const session = makeSession({
      flow_resumed: true,
      delivery_failed: false,
      delivery_correlation_id: 'typebot-payment-cs_test_recovery',
      message_deliveries: [makeDeliveryEntry({ status: 'sent', providerMessageId: 'm-already-sent', attempts: 1 })]
    });
    const sent = [];
    const result = await redeliverPendingPaymentMessages('tok-recovery', {
      session,
      provider: { sendTextMessage: async (p) => { sent.push(p); return { providerMessageId: 'm-should-not-happen' }; } },
      persistPaymentRecord: async (s, patch) => patch,
      createIntegrationError: async () => {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.nothingToRedeliver, true, 'nada elegível quando a única mensagem já está sent');
    assert.equal(sent.length, 0, 'mensagem confirmada nunca é reenviada');
    results.envioConfirmadoBloqueiaReenvio = 'ok';
  }

  // 7) Falha comprovadamente anterior ao envio (failed_safe_to_retry):
  //    reenvio permitido e mensagem passa a sent.
  {
    const session = makeSession({
      flow_resumed: true,
      delivery_failed: true,
      delivery_correlation_id: 'typebot-payment-cs_test_recovery',
      message_deliveries: [makeDeliveryEntry({ status: 'failed_safe_to_retry', lastError: 'Falha Meta WhatsApp Cloud API sendMessage (401)' })]
    });
    const sent = [];
    let persisted = null;
    const result = await redeliverPendingPaymentMessages('tok-recovery', {
      session,
      claimRedeliveryAttempt: async () => true,
      provider: { sendTextMessage: async (p) => { sent.push(p); return { providerMessageId: 'm-recovered-1' }; } },
      persistPaymentRecord: async (s, patch) => { persisted = patch; return patch; },
      createIntegrationError: async () => {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.responsesSent, 1);
    assert.equal(sent.length, 1, 'falha comprovadamente anterior ao envio permite reenvio');
    assert.equal(persisted.message_deliveries[0].status, 'sent');
    assert.equal(persisted.message_deliveries[0].providerMessageId, 'm-recovered-1');
    results.falhaClaraAntesDoEnvioPermiteReenvio = 'ok';
  }

  // 8) Timeout após possível aceitação pela Meta (ambíguo, sem HTTP status
  //    de rejeição): reenvio automático bloqueado, mesmo após reentrega.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    let persistedPatch = null;
    const timeoutError = Object.assign(new Error('Timeout na chamada Meta WhatsApp Cloud API'), { code: 'PROVIDER_TIMEOUT' });
    const result = await completePaymentByToken('tok-recovery', {
      session,
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      persistPaymentRecord: async (s, patch) => { persistedPatch = patch; return patch; },
      callTypebot: async () => ({ input: { id: 'grp_final' }, messages: [{ type: 'text', content: { plainText: 'Pagamento confirmado.' } }] }),
      convertTypebotResponse: (typebot) => (typebot.messages || []).map((m) => ({ kind: 'text', text: m.content.plainText })),
      provider: { sendTextMessage: async () => { throw timeoutError; } },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.deliveryFailed, true);
    assert.equal(persistedPatch.message_deliveries[0].status, 'unknown', 'timeout sem rejeição HTTP explícita é ambíguo');

    const redeliverySession = makeSession({
      flow_resumed: true,
      delivery_failed: true,
      delivery_correlation_id: 'typebot-payment-cs_test_recovery',
      message_deliveries: persistedPatch.message_deliveries
    });
    const sentOnRedelivery = [];
    const redeliverResult = await redeliverPendingPaymentMessages('tok-recovery', {
      session: redeliverySession,
      provider: { sendTextMessage: async (p) => { sentOnRedelivery.push(p); return { providerMessageId: 'm-x' }; } },
      persistPaymentRecord: async (s, patch) => patch,
      createIntegrationError: async () => {}
    });
    assert.equal(redeliverResult.ok, true);
    assert.equal(redeliverResult.nothingToRedeliver, true, 'resultado ambíguo nunca é reenviado automaticamente');
    assert.equal(sentOnRedelivery.length, 0);
    results.timeoutAmbiguoBloqueiaReenvioAutomatico = 'ok';
  }

  // 9) Dois outputs no mesmo pagamento: um confirmado, outro não enviado —
  //    o reenvio recupera SOMENTE o segundo, sem repetir o primeiro.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    let persistedPatch = null;
    const sentFirstAttempt = [];
    const httpRejection = Object.assign(new Error('Falha Meta WhatsApp Cloud API sendMessage (401)'), { code: 131042, providerStatus: 401 });
    const result = await completePaymentByToken('tok-recovery', {
      session,
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      persistPaymentRecord: async (s, patch) => { persistedPatch = patch; return patch; },
      callTypebot: async () => ({
        input: { id: 'grp_final' },
        messages: [
          { type: 'text', content: { plainText: 'Pagamento confirmado.' } },
          { type: 'text', content: { plainText: 'Aguarde o contato do médico.' } }
        ]
      }),
      convertTypebotResponse: (typebot) => (typebot.messages || []).map((m) => ({ kind: 'text', text: m.content.plainText })),
      provider: {
        sendTextMessage: async (p) => {
          sentFirstAttempt.push(p);
          if (sentFirstAttempt.length === 1) return { providerMessageId: 'm-first-ok' };
          throw httpRejection;
        }
      },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.deliveryFailed, true);
    assert.equal(persistedPatch.message_deliveries.length, 2);
    assert.equal(persistedPatch.message_deliveries[0].status, 'sent');
    assert.equal(persistedPatch.message_deliveries[1].status, 'failed_safe_to_retry');

    const redeliverySession = makeSession({
      flow_resumed: true,
      delivery_failed: true,
      delivery_correlation_id: 'typebot-payment-cs_test_recovery',
      message_deliveries: persistedPatch.message_deliveries
    });
    const sentOnRedelivery = [];
    let redeliveryPersisted = null;
    const redeliverResult = await redeliverPendingPaymentMessages('tok-recovery', {
      session: redeliverySession,
      claimRedeliveryAttempt: async () => true,
      provider: { sendTextMessage: async (p) => { sentOnRedelivery.push(p); return { providerMessageId: 'm-second-recovered' }; } },
      persistPaymentRecord: async (s, patch) => { redeliveryPersisted = patch; return patch; },
      createIntegrationError: async () => {}
    });
    assert.equal(redeliverResult.ok, true);
    assert.equal(sentOnRedelivery.length, 1, 'somente a mensagem não enviada é reenviada');
    assert.equal(sentOnRedelivery[0].idempotencyKey, persistedPatch.message_deliveries[1].key);
    assert.equal(redeliveryPersisted.message_deliveries[0].status, 'sent');
    assert.equal(redeliveryPersisted.message_deliveries[0].providerMessageId, 'm-first-ok', 'a mensagem já confirmada não é alterada');
    assert.equal(redeliveryPersisted.message_deliveries[1].status, 'sent');
    results.recuperaSomenteMensagemNaoEnviada = 'ok';
  }

  // 10) Duas tentativas concorrentes de reenvio para o MESMO pagamento:
  //     somente uma consegue reivindicar o envio.
  {
    const session = makeSession({
      flow_resumed: true,
      delivery_failed: true,
      delivery_correlation_id: 'typebot-payment-cs_test_recovery',
      message_deliveries: [makeDeliveryEntry({ status: 'failed_safe_to_retry' })]
    });
    let redeliveryClaimed = false;
    const claimRedeliveryAttempt = async () => {
      if (redeliveryClaimed) return false;
      redeliveryClaimed = true;
      return true;
    };
    const sent = [];
    const persistedClaimStates = [];
    const checkedPersist = async (s, patch) => {
      const claimed = s.metadata?.typebot_payment?.redelivery_claimed;
      persistedClaimStates.push({ claimed, release: patch.redelivery_claimed === false });
      assert.equal(claimed, true, 'updates devem preservar o claim obtido no banco');
      return patch;
    };
    const [first, second] = await Promise.all([
      redeliverPendingPaymentMessages('tok-recovery', {
        session,
        claimRedeliveryAttempt,
        provider: { sendTextMessage: async (p) => { sent.push(p); return { providerMessageId: 'm-concurrent-1' }; } },
        persistPaymentRecord: checkedPersist,
        createIntegrationError: async () => {}
      }),
      redeliverPendingPaymentMessages('tok-recovery', {
        session,
        claimRedeliveryAttempt,
        provider: { sendTextMessage: async (p) => { sent.push(p); return { providerMessageId: 'm-concurrent-2' }; } },
        persistPaymentRecord: checkedPersist,
        createIntegrationError: async () => {}
      })
    ]);
    const outcomes = [first, second];
    const winners = outcomes.filter((r) => r.ok && r.responsesSent === 1);
    const losers = outcomes.filter((r) => !r.ok && r.code === 'REDELIVERY_IN_PROGRESS');
    assert.equal(winners.length, 1, 'exatamente uma tentativa concorrente reivindica o envio');
    assert.equal(losers.length, 1, 'a outra é recusada por reenvio já em andamento');
    assert.equal(sent.length, 1, 'a mensagem é enviada exatamente uma vez entre as duas tentativas');
    assert(persistedClaimStates.some(x => x.claimed && !x.release), 'claim mantido durante persistencia intermediaria');
    assert.equal(persistedClaimStates.filter(x => x.release).length, 1, 'claim liberado somente ao finalizar');
    results.tentativasConcorrentesSomenteUmaReivindica = 'ok';
  }

  // 11) Reentrega do webhook Stripe (camada completa, com entrega real
  //     simulada): a segunda entrega não duplica nenhuma mensagem já
  //     confirmada — o claim de flow_resumed impede até chegar à entrega.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    const sent = [];
    const deps = {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      persistPaymentRecord: async (s, patch) => patch,
      callTypebot: async () => ({ input: { id: 'grp_final' }, messages: [{ type: 'text', content: { plainText: 'Pagamento confirmado.' } }] }),
      convertTypebotResponse: (typebot) => (typebot.messages || []).map((m) => ({ kind: 'text', text: m.content.plainText })),
      provider: { sendTextMessage: async (p) => { sent.push(p); return { providerMessageId: `m-${sent.length}` }; } },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    };
    const first = await completePaymentByToken('tok-recovery', { session, ...deps });
    const second = await completePaymentByToken('tok-recovery', { session, ...deps });
    assert.equal(first.responsesSent, 1);
    assert.equal(second.alreadyCompleted, true);
    assert.equal(sent.length, 1, 'reentrega do webhook não duplica mensagem já confirmada');
    results.reentregaWebhookNaoDuplicaMensagemConfirmada = 'ok';
  }

  // 12) Falha na persistência do controle de envio: não prossegue com
  //     envio inseguro — o provider nunca é chamado.
  {
    const session = makeSession({
      flow_resumed: true,
      delivery_failed: true,
      delivery_correlation_id: 'typebot-payment-cs_test_recovery',
      message_deliveries: [makeDeliveryEntry({ status: 'failed_safe_to_retry' })]
    });
    const sent = [];
    const result = await redeliverPendingPaymentMessages('tok-recovery', {
      session,
      claimRedeliveryAttempt: async () => true,
      provider: { sendTextMessage: async (p) => { sent.push(p); return { providerMessageId: 'm-unsafe' }; } },
      persistPaymentRecord: async () => { throw new Error('Supabase indisponível'); },
      createIntegrationError: async () => {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.responsesSent, 0);
    assert.equal(sent.length, 0, 'sem conseguir registrar a tentativa, o envio não é feito');
    results.falhaDePersistenciaNaoEnviaDeFormaInsegura = 'ok';
  }

  // 13) Estados financeiros e de retomada preservados durante toda a
  //     entrega/reenvio: nenhum patch de entrega toca payment_status,
  //     status ou flow_resumed.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    const allPatches = [];
    const httpRejection = Object.assign(new Error('Falha Meta WhatsApp Cloud API sendMessage (401)'), { providerStatus: 401 });
    await completePaymentByToken('tok-recovery', {
      session,
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      persistPaymentRecord: async (s, patch) => { allPatches.push(patch); return patch; },
      callTypebot: async () => ({ input: { id: 'grp_final' }, messages: [{ type: 'text', content: { plainText: 'Pagamento confirmado.' } }] }),
      convertTypebotResponse: (typebot) => (typebot.messages || []).map((m) => ({ kind: 'text', text: m.content.plainText })),
      provider: { sendTextMessage: async () => { throw httpRejection; } },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    });
    assert(allPatches.length > 0, 'a entrega persistiu pelo menos um patch');
    for (const patch of allPatches) {
      assert.equal('payment_status' in patch, false, 'patch de entrega nunca toca payment_status');
      assert.equal('status' in patch, false, 'patch de entrega nunca toca status financeiro');
      assert.equal('flow_resumed' in patch, false, 'patch de entrega nunca toca flow_resumed');
    }
    results.estadosFinanceirosERetomadaPreservadosDuranteEntrega = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, e.stack); process.exit(1); });
