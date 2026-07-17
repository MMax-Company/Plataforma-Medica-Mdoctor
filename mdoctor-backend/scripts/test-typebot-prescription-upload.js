const assert = require('assert');
const {
  UPLOAD_SUCCESS_REPLY,
  augmentOutputsWithUploadLink,
  isUploadConfirmationText,
  outputsContainUrl,
  responseLooksLikeUploadStage,
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

  console.log(JSON.stringify({
    uploadConfirmationDetected: 'ok',
    richTextLinkExported: outputsContainUrl(richTextOutputs, uploadUrl) ? 'ok' : 'failed',
    emptyTypebotLinkReplaced: outputsContainUrl(augmented, uploadUrl) ? 'ok' : 'failed'
  }));
}

async function testResumeAfterUpload() {
  process.env.WHATSAPP_ENABLED = 'true';
  const sent = [];
  const typebotCalls = [];
  const result = await resumeTypebotAfterPrescriptionUpload(
    {
      atendimentoId: '529e6ed4-ec5d-4018-a762-28ba2ea487ba',
      token: 'token-resume-test',
      correlationId: 'resume-test-1',
      whatsappSession: {
        id: 'wa-1',
        phone: '5511985485777',
        typebot_session_id: 'tb-session-upload',
        metadata: { typebot_prescription_upload: { atendimento_id: '529e6ed4-ec5d-4018-a762-28ba2ea487ba', token: 'token-resume-test' } }
      }
    },
    {
      provider: {
        isConfigured: () => true,
        sendTextMessage: async (payload) => {
          sent.push(payload);
          return { providerMessageId: `msg-${sent.length}` };
        },
        sendButtonMessage: async () => ({}),
        sendListMessage: async () => ({})
      },
      callTypebot: async (path, body) => {
        typebotCalls.push({ path, body });
        return {
          messages: [{ type: 'text', content: { plainText: 'Recebemos suas informações e a foto da receita.' } }],
          input: null
        };
      },
      upsertSessionIdentity: async () => ({})
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.responsesSent, 1);
  assert(typebotCalls[0].path.includes('/sessions/tb-session-upload/continueChat'));
  assert.equal(typebotCalls[0].body.message.text, UPLOAD_SUCCESS_REPLY);
  assert.equal(sent[0].text, 'Recebemos suas informações e a foto da receita.');
  console.log(JSON.stringify({ resumeAfterUpload: 'ok', responsesSent: result.responsesSent }));
}

main();
testResumeAfterUpload().catch((error) => {
  console.error(error);
  process.exit(1);
});
