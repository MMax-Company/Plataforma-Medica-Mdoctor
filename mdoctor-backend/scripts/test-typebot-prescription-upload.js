const assert = require('assert');
const {
  augmentOutputsWithUploadLink,
  isUploadConfirmationText,
  outputsContainUrl,
  responseLooksLikeUploadStage
} = require('../src/services/typebot-prescription-upload.service');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');

function main() {
  assert.equal(isUploadConfirmationText('Conferir novamente'), true);
  assert.equal(isUploadConfirmationText('check'), true);

  const richTextOutputs = convertTypebotResponse({
    messages: [{
      type: 'text',
      content: {
        richText: [{
          type: 'p',
          children: [{ text: 'Envie a receita anterior nesta conversa do WhatsApp.' }]
        }, {
          type: 'p',
          children: [{ text: 'Formatos: JPG, JPEG, PNG ou PDF (até 10 MB).' }]
        }]
      }
    }],
    input: { id: 'blk_upload_check', type: 'choice input', items: [{ content: 'Conferir novamente' }] }
  });
  assert(richTextOutputs.some((item) => /WhatsApp/i.test(String(item.text || ''))));

  const linkOutputs = convertTypebotResponse({
    messages: [{
      type: 'text',
      content: {
        richText: [{
          type: 'p',
          children: [{ text: 'Use novamente o link abaixo e depois clique em "Conferir novamente".' }]
        }, {
          type: 'p',
          children: [{ type: 'a', url: 'https://painel.example/upload-receita/token-abc', children: [{ text: 'Enviar foto da receita' }] }]
        }]
      }
    }],
    input: { id: 'blk_upload_pending_choice', type: 'choice input', items: [{ content: 'Conferir novamente' }] }
  });
  const augmented = augmentOutputsWithUploadLink(linkOutputs, { uploadUrl: 'https://painel.example/upload-receita/token-abc' });
  assert(!outputsContainUrl(augmented, 'https://painel.example/upload-receita/token-abc'), 'link externo não deve ser reenviado no WhatsApp');
  assert(augmented.some((item) => /WhatsApp/i.test(String(item.text || ''))));
  assert(responseLooksLikeUploadStage({ messages: linkOutputs }, 'blk_upload_pending_choice'));

  console.log(JSON.stringify({
    uploadConfirmationDetected: 'ok',
    whatsAppInstructionsExported: 'ok',
    externalLinkStripped: 'ok'
  }));
}

main();
