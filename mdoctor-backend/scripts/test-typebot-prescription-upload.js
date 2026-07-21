const assert = require('assert');
const {
  UPLOAD_SUCCESS_REPLY,
  PRESCRIPTION_RECEIVED_MESSAGE,
  augmentOutputsWithUploadLink,
  isUploadConfirmationText,
  isPaymentConfirmedByPedido2,
  outputsContainUrl,
  responseLooksLikeUploadStage,
  stripUploadChoiceOutputs,
  resumeTypebotAfterPrescriptionUpload,
  ingestWhatsAppPrescriptionMedia,
  readProcessedIds
} = require('../src/services/typebot-prescription-upload.service');
const { convertTypebotResponse } = require('../src/services/typebot-whatsapp.bridge');
const { ALLOWED_MIME, MAX_BYTES, validateBuffer } = require('../src/services/previous-prescription-storage.service');

async function main() {
  const results = {};

  // ---- Fase 2 pedido 3: caminho externo desativado ----
  assert.equal(isUploadConfirmationText('Já enviei a receita'), true);
  assert.equal(isUploadConfirmationText('check'), true);
  assert.equal(UPLOAD_SUCCESS_REPLY, 'Já enviei a receita');
  results.confirmationTextDetection = 'ok';

  // convertTypebotResponse ainda expõe o que o Typebot manda (isso não é
  // tocado neste pedido) — o teste confirma que augmentOutputsWithUploadLink
  // é quem garante que nenhum link chega ao paciente.
  const uploadUrl = 'https://painel.example/upload-receita/token-abc';
  const richTextOutputs = convertTypebotResponse({
    messages: [{
      type: 'text',
      content: {
        richText: [{
          type: 'p',
          children: [{ type: 'a', url: uploadUrl, children: [{ text: 'Enviar foto da receita' }] }]
        }, {
          type: 'p',
          children: [{ text: 'Formatos: JPG, PNG ou PDF (até 10 MB).' }]
        }]
      }
    }],
    input: { id: 'blk_upload_check', type: 'choice input', items: [{ content: 'Já enviei a receita' }] }
  });
  assert(outputsContainUrl(richTextOutputs, uploadUrl), 'pré-condição: o Typebot ainda manda o link (conteúdo não alterado)');

  const stripped = stripUploadChoiceOutputs(richTextOutputs);
  assert.equal(stripped.some((item) => item.kind === 'buttons'), false, '"Conferir novamente"/"Já enviei" não podem chegar como botão');
  assert.equal(stripped.some((item) => item.kind === 'list'), false);
  results.oldChoiceButtonsStripped = 'ok';

  const sanitized = augmentOutputsWithUploadLink(stripped, { uploadUrl });
  assert.equal(outputsContainUrl(sanitized, uploadUrl), false, 'nenhum upload_url pode chegar ao paciente no caminho oficial');
  assert(!sanitized.some((o) => /https?:\/\//i.test(o.text || '')), 'nenhum link (de qualquer origem) pode sobrar na saída');
  assert(sanitized.some((o) => /nesta conversa do WhatsApp/i.test(o.text || '')), 'deve orientar envio direto pelo WhatsApp, sem link');
  results.noExternalUploadUrlOrPage = 'ok';

  const retryOutputs = [{ kind: 'text', text: 'Não localizamos o envio. Use o link abaixo.' }];
  const retrySanitized = augmentOutputsWithUploadLink(retryOutputs, { uploadUrl });
  assert.equal(outputsContainUrl(retrySanitized, uploadUrl), false);
  results.retryHintAlsoWithoutLink = 'ok';

  assert(responseLooksLikeUploadStage({ messages: richTextOutputs }, 'blk_upload_pending_choice'));
  results.uploadStageDetected = 'ok';

  // ---- isPaymentConfirmedByPedido2: lê o estado já produzido pelo pedido 2 ----
  assert.equal(isPaymentConfirmedByPedido2({ metadata: { typebot_payment: { payment_status: 'paid' } } }), true);
  assert.equal(isPaymentConfirmedByPedido2({ metadata: { typebot_payment: { payment_status: 'pending' } } }), false);
  assert.equal(isPaymentConfirmedByPedido2({ metadata: {} }), false);
  results.paymentStateReadFromPedido2 = 'ok';

  // ---- resumeTypebotAfterPrescriptionUpload: idempotência pré-existente (não tocada) ----
  {
    let callCount = 0;
    const session = { id: 'sess-1', phone: '5511985485777', typebot_session_id: 'typebot-abc', metadata: {} };
    const first = await resumeTypebotAfterPrescriptionUpload({ token: 'token-abc', atendimentoId: 'at-1', correlationId: 'corr-1' }, {
      getAtendimento: async () => ({ id: 'at-1', paciente_telefone: '5511985485777' }),
      getSessionByPhone: async () => session,
      claimPrescriptionUploadResume: async () => true,
      revertPrescriptionUploadResume: async () => {},
      callTypebot: async () => { callCount += 1; return { messages: [{ type: 'text', content: { plainText: 'Receita validada.' } }], input: { id: 'blk_next', type: 'text input' } }; },
      convertTypebotResponse,
      provider: { sendTextMessage: async () => ({ providerMessageId: 'msg-1' }) },
      upsertSessionIdentity: async () => {}
    });
    assert.equal(first.ok, true);
    assert.equal(callCount, 1);
    const second = await resumeTypebotAfterPrescriptionUpload({ token: 'token-abc', atendimentoId: 'at-1', correlationId: 'corr-2' }, {
      session: { ...session, metadata: { prescription_upload_resume: { token: 'token-abc', completed_at: new Date().toISOString() } } },
      getAtendimento: async () => ({ id: 'at-1', paciente_telefone: '5511985485777' }),
      callTypebot: async () => { callCount += 1; return { messages: [], input: null }; }
    });
    assert.equal(second.alreadyCompleted, true);
    assert.equal(callCount, 1, 'idempotência deve evitar segundo continueChat');
    results.resumeIdempotency = 'ok';
  }

  // ---- ingestWhatsAppPrescriptionMedia: texto não é aceito como receita (estrutural) ----
  // Esta função só é chamada pelo webhook Meta quando msg.type é "image" ou
  // "document" (whatsapp.routes.js) — mensagens de texto nunca chegam aqui.
  // Confirmado por leitura do código, não por execução (sem mediaId/mimeType
  // a função nem tem o que baixar).

  // ---- ingestWhatsAppPrescriptionMedia: sem pagamento confirmado, não processa ----
  {
    const sentMessages = [];
    let uploadCalled = false;
    const session = { phone: '5511985485777', metadata: { typebot_payment: { payment_status: 'pending' } } };
    await assert.rejects(
      ingestWhatsAppPrescriptionMedia({
        mediaId: 'media-1',
        mimeType: 'image/jpeg',
        identity: { phone: '5511985485777' },
        whatsappSession: session,
        messageId: 'msg-no-payment',
        provider: { downloadMedia: async () => { uploadCalled = true; return { buffer: Buffer.from('x'), mimeType: 'image/jpeg' }; }, sendTextMessage: async (p) => { sentMessages.push(p); return {}; } },
        deps: {
          findPendingUploadContext: async () => ({ atendimentoId: 'at-2', token: 'tok-2' }),
          getAtendimento: async () => ({ dados_clinicos: {} }),
          completeExternalPrescriptionUpload: async () => { throw new Error('não deveria ser chamado'); }
        }
      }),
      (err) => err.code === 'PRESCRIPTION_PAYMENT_NOT_CONFIRMED'
    );
    assert.equal(uploadCalled, false, 'sem pagamento confirmado, a mídia nem é baixada');
    assert.equal(sentMessages.length, 0, 'sem pagamento confirmado, nenhuma mensagem de confirmação é enviada');
    results.semPagamentoNaoProcessa = 'ok';
  }

  // ---- ingestWhatsAppPrescriptionMedia: sucesso -> exatamente 3 mensagens, uma vez,
  //      e retoma o Typebot automaticamente (sem clique em "Conferir novamente") ----
  {
    const sentMessages = [];
    let downloadCalls = 0;
    let uploadCalls = 0;
    let uploadArgs = null;
    let resumeCalls = [];
    const session = { phone: '5511985485777', bsuid: null, metadata: { typebot_payment: { payment_status: 'paid' } } };
    const result = await ingestWhatsAppPrescriptionMedia({
      mediaId: 'media-ok-1',
      mimeType: 'image/jpeg',
      identity: { phone: '5511985485777' },
      whatsappSession: session,
      messageId: 'msg-ok-1',
      provider: {
        downloadMedia: async () => { downloadCalls += 1; return { buffer: Buffer.from('conteudo'), mimeType: 'image/jpeg' }; },
        sendTextMessage: async (p) => { sentMessages.push(p); return { providerMessageId: `m-${sentMessages.length}` }; }
      },
      deps: {
        findPendingUploadContext: async () => ({ atendimentoId: 'at-3', token: 'tok-3' }),
        getAtendimento: async () => ({ dados_clinicos: {} }),
        completeExternalPrescriptionUpload: async (args) => { uploadCalls += 1; uploadArgs = args; return { atendimento: { id: 'at-3' } }; },
        persistUploadContext: async () => {},
        resumeTypebotAfterPrescriptionUpload: async (args) => { resumeCalls.push(args); return { ok: true }; }
      }
    });
    assert.equal(result.handled, true);
    assert.equal(result.duplicate, undefined);
    assert.equal(downloadCalls, 1);
    assert.equal(uploadCalls, 1);
    // Só a confirmação de recebimento -- o Typebot retomado em seguida já
    // informa a entrada na fila médica (grupo final do fluxo oficial), sem
    // repetir a mesma informação numa segunda mensagem do Backend.
    assert.equal(sentMessages.length, 1, 'só a confirmação exata de recebimento, uma única vez');
    assert.equal(sentMessages[0].text, PRESCRIPTION_RECEIVED_MESSAGE);
    assert.equal(sentMessages[0].text, 'Recebemos sua receita anterior com sucesso.');
    assert.equal(sentMessages[0].idempotencyKey, 'prescription-received:at-3');
    results.confirmacaoUnicaSemMensagemDuplicada = 'ok';

    assert.equal(resumeCalls.length, 1, 'retoma o Typebot automaticamente, sem depender de clique do paciente');
    assert.equal(resumeCalls[0].token, 'tok-3');
    assert.equal(resumeCalls[0].atendimentoId, 'at-3');
    results.avancaAutomaticamenteSemClique = 'ok';

    assert.equal(uploadArgs.mediaId, 'media-ok-1', 'media_id é registrado no armazenamento da receita');
    assert.equal(uploadArgs.messageId, 'msg-ok-1', 'message_id é registrado no armazenamento da receita');
    results.mediaIdEMessageIdRegistrados = 'ok';
  }

  // ---- ingestWhatsAppPrescriptionMedia: falha ao retomar o Typebot não derruba
  //      a ingestão (mídia já está salva e vinculada; resume é best-effort) ----
  {
    const sentMessages = [];
    const session = { phone: '5511985485777', metadata: { typebot_payment: { payment_status: 'paid' } } };
    const result = await ingestWhatsAppPrescriptionMedia({
      mediaId: 'media-resume-fail',
      mimeType: 'image/jpeg',
      identity: { phone: '5511985485777' },
      whatsappSession: session,
      messageId: 'msg-resume-fail',
      provider: {
        downloadMedia: async () => ({ buffer: Buffer.from('x'), mimeType: 'image/jpeg' }),
        sendTextMessage: async (p) => { sentMessages.push(p); return {}; }
      },
      deps: {
        findPendingUploadContext: async () => ({ atendimentoId: 'at-5', token: 'tok-5' }),
        getAtendimento: async () => ({ dados_clinicos: {} }),
        completeExternalPrescriptionUpload: async () => ({ atendimento: { id: 'at-5' } }),
        persistUploadContext: async () => {},
        resumeTypebotAfterPrescriptionUpload: async () => { throw new Error('typebot indisponível'); }
      }
    });
    assert.equal(result.handled, true, 'a mídia continua vinculada mesmo se a retomada automática falhar');
    assert.equal(sentMessages.length, 1, 'a confirmação já enviada não é afetada pela falha da retomada');
    assert.equal(sentMessages[0].text, 'Recebemos sua receita anterior com sucesso.');
    results.falhaNaRetomadaNaoDerrubaIngestao = 'ok';
  }

  // ---- ingestWhatsAppPrescriptionMedia: sem sessão de upload pendente (ex.:
  //      atendimento já reprovado) — nunca aceita a mídia ----
  {
    const sentMessages = [];
    let uploadCalled = false;
    const session = { phone: '5511985485777', metadata: { typebot_payment: { payment_status: 'paid' } } };
    await assert.rejects(
      ingestWhatsAppPrescriptionMedia({
        mediaId: 'media-rejected-atendimento',
        mimeType: 'image/jpeg',
        identity: { phone: '5511985485777' },
        whatsappSession: session,
        messageId: 'msg-rejected',
        provider: {
          downloadMedia: async () => { uploadCalled = true; return { buffer: Buffer.from('x'), mimeType: 'image/jpeg' }; },
          sendTextMessage: async (p) => { sentMessages.push(p); return {}; }
        },
        deps: {
          // Atendimento reprovado nunca fica com status AWAITING_PRESCRIPTION_UPLOAD
          // (ver triagem-webhook.service.js) — findPendingUploadContext não encontra nada.
          findPendingUploadContext: async () => null,
          completeExternalPrescriptionUpload: async () => { throw new Error('não deveria ser chamado'); }
        }
      }),
      (err) => err.code === 'WHATSAPP_UPLOAD_NO_SESSION'
    );
    assert.equal(uploadCalled, false, 'atendimento reprovado nunca aceita nova receita');
    results.atendimentoReprovadoNaoAceitaMidia = 'ok';
  }

  // ---- validação de formato/tamanho (previous-prescription-storage.service.js,
  //      reaproveitada sem alteração — confirma os limites exigidos) ----
  {
    assert(ALLOWED_MIME.has('image/jpeg') && ALLOWED_MIME.has('image/jpg') && ALLOWED_MIME.has('image/png') && ALLOWED_MIME.has('application/pdf'));
    assert.equal(ALLOWED_MIME.has('text/plain'), false, 'texto simples não é tratado como receita');
    assert.equal(MAX_BYTES, 10 * 1024 * 1024);

    assert.throws(() => validateBuffer(Buffer.from('conteudo'), 'text/plain'), /PRESCRIPTION_MIME_INVALID|Tipo de arquivo/);
    try {
      validateBuffer(Buffer.from('x'), 'text/plain');
      assert.fail('deveria ter lançado erro');
    } catch (err) {
      assert.equal(err.code, 'PRESCRIPTION_MIME_INVALID');
      assert(err.message && err.message.length > 0, 'arquivo inválido é recusado com mensagem clara');
    }
    results.arquivoInvalidoRecusadoComMensagemClara = 'ok';

    const oversized = Buffer.alloc(MAX_BYTES + 1);
    try {
      validateBuffer(oversized, 'image/jpeg');
      assert.fail('deveria ter lançado erro');
    } catch (err) {
      assert.equal(err.code, 'PRESCRIPTION_FILE_TOO_LARGE');
    }
    results.arquivoAcimaDe10MbRecusado = 'ok';

    validateBuffer(Buffer.from('conteudo pequeno'), 'image/jpeg'); // não lança — dentro do limite e tipo permitido
    results.arquivoValidoAceito = 'ok';
  }

  // ---- ingestWhatsAppPrescriptionMedia: mesma mídia (media_id) reenviada não duplica ----
  {
    const sentMessages = [];
    let downloadCalls = 0;
    const session = {
      phone: '5511985485777',
      metadata: {
        typebot_payment: { payment_status: 'paid' },
        typebot_prescription_upload: { processed_media_ids: ['media-dup-1'], processed_message_ids: ['msg-dup-1'] }
      }
    };
    const result = await ingestWhatsAppPrescriptionMedia({
      mediaId: 'media-dup-1',
      mimeType: 'image/jpeg',
      identity: { phone: '5511985485777' },
      whatsappSession: session,
      messageId: 'msg-dup-2',
      provider: { downloadMedia: async () => { downloadCalls += 1; return { buffer: Buffer.from('x'), mimeType: 'image/jpeg' }; }, sendTextMessage: async (p) => { sentMessages.push(p); return {}; } },
      deps: { findPendingUploadContext: async () => { throw new Error('não deveria nem buscar contexto'); } }
    });
    assert.equal(result.duplicate, true);
    assert.equal(downloadCalls, 0, 'mídia já processada não é baixada de novo');
    assert.equal(sentMessages.length, 0, 'mídia repetida não reenvia confirmação');
    results.mediaIdDuplicadaNaoReprocessa = 'ok';
  }

  // ---- ingestWhatsAppPrescriptionMedia: conteúdo já vinculado (media_id novo, atendimento já com receita) não duplica ----
  {
    const sentMessages = [];
    let downloadCalls = 0;
    let persistCalls = 0;
    const session = { phone: '5511985485777', metadata: { typebot_payment: { payment_status: 'paid' } } };
    const result = await ingestWhatsAppPrescriptionMedia({
      mediaId: 'media-new-id-same-content',
      mimeType: 'image/jpeg',
      identity: { phone: '5511985485777' },
      whatsappSession: session,
      messageId: 'msg-new-id',
      provider: { downloadMedia: async () => { downloadCalls += 1; return { buffer: Buffer.from('x'), mimeType: 'image/jpeg' }; }, sendTextMessage: async (p) => { sentMessages.push(p); return {}; } },
      deps: {
        findPendingUploadContext: async () => ({ atendimentoId: 'at-4', token: 'tok-4' }),
        getAtendimento: async () => ({ dados_clinicos: { previous_prescription_url: 'https://ja-armazenado.example/x.jpg' } }),
        persistUploadContext: async () => { persistCalls += 1; },
        completeExternalPrescriptionUpload: async () => { throw new Error('não deveria re-fazer upload'); }
      }
    });
    assert.equal(result.duplicate, true);
    assert.equal(downloadCalls, 0);
    assert.equal(persistCalls, 1, 'registra o novo media_id mesmo sem reprocessar, para futuras deduplicações');
    assert.equal(sentMessages.length, 0);
    results.conteudoJaVinculadoNaoDuplica = 'ok';
  }

  console.log(JSON.stringify(results));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
