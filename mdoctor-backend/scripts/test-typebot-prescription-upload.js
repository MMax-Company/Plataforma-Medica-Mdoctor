const assert = require('assert');
const {
  UPLOAD_SUCCESS_REPLY,
  augmentOutputsWithUploadLink,
  isUploadConfirmationText,
  outputsContainUrl,
  responseLooksLikeUploadStage,
  stripUploadChoiceOutputs,
  resumeTypebotAfterPrescriptionUpload
} = require('../src/services/typebot-prescription-upload.service');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');

function main() {
  const uploadUrl = 'https://painel.example/upload-receita/token-abc';

  assert.equal(isUploadConfirmationText('Já enviei a receita'), true);
  assert.equal(isUploadConfirmationText('check'), true);
  assert.equal(UPLOAD_SUCCESS_REPLY, 'Já enviei a receita');

  const richTextOutputs = convertTypebotResponse({
    messages: [{
      type: 'text',
      content: {
        richText: [{
          type: 'p',
          children: [{
            type: 'a',
            url: uploadUrl,
            children: [{ text: 'Enviar foto da receita' }]
          }]
        }, {
          type: 'p',
          children: [{ text: 'Formatos: JPG, PNG ou PDF (até 10 MB).' }]
        }]
      }
    }],
    input: { id: 'blk_upload_check', type: 'choice input', items: [{ content: 'Já enviei a receita' }] }
  });
  assert(outputsContainUrl(richTextOutputs, uploadUrl), 'richText deve expor URL clicável');
  assert(richTextOutputs.some((item) => item.text?.includes('Enviar foto da receita')));

  const stripped = stripUploadChoiceOutputs(richTextOutputs);
  assert.equal(stripped.some((item) => item.kind === 'buttons'), false);
  assert.equal(stripped.some((item) => item.kind === 'list'), false);
  assert(stripped.some((item) => item.kind === 'text'));

  const emptyLinkOutputs = convertTypebotResponse({
    messages: [{
      type: 'text',
      content: {
        richText: [{
          type: 'p',
          children: [{ text: 'Use novamente o link abaixo e depois clique em "Já enviei a receita" para conferir.' }]
        }, {
          type: 'p',
          children: [{ type: 'a', url: '', children: [{ text: 'Enviar foto da receita' }] }]
        }]
      }
    }],
    input: { id: 'blk_upload_pending_choice', type: 'choice input', items: [{ content: 'Já enviei a receita' }] }
  });
  const augmented = augmentOutputsWithUploadLink(emptyLinkOutputs, { uploadUrl }, { force: true });
  assert(outputsContainUrl(augmented, uploadUrl), 'link vazio do Typebot deve ser substituído pelo upload_url real');
  assert(responseLooksLikeUploadStage({ messages: emptyLinkOutputs }, 'blk_upload_pending_choice'));

  const withLinkSent = augmentOutputsWithUploadLink(
    [{ kind: 'text', text: 'Aguarde enquanto validamos sua receita.' }],
    { uploadUrl },
    { linkAlreadySent: true }
  );
  assert.equal(outputsContainUrl(withLinkSent, uploadUrl), false, 'linkAlreadySent não deve reinjetar link');

  const retryHint = augmentOutputsWithUploadLink(
    [{ kind: 'text', text: 'Não localizamos o envio. Use o link abaixo.' }],
    { uploadUrl },
    { linkAlreadySent: true }
  );
  assert(outputsContainUrl(retryHint, uploadUrl), 'retry hint deve permitir reenvio do link');

  let callCount = 0;
  const session = {
    id: 'sess-1',
    phone: '5511985485777',
    typebot_session_id: 'typebot-abc',
    metadata: {}
  };

  (async () => {
    const first = await resumeTypebotAfterPrescriptionUpload({
      token: 'token-abc',
      atendimentoId: 'at-1',
      correlationId: 'corr-1'
    }, {
      getAtendimento: async () => ({ id: 'at-1', paciente_telefone: '5511985485777' }),
      getSessionByPhone: async () => session,
      claimPrescriptionUploadResume: async () => true,
      revertPrescriptionUploadResume: async () => {},
      callTypebot: async () => {
        callCount += 1;
        return {
          messages: [{ type: 'text', content: { plainText: 'Receita validada.' } }],
          input: { id: 'blk_next', type: 'text input' }
        };
      },
      convertTypebotResponse: convertTypebotResponse,
      provider: {
        sendTextMessage: async () => ({ providerMessageId: 'msg-1' })
      },
      upsertSessionIdentity: async () => {}
    });
    assert.equal(first.ok, true);
    assert.equal(callCount, 1);

    const second = await resumeTypebotAfterPrescriptionUpload({
      token: 'token-abc',
      atendimentoId: 'at-1',
      correlationId: 'corr-2'
    }, {
      session: { ...session, metadata: { prescription_upload_resume: { token: 'token-abc', completed_at: new Date().toISOString() } } },
      getAtendimento: async () => ({ id: 'at-1', paciente_telefone: '5511985485777' }),
      callTypebot: async () => {
        callCount += 1;
        return { messages: [], input: null };
      }
    });
    assert.equal(second.alreadyCompleted, true);
    assert.equal(callCount, 1, 'idempotência deve evitar segundo continueChat');

    console.log(JSON.stringify({
      uploadConfirmationDetected: 'ok',
      richTextLinkExported: outputsContainUrl(richTextOutputs, uploadUrl) ? 'ok' : 'failed',
      emptyTypebotLinkReplaced: outputsContainUrl(augmented, uploadUrl) ? 'ok' : 'failed',
      stripUploadChoiceOutputs: 'ok',
      linkAlreadySent: 'ok',
      resumeIdempotency: 'ok'
    }));
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

main();
