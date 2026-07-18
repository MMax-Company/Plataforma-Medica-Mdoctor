const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  UPLOAD_SUCCESS_REPLY,
  augmentOutputsWithUploadLink,
  buildUploadStatusUrlByAtendimento,
  isUploadConfirmationText,
  resolveUploadStatus
} = require('../src/services/typebot-prescription-upload.service');
const { MAX_BYTES, validateBuffer } = require('../src/services/previous-prescription-storage.service');
const { mimeFromFilename } = require('../src/services/prescription-upload.service');

async function testUploadStatusShape() {
  const pending = resolveUploadStatus({});
  assert.equal(pending.upload_completed, false);
  assert.equal(pending.upload_status, 'pending');

  const completed = resolveUploadStatus({
    previous_prescription_storage_path: 'atendimentos/x/receita-anterior-1.pdf',
    foto_receita_url: 'https://example.com/receita.pdf'
  });
  assert.equal(completed.upload_completed, true);
  assert.equal(completed.upload_status, 'completed');
}

function testMimeValidation() {
  const jpg = Buffer.alloc(1024);
  validateBuffer(jpg, 'image/jpeg');
  validateBuffer(jpg, 'image/jpg');
  validateBuffer(jpg, 'image/png');
  validateBuffer(jpg, 'application/pdf');

  const tooLarge = Buffer.alloc(MAX_BYTES + 1);
  assert.throws(() => validateBuffer(tooLarge, 'application/pdf'), /limite/i);

  assert.equal(mimeFromFilename('receita.JPG'), 'image/jpeg');
  assert.equal(mimeFromFilename('receita.pdf'), 'application/pdf');
}

function testWhatsAppOutputs() {
  assert.equal(isUploadConfirmationText('Conferir novamente'), true);
  assert.equal(UPLOAD_SUCCESS_REPLY, 'Conferir novamente');

  const outputs = augmentOutputsWithUploadLink(
    [{ kind: 'text', text: 'Use novamente o link abaixo: https://painel.example/upload-receita/token' }],
    { uploadUrl: 'https://painel.example/upload-receita/token' }
  );
  assert(!outputs.some((item) => /upload-receita|https:\/\//i.test(String(item.text || ''))));
  assert(outputs.some((item) => /WhatsApp/i.test(String(item.text || ''))));
}

function testTypebotExport() {
  const file = path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-production.json');
  const bot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const foto = bot.groups.find((g) => g.id === 'grp_foto_receita');
  assert.equal(foto.title, 'Aguardando envio da receita');
  assert(foto.blocks.some((b) => b.id === 'blk_set_upload_pending'));
  assert(!JSON.stringify(foto).includes('{{upload_url}}'));

  const pending = bot.groups.find((g) => g.id === 'grp_upload_pending_retry');
  const choices = pending.blocks.find((b) => b.id === 'blk_upload_pending_choice').items.map((i) => i.content);
  assert.deepEqual(choices, ['Conferir novamente', 'Enviar novamente', 'Continuar depois']);

  const confirmed = bot.groups.find((g) => g.id === 'grp_upload_confirmed');
  const confirmedText = JSON.stringify(confirmed);
  assert(/Receita anterior recebida e vinculada ao seu atendimento/.test(confirmedText));
  assert(/conferência final das informações/.test(confirmedText));

  const statusWebhook = bot.groups
    .flatMap((g) => g.blocks)
    .find((b) => b.id === 'blk_upload_status_webhook');
  assert(statusWebhook.options.webhook.method === 'GET');
  assert(statusWebhook.options.responseVariableMapping.some((m) => m.bodyPath === 'data.upload_status'));
}

async function main() {
  process.env.PUBLIC_BASE_URL = 'https://backend.example';
  assert(buildUploadStatusUrlByAtendimento('abc-123').includes('/api/atendimentos/abc-123/prescription-upload/status'));

  await testUploadStatusShape();
  testMimeValidation();
  testWhatsAppOutputs();
  testTypebotExport();

  console.log(JSON.stringify({
    uploadStatusResolver: 'ok',
    jpgPdfValidation: 'ok',
    whatsappOutputsWithoutExternalLink: 'ok',
    typebotExportPedidos: 'ok'
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
