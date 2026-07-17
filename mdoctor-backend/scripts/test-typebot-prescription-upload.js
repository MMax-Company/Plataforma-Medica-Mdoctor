const assert = require('assert');
const {
  augmentOutputsWithUploadLink,
  isUploadConfirmationText,
  outputsContainUrl,
  responseLooksLikeUploadStage
} = require('../src/services/typebot-prescription-upload.service');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');

function main() {
  const uploadUrl = 'https://painel.example/upload-receita/token-abc';

  assert.equal(isUploadConfirmationText('Já enviei a receita'), true);
  assert.equal(isUploadConfirmationText('check'), true);

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

main();
