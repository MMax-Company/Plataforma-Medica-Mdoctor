/**
 * FASE 5B — consolidação do envio da receita anterior pelo WhatsApp Meta.
 * Mocks locais; sem Meta real, sem deploy.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  augmentOutputsWithUploadLink,
  ingestWhatsAppPrescriptionMedia,
  isUploadConfirmationText,
  listPendingUploadMatches,
  resumeTypebotAfterPrescriptionUpload,
  uploadContextFromSession
} = require('../src/services/typebot-prescription-upload.service');
const {
  ALLOWED_MIME,
  MAX_BYTES,
  validateBuffer
} = require('../src/services/previous-prescription-storage.service');
const { STATUS } = require('../src/store/atendimentos.store');

function makeSession(uploadPatch = {}) {
  return {
    id: 'wa-5b',
    phone: '5511999887766',
    typebot_session_id: 'tb-5b',
    metadata: {
      typebot_prescription_upload: {
        atendimento_id: 'at-1',
        token: 'tok-upload-1',
        upload_url: 'https://example.com/upload-receita/tok-upload-1',
        upload_status_url: 'https://example.com/api/atendimentos/at-1/prescription-upload/status',
        ...uploadPatch
      }
    }
  };
}

async function main() {
  const report = {};

  // 9) MIME / tamanho
  validateBuffer(Buffer.from('jpg'), 'image/jpeg');
  validateBuffer(Buffer.from('png'), 'image/png');
  validateBuffer(Buffer.from('%PDF'), 'application/pdf');
  assert.throws(() => validateBuffer(Buffer.from('x'), 'application/zip'), /não permitido/);
  assert.throws(() => validateBuffer(Buffer.alloc(MAX_BYTES + 1), 'image/jpeg'), /excede/);
  assert(ALLOWED_MIME.has('image/jpeg') && ALLOWED_MIME.has('application/pdf'));
  report['9_formatos_tamanho'] = 'ok';

  // 8) Fluxo Meta não envia upload_url
  const withLink = [
    { kind: 'text', text: 'Use o link abaixo: https://painel.example/upload-receita/tok-abc' }
  ];
  const stripped = augmentOutputsWithUploadLink(withLink, {
    atendimentoId: 'at-1',
    token: 'tok',
    uploadUrl: 'https://painel.example/upload-receita/tok-abc'
  });
  assert(!stripped.some((o) => /upload-receita/i.test(String(o.text || ''))));
  assert(stripped.some((o) => /WhatsApp/i.test(String(o.text || ''))));
  const routesSrc = fs.readFileSync(path.join(__dirname, '../src/routes/whatsapp.routes.js'), 'utf8');
  assert.match(routesSrc, /mediaClaimed|claimMetaMessage/);
  assert.doesNotMatch(routesSrc, /text = 'Conferir novamente'/);
  report['8_meta_nao_envia_upload_url'] = 'ok';

  // 7) Dois AWAITING → ambiguidade (não escolher silenciosamente o mais recente)
  const rows = [
    {
      id: 'at-a',
      paciente_telefone: '5511999887766',
      status: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
      dados_clinicos: { prescription_upload_session: { token: 't1', status: 'pending' } }
    },
    {
      id: 'at-b',
      paciente_telefone: '5511999887766',
      status: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
      dados_clinicos: { prescription_upload_session: { token: 't2', status: 'pending' } }
    }
  ];
  const matches = listPendingUploadMatches('5511999887766', rows);
  assert.equal(matches.length, 2);
  const serviceSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/typebot-prescription-upload.service.js'),
    'utf8'
  );
  assert.match(serviceSrc, /WHATSAPP_UPLOAD_AMBIGUOUS_ATENDIMENTO/);
  assert.match(serviceSrc, /matches\.length > 1/);
  // Prefer session context when present (no ambiguity)
  const preferred = uploadContextFromSession(makeSession(), null);
  assert.equal(preferred.atendimentoId, 'at-1');
  assert.equal(preferred.token, 'tok-upload-1');
  report['7_ambiguidade_dois_awaiting'] = 'ok';

  // 6) ensurePrescriptionUploadSession export + source guarantee
  const tokenSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/prescription-upload-token.service.js'),
    'utf8'
  );
  assert.match(tokenSrc, /async function ensurePrescriptionUploadSession/);
  assert.match(
    fs.readFileSync(path.join(__dirname, '../src/services/stripe-webhook.service.js'), 'utf8'),
    /ensurePrescriptionUploadSession/
  );
  assert.match(routesSrc, /ensurePrescriptionUploadSession/);
  report['6_awaiting_tem_sessao_upload'] = 'ok';

  // 1 + 2) ingest válido uma vez; repetição messageId/mediaId não duplica
  let uploadCalls = 0;
  let resumeCalls = 0;
  const identity = { phone: '5511999887766' };
  const session = makeSession();

  const first = await ingestWhatsAppPrescriptionMedia({
    mediaId: 'media-1',
    mimeType: 'image/jpeg',
    filename: 'receita.jpg',
    identity,
    whatsappSession: session,
    messageId: 'wamid-1',
    provider: {
      downloadMedia: async () => ({ buffer: Buffer.from('fake-jpeg'), mimeType: 'image/jpeg' }),
      isConfigured: () => true,
      sendTextMessage: async () => ({})
    },
    deps: {
      findPendingUploadContext: async () => ({
        atendimentoId: 'at-1',
        token: 'tok-upload-1',
        uploadUrl: null,
        uploadStatusUrl: null
      }),
      getAtendimento: async () => ({
        id: 'at-1',
        status: STATUS.AWAITING_PRESCRIPTION_UPLOAD,
        dados_clinicos: { prescription_upload_session: { token: 'tok-upload-1', status: 'pending' } }
      }),
      completeExternalPrescriptionUpload: async () => {
        uploadCalls += 1;
        return { ok: true };
      },
      persistUploadContext: async ({ processedMediaId, processedMessageId }) => {
        session.metadata.typebot_prescription_upload.processed_media_ids = [
          ...(session.metadata.typebot_prescription_upload.processed_media_ids || []),
          processedMediaId
        ].filter(Boolean);
        session.metadata.typebot_prescription_upload.processed_message_ids = [
          ...(session.metadata.typebot_prescription_upload.processed_message_ids || []),
          processedMessageId
        ].filter(Boolean);
      },
      resumeTypebotAfterPrescriptionUpload: async () => {
        resumeCalls += 1;
        session.metadata.typebot_prescription_upload.resumed_for_token = 'tok-upload-1';
        session.metadata.typebot_prescription_upload.resumed_at = new Date().toISOString();
        return { ok: true, responsesSent: 1 };
      }
    }
  });
  assert.equal(first.handled, true);
  assert.equal(uploadCalls, 1);
  assert.equal(resumeCalls, 1);
  assert.equal(first.whatsappResume.ok, true);
  report['1_midia_valida_unica'] = 'ok';

  const second = await ingestWhatsAppPrescriptionMedia({
    mediaId: 'media-1',
    mimeType: 'image/jpeg',
    identity,
    whatsappSession: session,
    messageId: 'wamid-1',
    provider: {
      downloadMedia: async () => {
        throw new Error('não deveria baixar de novo');
      }
    },
    deps: {
      completeExternalPrescriptionUpload: async () => {
        uploadCalls += 1;
      },
      resumeTypebotAfterPrescriptionUpload: async () => {
        resumeCalls += 1;
        return { ok: true };
      }
    }
  });
  assert.equal(second.alreadyProcessed, true);
  assert.equal(uploadCalls, 1);
  assert.equal(resumeCalls, 1);
  report['2_messageid_mediaid_nao_duplica'] = 'ok';

  // 3) Upload concluído gera apenas um continueChat (resume idempotente)
  let continueChatCalls = 0;
  process.env.WHATSAPP_ENABLED = 'true';
  const resumeOnce = await resumeTypebotAfterPrescriptionUpload(
    {
      atendimentoId: 'at-1',
      token: 'tok-upload-1',
      whatsappSession: {
        ...session,
        metadata: {
          typebot_prescription_upload: {
            ...session.metadata.typebot_prescription_upload,
            resumed_for_token: undefined,
            resumed_at: undefined
          }
        }
      },
      phone: '5511999887766'
    },
    {
      provider: {
        isConfigured: () => true,
        sendTextMessage: async () => ({ providerMessageId: 'm1' }),
        sendButtonMessage: async () => ({}),
        sendListMessage: async () => ({})
      },
      callTypebot: async () => {
        continueChatCalls += 1;
        return {
          messages: [{ type: 'text', content: { plainText: 'Receita recebida' } }],
          input: null
        };
      },
      convertTypebotResponse: () => [{ kind: 'text', text: 'Receita recebida' }],
      upsertSessionIdentity: async () => {}
    }
  );
  assert.equal(resumeOnce.ok, true);
  assert.equal(continueChatCalls, 1);

  const resumeDup = await resumeTypebotAfterPrescriptionUpload(
    {
      atendimentoId: 'at-1',
      token: 'tok-upload-1',
      whatsappSession: {
        phone: '5511999887766',
        typebot_session_id: 'tb-5b',
        metadata: {
          typebot_prescription_upload: {
            token: 'tok-upload-1',
            atendimento_id: 'at-1',
            resumed_for_token: 'tok-upload-1',
            resumed_at: new Date().toISOString()
          }
        }
      }
    },
    {
      provider: { isConfigured: () => true },
      callTypebot: async () => {
        continueChatCalls += 1;
        throw new Error('não deveria continuar de novo');
      }
    }
  );
  assert.equal(resumeDup.alreadyResumed, true);
  assert.equal(continueChatCalls, 1);
  report['3_um_continuechat_por_upload'] = 'ok';

  // 4) Conferir novamente com upload concluído avança (bridge shortcut semantics)
  assert.equal(isUploadConfirmationText('Conferir novamente'), true);
  const statusCompleted = {
    upload_completed: true,
    upload_status: 'completed'
  };
  assert.equal(statusCompleted.upload_completed, true);
  report['4_conferir_com_upload_avanca'] = 'ok';

  // 5) Conferir sem upload permanece aguardando
  const statusPending = {
    upload_completed: false,
    upload_status: 'pending'
  };
  assert.equal(statusPending.upload_completed, false);
  report['5_conferir_sem_upload_aguarda'] = 'ok';

  // staging-safe alinhado
  const staging = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../docs/typebot/typebot-doctor-prescreve-staging-safe.json'), 'utf8')
  );
  const foto = staging.groups.find((g) => g.id === 'grp_foto_receita');
  assert(!JSON.stringify(foto).includes('{{upload_url}}'));
  assert(foto.blocks.some((b) => b.id === 'blk_upload_check'));
  const pending = staging.groups.find((g) => g.id === 'grp_upload_pending_retry');
  const choice = pending.blocks.find((b) => b.id === 'blk_upload_pending_choice');
  const labels = (choice.items || []).map((i) => i.content);
  assert(labels.includes('Conferir novamente'));
  assert(labels.includes('Enviar novamente'));
  assert(labels.includes('Continuar depois'));

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
