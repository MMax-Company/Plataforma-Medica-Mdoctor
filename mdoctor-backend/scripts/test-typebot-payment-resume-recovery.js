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

  // 2) Falha de entrega pela Meta: pagamento e retomada preservados,
  //    deliveryFailed registrado com os outputs pendentes, e reenvio
  //    controlado depois entrega sem chamar continueChat de novo.
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
      provider: { sendTextMessage: async () => { const e = new Error('Authentication Error'); e.code = 190; throw e; } },
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
    assert.equal(Array.isArray(persistedPatch.pending_outputs), true);
    assert.equal(persistedPatch.pending_outputs.length, 1);

    // Reenvio controlado: usa os outputs pendentes, nunca chama continueChat.
    const redeliverySession = makeSession({
      flow_resumed: true,
      delivery_failed: true,
      pending_outputs: persistedPatch.pending_outputs,
      pending_outputs_correlation_id: persistedPatch.pending_outputs_correlation_id
    });
    const sentOnRedelivery = [];
    let redeliveryPersisted = null;
    const redeliverResult = await redeliverPendingPaymentMessages('tok-recovery', {
      session: redeliverySession,
      provider: { sendTextMessage: async (payload) => { sentOnRedelivery.push(payload); return { providerMessageId: 'm-redelivery-1' }; } },
      persistPaymentRecord: async (s, patch) => { redeliveryPersisted = patch; return patch; },
      createIntegrationError: async () => {}
    });
    assert.equal(redeliverResult.ok, true);
    assert.equal(redeliverResult.responsesSent, 1);
    assert.equal(sentOnRedelivery.length, 1);
    assert.equal(sentOnRedelivery[0].idempotencyKey, `${persistedPatch.pending_outputs_correlation_id}:0`, 'reenvio usa a MESMA idempotencyKey da tentativa original — Meta não duplica entrega já confirmada');
    assert.equal(redeliveryPersisted.delivery_failed, false);
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

  // 4a) Falha CLARA antes da confirmação de continueChat (Typebot nunca
  //     recebeu/respondeu de forma definitiva): reverte e permite nova
  //     tentativa seguramente.
  {
    const session = makeSession();
    const tracker = makeClaimTracker();
    let revertCalls = 0;
    const err = new Error('Falha de rede na chamada ao Typebot');
    err.code = 'TYPEBOT_FETCH_FAILED';
    const deps = {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: tracker.claimFlowResume,
      revertFlowResume: async () => { revertCalls += 1; tracker.state.resumed = false; },
      callTypebot: async () => { throw err; },
      upsertSessionIdentity: async () => {},
      createIntegrationError: async () => {}
    };
    await assert.rejects(() => completePaymentByToken('tok-recovery', { session, ...deps }), /Falha de rede/);
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

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, e.stack); process.exit(1); });
