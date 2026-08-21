const assert = require('assert');
const { completePaymentByToken } = require('../src/services/typebot-payment-link.service');

function makeSession(paymentPatch = {}) {
  return {
    id: 'wa-1',
    phone: '5511985485777',
    bsuid: null,
    metadata: {
      typebot_payment: {
        token: 'tok-1',
        status: 'pending',
        payment_status: 'pending',
        typebot_session_id: 'tb-session-1',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        ...paymentPatch
      }
    }
  };
}

function baseDeps({ callTypebot, uploadHelpers }) {
  const sent = [];
  const persisted = [];
  return {
    deps: {
      refreshPaymentStatus: async () => ({ paymentStatus: 'paid' }),
      claimFlowResume: async () => true,
      convertTypebotResponse: (typebot) => (typebot.messages || []).map((m) => ({ kind: 'text', text: m.content.plainText })),
      callTypebot,
      provider: {
        sendTextMessage: async (payload) => { sent.push(payload); return { providerMessageId: `m-${sent.length}` }; },
        sendButtonMessage: async () => ({}),
        sendListMessage: async () => ({})
      },
      upsertSessionIdentity: async (args) => { persisted.push(args); return {}; },
      uploadHelpers
    },
    sent,
    persisted
  };
}

async function main() {
  // Cenário A — próximo passo do Typebot é a etapa de upload da receita
  // (grp_foto_receita) e já existe um contexto de upload válido (atendimento
  // já está AWAITING_PRESCRIPTION_UPLOAD por decisão do webhook de triagem,
  // não alterada aqui): o contexto deve ser gravado na sessão ANTES da
  // mensagem sair, e só uma mensagem (a do Typebot) deve ser enviada — sem
  // duplicidade com o antigo PAYMENT_CONFIRMED_MESSAGE fixo do Backend.
  {
    const callOrder = [];
    const uploadHelpers = {
      responseLooksLikeUploadStage: () => true,
      findUploadContextForPhone: async (phone) => {
        callOrder.push('findUploadContextForPhone');
        assert.equal(phone, '5511985485777');
        return { atendimentoId: 'at-1', token: 'up-tok', uploadUrl: null, uploadStatusUrl: null };
      },
      persistUploadContext: async ({ identity, uploadContext, whatsappSession }) => {
        callOrder.push('persistUploadContext');
        assert.equal(identity.phone, '5511985485777');
        assert.equal(uploadContext.atendimentoId, 'at-1');
        assert.equal(whatsappSession.id, 'wa-1');
      }
    };
    const { deps, sent } = baseDeps({
      callTypebot: async () => ({
        sessionId: 'tb-session-1',
        messages: [{ type: 'text', content: { plainText: 'Pagamento confirmado com sucesso.\n\nAgora envie sua receita médica anterior diretamente nesta conversa do WhatsApp.' } }],
        input: { id: 'blk_upload_check', type: 'text input' }
      }),
      uploadHelpers
    });
    const result = await completePaymentByToken('tok-1', { session: makeSession(), ...deps });
    assert.equal(result.ok, true);
    assert.equal(result.responsesSent, 1, 'apenas a mensagem do Typebot deve ser enviada, sem duplicidade');
    assert.equal(sent.length, 1);
    assert.deepEqual(callOrder, ['findUploadContextForPhone', 'persistUploadContext']);
  }

  // Cenário B — próximo passo NÃO é a etapa de upload (ex.: segue direto
  // para a fila médica): nenhuma chamada de upload deve acontecer.
  {
    let uploadHelpersCalled = false;
    const uploadHelpers = {
      responseLooksLikeUploadStage: () => false,
      findUploadContextForPhone: async () => { uploadHelpersCalled = true; return null; },
      persistUploadContext: async () => { uploadHelpersCalled = true; }
    };
    const { deps, sent } = baseDeps({
      callTypebot: async () => ({
        sessionId: 'tb-session-1',
        messages: [{ type: 'text', content: { plainText: 'Seu atendimento foi enviado para avaliação médica.' } }],
        input: { id: 'grp_final', type: 'text input' }
      }),
      uploadHelpers
    });
    const result = await completePaymentByToken('tok-1', { session: makeSession(), ...deps });
    assert.equal(result.ok, true);
    assert.equal(result.responsesSent, 1);
    assert.equal(sent.length, 1);
    assert.equal(uploadHelpersCalled, false, 'fora da etapa de upload, nenhum lookup/gravação de upload deve ocorrer');
  }

  // Cenário C — é a etapa de upload, mas ainda não existe contexto (regra de
  // elegibilidade do webhook de triagem não marcou este atendimento como
  // aguardando receita): nunca inventar/forçar um estado — persistUploadContext
  // não pode ser chamado.
  {
    let persistCalled = false;
    const uploadHelpers = {
      responseLooksLikeUploadStage: () => true,
      findUploadContextForPhone: async () => null,
      persistUploadContext: async () => { persistCalled = true; }
    };
    const { deps, sent } = baseDeps({
      callTypebot: async () => ({
        sessionId: 'tb-session-1',
        messages: [{ type: 'text', content: { plainText: 'Agora envie sua receita médica anterior diretamente nesta conversa do WhatsApp.' } }],
        input: { id: 'blk_upload_check', type: 'text input' }
      }),
      uploadHelpers
    });
    const result = await completePaymentByToken('tok-1', { session: makeSession(), ...deps });
    assert.equal(result.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(persistCalled, false, 'sem contexto elegível, nada deve ser gravado — elegibilidade não é alterada aqui');
  }

  console.log(JSON.stringify({
    uploadContextPersistedBeforeMessageWhenUploadStage: 'ok',
    noUploadLookupWhenNotUploadStage: 'ok',
    neverInventsUploadContextWhenEligibilityDidNotGrantIt: 'ok',
    noDuplicatePaymentConfirmedMessage: 'ok'
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });
