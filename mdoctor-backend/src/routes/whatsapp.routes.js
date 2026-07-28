const express = require('express');
const { randomUUID } = require('crypto');
const eligibilityEngine = require('../eligibility/engine');
const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const { createPatient } = require('../store/patients.store');
const { STATUS, createAtendimento, getAtendimento, listAtendimentos } = require('../store/atendimentos.store');
const { getRememberedWebhookResult, rememberWebhookResult } = require('../store/webhook-idempotency.store');
const { requireAuth } = require('../auth/auth.middleware');
const {
  getWhatsAppProviderStatus,
  sendPrescription,
  sendWhatsAppText,
  isSandboxMode
} = require('../delivery/delivery.service');
const {
  buildClinicalNarrative,
  getRefusalMessage,
  PROTOCOL_VERSION
} = require('../services/clinical-intelligence.service');
const { mapTypebotPayload, INELIGIBLE_USER_MESSAGE } = require('../services/typebot-payload.mapper');
const { isVisibleInMedicalPanel } = require('../services/clinical-payload-normalizer.service');
const {
  ensurePrescriptionUploadSession,
  isExternalUploadEnabled
} = require('../services/prescription-upload-token.service');
const {
  closeWhatsAppSupportEntry,
  createWhatsAppSupportEntry,
  WELCOME_CHOICE_INPUT_ID
} = require('../services/whatsapp-support.service');
const { extractMetaIdentifiers, extractStatusErrors } = require('../services/whatsapp-meta-identity.service');
const {
  upsertSessionIdentity,
  setTypebotSessionId,
  clearTransientClinicalSessionMetadata,
  getSessionByPhone,
  clearJourneyMarkers
} = require('../store/whatsapp-sessions.store');
const metaProvider = require('../services/providers/meta.provider');
const { createTypebotWhatsAppBridge } = require('../services/typebot-whatsapp.bridge');
const { routeMetaWhatsAppInbound } = require('../services/whatsapp-meta-inbound.service');
const { claimMetaMessage, finishMetaMessage } = require('../store/whatsapp-meta-receipts.store');
const {
  findPendingUploadContext,
  ingestWhatsAppPrescriptionMedia,
  buildUploadStatusUrlByAtendimento
} = require('../services/typebot-prescription-upload.service');
const {
  applyPrescriptionMetadataToClinical,
  formatIngestError,
  ingestPreviousPrescription,
  isAlreadyStoredInBucket,
  isHttpUrl
} = require('../services/previous-prescription-storage.service');
const { resolveConfirmedWhatsAppPayment } = require('../services/typebot-payment-link.service');

const { verifyN8nWebhookSecret } = require('../middlewares/n8n-webhook-auth');

const router = express.Router();
const handleTypebotWhatsAppInbound = createTypebotWhatsAppBridge();

router.post('/ingest-previous-prescription', async (req, res) => {
  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) return res.status(auth.status).json(auth.body);

  const correlationId = auth.correlationId;
  const {
    fileUrl,
    previous_prescription_file,
    atendimento_id,
    patient_id,
    previous_prescription_storage_path,
    source = 'typebot/n8n'
  } = req.body || {};

  const resolvedUrl = String(fileUrl || previous_prescription_file || '').trim();
  if (!resolvedUrl && !previous_prescription_storage_path) {
    return res.status(400).json({
      success: false,
      error: 'Informe fileUrl ou previous_prescription_file',
      correlationId
    });
  }

  try {
    const result = await ingestPreviousPrescription({
      fileUrl: resolvedUrl,
      storagePath: previous_prescription_storage_path || null,
      atendimentoId: atendimento_id || randomUUID(),
      patientId: patient_id || null,
      correlationId,
      source
    });

    return res.json({ success: true, correlationId, ...result });
  } catch (error) {
    const formatted = formatIngestError(error);
    await createAuditLog({
      entity_type: 'previous_prescription',
      entity_id: atendimento_id || null,
      action: 'ingest_failed',
      actor: 'n8n',
      payload: { correlationId, ...formatted, fileUrl: resolvedUrl ? '[redacted]' : null }
    });
    return res.status(422).json({ success: false, correlationId, ...formatted });
  }
});

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development'
  });
});

router.get('/provider-status', async (_req, res) => {
  const requestId = _req.requestId || 'unknown';
  const correlationId = _req.correlationId || _req.get('X-Correlation-Id') || requestId;
  const providerStatus = await getWhatsAppProviderStatus();

  return res.json({
    success: true,
    correlationId,
    ...providerStatus
  });
});

router.post('/test-send', requireAuth, async (req, res) => {
  const requestId = req.requestId || 'unknown';
  const correlationId = req.correlationId || req.get('X-Correlation-Id') || requestId;
  const environmentName = String(process.env.ENVIRONMENT_NAME || process.env.NODE_ENV || '').toLowerCase();
  const sandboxEnabled = isSandboxMode();

  if (environmentName === 'production') {
    return res.status(403).json({ success: false, error: 'Endpoint disponível apenas fora de produção', correlationId });
  }

  if (!sandboxEnabled) {
    return res.status(403).json({ success: false, error: 'WHATSAPP_SANDBOX_MODE=true é obrigatório', correlationId });
  }

  const { to, message, receiptUrl, pacienteNome = 'Paciente Teste' } = req.body || {};

  if (!to || !message) {
    return res.status(400).json({ success: false, error: 'Campos obrigatórios: to e message', correlationId });
  }

  if (Array.isArray(to) || String(to).includes(',')) {
    return res.status(400).json({ success: false, error: 'Bulk send bloqueado no sandbox', correlationId });
  }

  try {
    const delivery = await sendPrescription({
      channel: 'whatsapp',
      target: to,
      receiptUrl: receiptUrl || 'https://example.invalid/receita-teste.pdf',
      pacienteNome,
      correlationId,
      idempotencyKey: `test-send:${to}:${Date.now()}`,
      manualTrigger: true
    });

    await createAuditLog({
      entity_type: 'whatsapp_test_send',
      action: 'test_send_executed',
      actor: req.user?.sub || 'backend',
      payload: {
        requestId,
        correlationId,
        to: String(to).replace(/\d(?=\d{4})/g, '*'),
        sandboxMode: true,
        provider: delivery.provider,
        providerStatus: delivery.providerStatus,
        warning: delivery.warning || null
      }
    });

    return res.json({ success: true, correlationId, sandboxMode: true, delivery });
  } catch (error) {
    await createAuditLog({
      entity_type: 'whatsapp_test_send',
      action: 'test_send_failed',
      actor: req.user?.sub || 'backend',
      payload: {
        requestId,
        correlationId,
        error: error.message,
        code: error.code || 'TEST_SEND_FAILED'
      }
    });
    return res.status(400).json({
      success: false,
      correlationId,
      error: error.message,
      code: error.code || 'TEST_SEND_FAILED'
    });
  }
});

/**
 * n8n → Meta: notificação textual (ex.: reprovação clínica).
 * Não é entrada de menu/suporte/Typebot — só envio outbound via provider Meta.
 */
router.post('/notify-text', async (req, res) => {
  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) return res.status(auth.status).json(auth.body);

  const requestId = req.requestId || 'unknown';
  const correlationId = auth.correlationId || req.get('X-Correlation-Id') || requestId;
  const idempotencyKey = String(
    req.get('Idempotency-Key') || req.body?.idempotency_key || ''
  ).trim();
  const to = String(req.body?.phone || req.body?.to || req.body?.telefone || '').replace(/\D/g, '');
  const text = String(req.body?.message || req.body?.text || '').trim();
  const atendimentoId = String(req.body?.atendimentoId || req.body?.atendimento_id || '').trim() || null;

  if (!to || !text) {
    return res.status(400).json({
      success: false,
      correlationId,
      error: 'Campos obrigatórios: phone (ou to) e message (ou text)'
    });
  }

  try {
    const delivery = await sendWhatsAppText({
      to,
      text,
      correlationId,
      idempotencyKey: idempotencyKey || `notify-text:${atendimentoId || to}:${text.slice(0, 24)}`
    });

    await createAuditLog({
      entity_type: 'whatsapp_notify_text',
      entity_id: atendimentoId,
      action: 'n8n_notify_text_sent',
      actor: 'n8n',
      payload: {
        requestId,
        correlationId,
        atendimento_id: atendimentoId,
        phone: to.replace(/\d(?=\d{4})/g, '*'),
        provider: delivery?.provider || 'meta'
      }
    });

    return res.json({
      success: true,
      correlationId,
      atendimentoId,
      delivery
    });
  } catch (error) {
    logger.warn('whatsapp_notify_text_failed', {
      correlationId,
      atendimentoId,
      error: error.message,
      code: error.code || null
    });
    return res.status(error.statusCode || 502).json({
      success: false,
      correlationId,
      error: error.message,
      code: error.code || 'NOTIFY_TEXT_FAILED'
    });
  }
});

router.post('/support', async (req, res) => {
  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) return res.status(auth.status).json(auth.body);

  logger.warn('whatsapp_legacy_support_endpoint_blocked', { correlationId: auth.correlationId });
  return res.status(410).json({
    success: false,
    deprecated: true,
    official_entry: 'POST /api/whatsapp/webhook',
    error: 'Endpoint legado desativado. Entrada oficial: Meta Cloud API webhook.',
    correlationId: auth.correlationId
  });
});

router.post('/support/close', async (req, res) => {
  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) return res.status(auth.status).json(auth.body);

  const requestId = req.requestId || 'unknown';
  const correlationId = auth.correlationId;
  const { from, phone } = req.body || {};

  try {
    const result = await closeWhatsAppSupportEntry({
      phone: from || phone,
      correlationId,
      requestId
    });
    return res.json({
      success: true,
      correlationId,
      closed: result.closed,
      reply: result.reply,
      atendimento: result.atendimento
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      correlationId,
      error: error.message
    });
  }
});

router.post('/process-message', async (req, res) => {
  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) return res.status(auth.status).json(auth.body);

  logger.warn('whatsapp_legacy_process_message_blocked', { correlationId: auth.correlationId });
  return res.status(410).json({
    success: false,
    deprecated: true,
    official_entry: 'POST /api/whatsapp/webhook',
    error: 'Endpoint legado desativado. Entrada oficial: Meta Cloud API webhook.',
    correlationId: auth.correlationId
  });
});

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'] || (req.query.hub && req.query.hub.mode);
  const token = req.query['hub.verify_token'] || (req.query.hub && req.query.hub.verify_token);
  const challenge = req.query['hub.challenge'] || (req.query.hub && req.query.hub.challenge);

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      logger.info('WhatsApp webhook verified successfully');
      return res.status(200).send(challenge);
    } else {
      logger.warn('WhatsApp webhook verification failed', { mode, tokenReceived: token ? '[provided]' : '[missing]' });
      return res.status(403).json({ success: false, error: 'Verification token mismatch or invalid mode' });
    }
  }
  return res.status(400).json({ success: false, error: 'Missing hub.mode or hub.verify_token' });
});

router.post('/webhook', async (req, res) => {
  // Check if this is a Meta WhatsApp Webhook payload
  if (req.body && req.body.object === 'whatsapp_business_account') {
    // Respond HTTP 200 quickly to Meta
    res.status(200).send('EVENT_RECEIVED');

    // Process the entries asynchronously
    (async () => {
      try {
        const entries = req.body.entry || [];
        for (const entry of entries) {
          const changes = entry.changes || [];
          for (const change of changes) {
            if (change.field === 'messages') {
              const value = change.value || {};

              // Process statuses
              if (value.statuses && Array.isArray(value.statuses)) {
                for (const status of value.statuses) {
                  const recipientId = status.recipient_id ? String(status.recipient_id) : null;
                  const recipientUserId = status.recipient_user_id ? String(status.recipient_user_id) : null;
                  const recipientParentUserId = status.recipient_parent_user_id
                    ? String(status.recipient_parent_user_id)
                    : null;

                  const statusErrors = extractStatusErrors(status);

                  logger.info('WhatsApp business status received', {
                    statusId: status.id,
                    status: status.status,
                    recipientId: recipientId ? recipientId.replace(/\d(?=\d{4})/g, '*') : null,
                    recipientUserId: recipientUserId ? '[present]' : null,
                    recipientParentUserId: recipientParentUserId ? '[present]' : null,
                    timestamp: status.timestamp,
                    ...(statusErrors.length ? { errors: statusErrors } : {})
                  });
                }
              }

              // Process messages
              if (value.messages && Array.isArray(value.messages)) {
                const contacts = Array.isArray(value.contacts) ? value.contacts : [];
                for (let i = 0; i < value.messages.length; i++) {
                  const msg = value.messages[i];
                  const contact = contacts[i] || contacts[0] || {};
                  const identity = extractMetaIdentifiers(msg, contact);

                  let text = '';
                  let mediaPayload = null;
                  if (msg.type === 'text' && msg.text) {
                    text = msg.text.body;
                  } else if (msg.type === 'image' && msg.image?.id) {
                    mediaPayload = {
                      mediaId: msg.image.id,
                      mimeType: msg.image.mime_type || 'image/jpeg',
                      filename: msg.image.filename || 'receita-whatsapp.jpg'
                    };
                  } else if (msg.type === 'document' && msg.document?.id) {
                    mediaPayload = {
                      mediaId: msg.document.id,
                      mimeType: msg.document.mime_type || 'application/pdf',
                      filename: msg.document.filename || 'receita-whatsapp.pdf'
                    };
                  } else if (msg.button && msg.button.text) {
                    text = msg.button.text;
                  } else if (msg.interactive) {
                    if (msg.interactive.button_reply) {
                      text = msg.interactive.button_reply.id || msg.interactive.button_reply.title;
                    } else if (msg.interactive.list_reply) {
                      text = msg.interactive.list_reply.id || msg.interactive.list_reply.title;
                    }
                  }

                  if (!identity.hasIdentifier || (!text && !mediaPayload)) {
                    logger.warn('whatsapp_business_message_skipped', {
                      messageId: msg.id,
                      hasIdentifier: identity.hasIdentifier,
                      hasText: Boolean(text),
                      hasMedia: Boolean(mediaPayload)
                    });
                    continue;
                  }

                  const maskedFrom = identity.phone ? identity.phone.replace(/\d(?=\d{4})/g, '*') : null;
                  logger.info('WhatsApp business message received', {
                    from: maskedFrom,
                    bsuid: identity.bsuid ? '[present]' : null,
                    messageId: msg.id,
                    type: msg.type
                  });

                  // Marcadores de jornada (métrica de tempo do painel admin — ver
                  // admin.routes.js computeTempos / whatsapp-sessions.store.js
                  // clearJourneyMarkers): "journey_started_at" grava o primeiro "Oi"
                  // do ciclo atual (só quando ainda não há marcador pendente — o
                  // anterior já foi consumido e limpo ao criar o atendimento
                  // anterior, então sua ausência aqui significa "jornada nova").
                  // "welcome_clicked_at" grava a resposta ao choice "Vamos começar"
                  // (primeiro input do Typebot), detectada pelo estado da sessão
                  // ANTES deste upsert (typebot_expected_input_id ainda aponta pra
                  // esse input). Peek somente leitura — não altera nada por si só.
                  const priorSessionForJourney = identity.phone
                    ? await getSessionByPhone(identity.phone).catch(() => null)
                    : null;
                  const journeyMarkerPatch = {};
                  if (!priorSessionForJourney?.metadata?.journey_started_at) {
                    journeyMarkerPatch.journey_started_at = new Date().toISOString();
                  }
                  if (
                    priorSessionForJourney?.metadata?.typebot_expected_input_id === WELCOME_CHOICE_INPUT_ID &&
                    !priorSessionForJourney?.metadata?.welcome_clicked_at
                  ) {
                    journeyMarkerPatch.welcome_clicked_at = new Date().toISOString();
                  }

                  let whatsappSession;
                  try {
                    whatsappSession = await upsertSessionIdentity({
                      phone: identity.phone,
                      bsuid: identity.bsuid,
                      parentBsuid: identity.parentBsuid,
                      username: identity.username,
                      metadataPatch: {
                        last_inbound_message_id: msg.id,
                        // parentBsuid é best-effort (ver whatsapp-meta-identity.service.js) —
                        // guardamos a proveniência para não ser lido como dado confirmado.
                        ...(identity.parentBsuid ? { parent_bsuid_confirmed: identity.parentBsuidConfirmed } : {}),
                        ...journeyMarkerPatch
                      }
                    });
                  } catch (e) {
                    logger.warn('whatsapp_business_session_identity_failed', { messageId: msg.id, error: e.message });
                  }

                  if (!whatsappSession) {
                    logger.warn('whatsapp_business_typebot_skipped_no_session', { messageId: msg.id });
                    continue;
                  }

                  if (mediaPayload) {
                    // FASE 5B: claim Meta antes do ingest — mesma messageId não processa duas vezes.
                    const mediaClaimed = await claimMetaMessage({
                      messageId: msg.id,
                      whatsappSessionId: whatsappSession.id
                    });
                    if (!mediaClaimed.claimed) {
                      logger.info('whatsapp_business_media_duplicate_skipped', { messageId: msg.id });
                      continue;
                    }

                    let pendingUpload = null;
                    try {
                      pendingUpload = await findPendingUploadContext(identity.phone, { whatsappSession });
                    } catch (lookupError) {
                      logger.error('whatsapp_business_media_upload_lookup_failed', {
                        messageId: msg.id,
                        error: lookupError.message,
                        code: lookupError.code || null,
                        atendimentoIds: lookupError.atendimentoIds || null
                      });
                      await finishMetaMessage({
                        messageId: msg.id,
                        status: 'failed',
                        errorMessage: lookupError.message
                      });
                      await metaProvider.sendTextMessage({
                        to: identity.phone,
                        bsuid: identity.bsuid,
                        correlationId: msg.id,
                        idempotencyKey: `${msg.id}:upload-ambiguous`,
                        text: lookupError.code === 'WHATSAPP_UPLOAD_AMBIGUOUS_ATENDIMENTO'
                          ? 'Encontramos mais de um atendimento aguardando receita neste número. Nossa equipe vai revisar — não envie o arquivo novamente por enquanto.'
                          : `Não foi possível receber a foto da receita: ${lookupError.message}`
                      }).catch(() => {});
                      continue;
                    }

                    if (!pendingUpload) {
                      logger.warn('whatsapp_business_media_skipped_no_upload_session', { messageId: msg.id });
                      await finishMetaMessage({
                        messageId: msg.id,
                        status: 'failed',
                        errorMessage: 'no_upload_session'
                      });
                      await metaProvider.sendTextMessage({
                        to: identity.phone,
                        bsuid: identity.bsuid,
                        correlationId: msg.id,
                        idempotencyKey: `${msg.id}:no-upload-session`,
                        text: 'Não localizamos uma solicitação aguardando o envio de documentos no momento.\n\nSe você já concluiu ou teve sua solicitação encerrada, não é necessário reenviar.\n\nEm caso de dúvida, digite 2 para falar com o suporte.'
                      }).catch(() => {});
                      continue;
                    }

                    try {
                      const ingestResult = await ingestWhatsAppPrescriptionMedia({
                        ...mediaPayload,
                        identity,
                        whatsappSession,
                        messageId: msg.id
                      });
                      await finishMetaMessage({
                        messageId: msg.id,
                        status: 'processed',
                        providerMessageIds: []
                      });

                      // FASE 5B: um único continueChat por upload — não reenviar "Conferir novamente" no bridge.
                      const resume = ingestResult?.whatsappResume || {};
                      if (resume.ok === true || resume.alreadyResumed === true || ingestResult?.alreadyProcessed) {
                        logger.info('WhatsApp business prescription media processed', {
                          from: maskedFrom,
                          messageId: msg.id,
                          duplicate: Boolean(ingestResult.duplicate),
                          alreadyProcessed: Boolean(ingestResult.alreadyProcessed),
                          resumeOk: resume.ok === true,
                          alreadyResumed: Boolean(resume.alreadyResumed)
                        });
                        continue;
                      }

                      logger.warn('whatsapp_business_media_resume_incomplete', {
                        messageId: msg.id,
                        resumeCode: resume.code || null
                      });
                      continue;
                    } catch (error) {
                      logger.error('whatsapp_business_prescription_media_failed', {
                        messageId: msg.id,
                        error: error.message,
                        code: error.code || null
                      });
                      await finishMetaMessage({
                        messageId: msg.id,
                        status: 'failed',
                        errorMessage: error.message
                      });
                      await metaProvider.sendTextMessage({
                        to: identity.phone,
                        bsuid: identity.bsuid,
                        correlationId: msg.id,
                        idempotencyKey: `${msg.id}:upload-error`,
                        text: error.code === 'WHATSAPP_UPLOAD_AMBIGUOUS_ATENDIMENTO'
                          ? 'Encontramos mais de um atendimento aguardando receita neste número. Nossa equipe vai revisar — não envie o arquivo novamente por enquanto.'
                          : `Não foi possível receber a foto da receita: ${error.message}`
                      }).catch(() => {});
                      continue;
                    }
                  }

                  const inboundRoute = await routeMetaWhatsAppInbound({
                    phone: identity.phone,
                    text,
                    whatsappSession,
                    messageId: msg.id
                  });

                  if (inboundRoute.clearClinicalMetadata) {
                    const cleared = await clearTransientClinicalSessionMetadata({ whatsappSession });
                    if (cleared) {
                      whatsappSession = cleared;
                    }
                  } else if (inboundRoute.clearTypebotSession) {
                    await setTypebotSessionId({
                      sessionId: whatsappSession.id,
                      typebotSessionId: null
                    });
                    whatsappSession = { ...whatsappSession, typebot_session_id: null };
                  }

                  if (inboundRoute.action === 'reply') {
                    const claimed = await claimMetaMessage({
                      messageId: msg.id,
                      whatsappSessionId: whatsappSession.id
                    });
                    if (!claimed.claimed) continue;

                    const sent = await metaProvider.sendTextMessage({
                      to: identity.phone,
                      bsuid: identity.bsuid,
                      correlationId: msg.id,
                      idempotencyKey: `${msg.id}:menu`,
                      text: inboundRoute.reply
                    });
                    await finishMetaMessage({
                      messageId: msg.id,
                      status: 'processed',
                      providerMessageIds: sent?.providerMessageId ? [sent.providerMessageId] : []
                    });
                    logger.info('WhatsApp business menu reply sent', {
                      from: maskedFrom,
                      messageId: msg.id
                    });
                    continue;
                  }

                  if (inboundRoute.action === 'typebot_bootstrap') {
                    await setTypebotSessionId({
                      sessionId: whatsappSession.id,
                      typebotSessionId: null
                    });
                    whatsappSession = { ...whatsappSession, typebot_session_id: null };
                  }

                  const result = await handleTypebotWhatsAppInbound({
                    messageId: msg.id,
                    text: inboundRoute.text ?? text,
                    identity,
                    whatsappSession,
                    menuBootstrap: inboundRoute.action === 'typebot_bootstrap'
                  });
                  logger.info('WhatsApp business message processed', {
                    from: maskedFrom,
                    bsuid: identity.bsuid ? '[present]' : null,
                    duplicate: result.duplicate,
                    responsesSent: result.responsesSent,
                    sessionIdReused: result.sessionIdReused
                  });
                }
              }
            } else if (change.field === 'account_update') {
              // Documentado: evento PARTNER_REMOVED traz disconnection_info
              // com reason/initiated_by. Nenhum telefone é exposto aqui.
              const value = change.value || {};
              logger.info('WhatsApp coexistence account_update received', {
                event: value.event || null,
                disconnectionReason: value.disconnection_info?.reason || null,
                initiatedBy: value.disconnection_info?.initiated_by || null
              });
            } else if (['history', 'smb_app_state_sync', 'smb_message_echoes'].includes(change.field)) {
              // Preparado para receber sem quebrar/expor dado sensível — não
              // sincroniza nem persiste histórico/contatos/ecos (fora do
              // escopo desta etapa). Nomes exatos dos subcampos de cada
              // payload ainda não foram confirmados contra um evento real da
              // Meta, então só logamos as chaves de topo, nunca conteúdo.
              const value = change.value || {};
              logger.info('WhatsApp coexistence webhook received', {
                field: change.field,
                valueKeys: Object.keys(value)
              });
            } else {
              logger.info('WhatsApp business webhook field ignored', { field: change.field || null });
            }
          }
        }
      } catch (err) {
        logger.error('Error processing WhatsApp business account webhook asynchronously', { error: err.message });
      }
    })();
    return;
  }

  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) {
    const requestId = req.requestId || 'unknown';
    const correlationId = auth.body?.correlationId || req.correlationId || requestId;
    logger.warn('whatsapp_webhook_unauthorized', { requestId, correlationId });
    await createAuditLog({
      entity_type: 'whatsapp_webhook',
      action: 'webhook_unauthorized',
      actor: 'n8n',
      payload: { requestId, correlationId }
    });
    return res.status(auth.status).json(auth.body);
  }

  const requestId = req.requestId || 'unknown';
  const correlationId = auth.correlationId;

  if (auth.devFallback) {
    logger.warn('whatsapp_webhook_secret_not_configured', {
      requestId,
      correlationId,
      mode: 'dev_fallback_allowed'
    });
  }

  const { from, text = '', rawMessage } = req.body || {};
  const headerIdempotencyKey = String(req.get('Idempotency-Key') || '').trim();
  const payloadMessageId = String(rawMessage?.messageId || req.body?.messageId || '').trim();
  const idempotencyKey = headerIdempotencyKey || payloadMessageId;

  if (!from) return res.status(400).json({ success: false, error: 'from obrigatório', correlationId });

  if (idempotencyKey) {
    const remembered = await getRememberedWebhookResult(idempotencyKey);
    if (remembered?.atendimentoId) {
      const rememberedAtendimento = await getAtendimento(remembered.atendimentoId);
      if (rememberedAtendimento?.origem === 'whatsapp') {
        await createAuditLog({
          entity_type: 'whatsapp_webhook',
          entity_id: rememberedAtendimento.id,
          action: 'webhook_duplicate_ignored',
          actor: 'n8n',
          payload: {
            requestId,
            correlationId,
            from,
            idempotencyKey,
            source: 'memory_cache',
            atendimento_id: rememberedAtendimento.id
          }
        });

        return res.json({
          success: true,
          duplicate: true,
          idempotencyKey,
          correlationId,
          reply: remembered.reply || 'Solicitação já recebida anteriormente.',
          patient: null,
          atendimento: rememberedAtendimento,
          decision: remembered.decision || rememberedAtendimento.elegibilidade || null
        });
      }
    }

    const history = await listAtendimentos();
    const duplicated = history.find((item) => {
      if (item?.origem !== 'whatsapp') return false;
      const itemClinical = item?.dados_clinicos || {};
      const itemRawMessage = itemClinical.rawMessage || {};
      const storedKey = String(itemClinical.idempotency_key || '').trim();
      const storedMessageId = String(itemRawMessage.messageId || '').trim();
      return storedKey === idempotencyKey || storedMessageId === idempotencyKey;
    });

    if (duplicated) {
      const reply = duplicated.elegibilidade?.eligible
        ? 'Recebemos seus dados. Sua solicitação entrou na fila médica para análise.'
        : `Não foi possível seguir com renovação automática: ${duplicated.elegibilidade?.reason || 'Solicitação inelegível'}. Procure atendimento médico.`;

      await createAuditLog({
        entity_type: 'whatsapp_webhook',
        entity_id: duplicated.id,
        action: 'webhook_duplicate_ignored',
        actor: 'n8n',
        payload: {
          requestId,
          correlationId,
          from,
          idempotencyKey,
          source: 'persistent_lookup',
          atendimento_id: duplicated.id
        }
      });

      await rememberWebhookResult(
        idempotencyKey,
        {
          atendimentoId: duplicated.id,
          decision: duplicated.elegibilidade || null,
          reply
        },
        { source: 'whatsapp' }
      );

      return res.json({
        success: true,
        duplicate: true,
        idempotencyKey,
        correlationId,
        reply,
        patient: null,
        atendimento: duplicated,
        decision: duplicated.elegibilidade || null
      });
    }
  }

  const mapped = mapTypebotPayload({
    ...(req.body || {}),
    from,
    text,
    rawMessage,
    correlationId,
    correlation_id: correlationId
  });
  const originalPayload = mapped.original;
  const normalized = mapped.normalized;

  // FASE 4B: pagamento confirmado somente via Checkout Stripe da sessão WhatsApp.
  // payment_status="paid" do Typebot NÃO confirma o atendimento.
  const stripePayment = await resolveConfirmedWhatsAppPayment({
    phone: normalized.whatsapp || from,
    paymentToken: req.body?.payment_token || originalPayload?.payment_token || null
  });
  const paymentConfirmed = stripePayment.confirmed === true;
  const pagamentoStatus = paymentConfirmed ? 'CONFIRMADO' : 'PENDENTE';
  const paymentStatus = paymentConfirmed ? 'paid' : 'unpaid';

  if (paymentConfirmed) {
    normalized.payment_status = paymentStatus;
    normalized.pagamento_status = pagamentoStatus;
    normalized.payment_confirmed = true;
    if (normalized.validation) {
      normalized.validation.payment_confirmed = true;
      const hasPreviousRx = normalized.has_previous_prescription === true;
      const prescriptionFile = String(normalized.previous_prescription_file || '').trim();
      const requiredOk = normalized.validation.required?.ok !== false;
      const awaitingAfterPay =
        isExternalUploadEnabled() && hasPreviousRx && !prescriptionFile && requiredOk;
      normalized.validation.awaiting_prescription_upload = awaitingAfterPay;
      normalized.validation.can_enter_medical_queue =
        normalized.eligibility_status === 'eligible' &&
        requiredOk &&
        Boolean(prescriptionFile) &&
        !awaitingAfterPay;
    }
  } else {
    normalized.payment_status = paymentStatus;
    normalized.pagamento_status = pagamentoStatus;
    normalized.payment_confirmed = false;
    if (normalized.validation) {
      normalized.validation.payment_confirmed = false;
      normalized.validation.awaiting_prescription_upload = false;
      normalized.validation.can_enter_medical_queue = false;
    }
  }

  const patientData = {
    ...mapped.patientData,
    rawMessage,
    idempotency_key: idempotencyKey || null,
    protocol_version: PROTOCOL_VERSION,
    pagamento_status: pagamentoStatus,
    payment_status: paymentStatus,
    payment_confirmed: paymentConfirmed,
    payment_token: paymentConfirmed ? stripePayment.payment_token : null,
    checkout_session_id: paymentConfirmed ? stripePayment.checkout_session_id : null,
    queue_type: 'medical',
    validation: normalized.validation,
    prescription_upload_pending: normalized.validation?.awaiting_prescription_upload === true
  };

  const decision = eligibilityEngine.evaluate(patientData);
  const canEnterMedicalQueue =
    normalized.validation?.can_enter_medical_queue === true && decision.eligible === true && paymentConfirmed;

  if (!paymentConfirmed && decision.eligible) {
    decision.eligible = false;
    decision.reason = 'Pagamento não confirmado';
    decision.reasonCode = 'pagamento_pendente';
    decision.riskLevel = 'BLOQUEADO';
    decision.renewalStatus = 'insegura';
  }

  if (normalized.eligibility_status === 'ineligible' && decision.eligible) {
    decision.eligible = false;
    decision.reason = normalized.ineligibility_reason || decision.reason;
    decision.reasonCode = decision.reasonCode || 'consulta_presencial';
    decision.riskLevel = 'BLOQUEADO';
  }
  const clinicalNarrative = buildClinicalNarrative({
    patientName: from,
    condition: patientData.condition,
    medication: originalPayload?.medicamento || originalPayload?.medicacao_em_uso || 'medicação em uso contínuo',
    decision
  });

  const plannedAtendimentoId =
    String(originalPayload?.atendimento_id || originalPayload?.atendimentoId || '').trim() || randomUUID();
  let prescriptionMeta = null;
  let prescriptionIngestError = null;
  let uploadSession = null;
  const externalUpload = isExternalUploadEnabled();
  const awaitingExternalUpload = normalized.validation?.awaiting_prescription_upload === true;
  const hasPreviousRx = normalized.has_previous_prescription === true;

  const incomingFile = String(
    normalized.previous_prescription_file ||
      originalPayload?.previous_prescription_file ||
      originalPayload?.foto_receita_url ||
      ''
  ).trim();

  const incomingStoragePath = originalPayload?.previous_prescription_storage_path || null;

  if (incomingFile || incomingStoragePath) {
    const alreadyStored =
      isAlreadyStoredInBucket({ fileUrl: incomingFile, storagePath: incomingStoragePath }) &&
      Boolean(originalPayload?.previous_prescription_url || incomingFile);

    if (alreadyStored) {
      prescriptionMeta = {
        previous_prescription_url: originalPayload?.previous_prescription_url || incomingFile,
        previous_prescription_storage_path: incomingStoragePath,
        previous_prescription_mime_type: originalPayload?.previous_prescription_mime_type || null,
        previous_prescription_size: originalPayload?.previous_prescription_size || null,
        previous_prescription_uploaded_at: originalPayload?.previous_prescription_uploaded_at || null,
        previous_prescription_source: originalPayload?.previous_prescription_source || 'typebot/n8n',
        foto_receita_url: originalPayload?.previous_prescription_url || incomingFile,
        previous_prescription_file: originalPayload?.previous_prescription_url || incomingFile
      };
    } else if (isHttpUrl(incomingFile)) {
      try {
        prescriptionMeta = await ingestPreviousPrescription({
          fileUrl: incomingFile,
          storagePath: incomingStoragePath,
          atendimentoId: plannedAtendimentoId,
          correlationId,
          source: 'typebot/n8n'
        });
      } catch (error) {
        prescriptionIngestError = formatIngestError(error);
        if (!externalUpload || !awaitingExternalUpload) {
          decision.eligible = false;
          decision.reason = prescriptionIngestError.message;
          decision.reasonCode = prescriptionIngestError.code || 'receita_anterior_invalida';
          decision.riskLevel = 'BLOQUEADO';
          decision.renewalStatus = 'insegura';
          normalized.eligibility_status = 'ineligible';
          normalized.ineligibility_reason = prescriptionIngestError.message;
        }
      }
    }
  } else if (decision.eligible && !externalUpload) {
    prescriptionIngestError = formatIngestError({
      code: 'PRESCRIPTION_FILE_MISSING',
      message: 'Receita anterior ou foto ausente'
    });
    decision.eligible = false;
    decision.reason = prescriptionIngestError.message;
    decision.reasonCode = 'sem_comprovacao';
    decision.riskLevel = 'BLOQUEADO';
    normalized.eligibility_status = 'ineligible';
    normalized.ineligibility_reason = prescriptionIngestError.message;
  }

  const canEnterMedicalQueueAfterIngest =
    normalized.validation?.can_enter_medical_queue === true &&
    decision.eligible === true &&
    paymentConfirmed &&
    prescriptionMeta?.previous_prescription_url &&
    !prescriptionIngestError;

  let atendimentoStatus = canEnterMedicalQueueAfterIngest ? STATUS.QUEUE : STATUS.REJECTED;
  if (
    decision.eligible &&
    paymentConfirmed &&
    normalized.eligibility_status !== 'ineligible' &&
    awaitingExternalUpload &&
    !prescriptionMeta?.previous_prescription_url
  ) {
    atendimentoStatus = STATUS.AWAITING_PRESCRIPTION_UPLOAD;
  }

  // Marcadores de jornada (métrica de tempo do painel admin — ver
  // admin.routes.js computeTempos): consumidos aqui, no exato momento em que
  // "o n8n envia os dados para o painel médico" (fim do Tempo de Triagem —
  // atendimento.criado_em já cumpre esse papel; nada novo precisa ser
  // gravado para ele). Copiados para dados_clinicos.jornada e, logo após a
  // criação do atendimento, removidos da sessão (best-effort) para que a
  // PRÓXIMA jornada deste telefone não herde os marcadores desta.
  const journeyPhone = normalized.whatsapp || from;
  const journeySession = journeyPhone ? await getSessionByPhone(journeyPhone).catch(() => null) : null;
  const jornada = {
    primeiro_oi_em: journeySession?.metadata?.journey_started_at || null,
    triagem_iniciada_em: journeySession?.metadata?.welcome_clicked_at || null
  };

  const enrichedClinicalData = applyPrescriptionMetadataToClinical(
    {
    ...patientData,
    original_payload: originalPayload,
    normalized_payload: mapped.normalized,
    clean_payload: patientData.typebot_variables,
    typebot_variables: patientData.typebot_variables,
    medications: normalized.medications || [],
    foto_receita_url: prescriptionMeta?.foto_receita_url || normalized.previous_prescription_file || null,
    queue_type: 'medical',
    protocol_version: PROTOCOL_VERSION,
    payment_token: paymentConfirmed ? stripePayment.payment_token : null,
    checkout_session_id: paymentConfirmed ? stripePayment.checkout_session_id : null,
    stripe_payment: paymentConfirmed
      ? {
          checkout_session_id: stripePayment.checkout_session_id,
          payment_token: stripePayment.payment_token,
          confirmed_at: new Date().toISOString(),
          source: 'stripe_checkout',
          reason: stripePayment.reason || null
        }
      : null,
    jornada,
    clinical_summary: clinicalNarrative.summary,
    queixa_principal: clinicalNarrative.chiefComplaint,
    historico_clinico: clinicalNarrative.clinicalHistory,
    exame_fisico_telemedicina: clinicalNarrative.teleExam,
    conduta_sugerida: clinicalNarrative.conduct,
    orientacoes_clinicas: clinicalNarrative.guidance,
    decision_meta: {
      reasonCode: decision.reasonCode || null,
      criteriaUsed: decision.criteriaUsed || [],
      riskLevel: decision.riskLevel || null,
      renewalStatus: decision.renewalStatus || null,
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION
    },
    idempotency_key: idempotencyKey || null,
    clinical_audit: {
      correlationId,
      idempotencyKey: idempotencyKey || null,
      mode: 'mock',
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION,
      terms_presented: normalized.terms_presented || null,
      terms_accepted: normalized.terms_accepted || null,
      accepted_terms_links: normalized.accepted_terms_links || [],
      accepted_terms_at: normalized.accepted_terms_at || null,
      typebot_public_id: normalized.typebot_public_id || null,
      consent_source: normalized.source || 'typebot'
    },
    terms_acceptance: {
      lgpd_accepted: normalized.lgpd_accepted === true,
      privacy_policy_accepted: normalized.privacy_policy_accepted === true,
      telemedicine_consent_accepted: normalized.telemedicine_consent_accepted === true,
      non_urgency_notice_accepted: normalized.non_urgency_notice_accepted === true,
      terms_of_use_accepted: normalized.terms_of_use_accepted === true,
      accepted_terms_at: normalized.accepted_terms_at || null,
      accepted_terms_links: normalized.accepted_terms_links || [],
      terms_presented: normalized.terms_presented || null,
      typebot_public_id: normalized.typebot_public_id || null
    },
    prescription_ingest: prescriptionIngestError
      ? { ok: false, ...prescriptionIngestError }
      : prescriptionMeta
        ? { ok: true, storage_path: prescriptionMeta.previous_prescription_storage_path }
        : null,
    prescription_upload_pending: atendimentoStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD,
    external_upload_mode: externalUpload
  },
    prescriptionMeta || {}
  );

  const patient = await createPatient({
    ...patientData,
    status:
      canEnterMedicalQueueAfterIngest || atendimentoStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD ? 'pending' : 'rejected'
  });
  const atendimento = await createAtendimento({
    id: plannedAtendimentoId,
    ...patientData,
    origem: 'whatsapp',
    paciente_nome: normalized.patient_name || from,
    paciente_telefone: normalized.whatsapp || from,
    paciente_cpf: normalized.cpf,
    paciente_email: normalized.email,
    condicao: normalized.chronic_condition_label || normalized.chronic_condition,
    pagamento_status: pagamentoStatus,
    status: atendimentoStatus,
    risco: canEnterMedicalQueueAfterIngest || atendimentoStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD ? 'BAIXO' : 'BLOQUEADO',
    elegibilidade: decision,
    dados_clinicos: enrichedClinicalData
  });

  if (journeySession?.id) {
    try {
      await clearJourneyMarkers(journeyPhone);
    } catch (e) {
      logger.warn('whatsapp_journey_markers_clear_failed', {
        atendimentoId: atendimento.id,
        correlationId,
        error: e.message
      });
    }
  }

  if (atendimentoStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD) {
    uploadSession = await ensurePrescriptionUploadSession({
      atendimentoId: atendimento.id,
      correlationId
    });
  }

  const reply = canEnterMedicalQueueAfterIngest
    ? 'Recebemos seus dados. Sua solicitação entrou na fila médica para análise.'
    : uploadSession?.uploadUrl
      ? 'Envie agora uma foto legível ou um arquivo em PDF da sua receita anterior nesta conversa do WhatsApp. Formatos aceitos: JPG, JPEG, PNG ou PDF (até 10 MB).'
      : !paymentConfirmed
        ? 'Pagamento não confirmado. Sua solicitação não entrou na fila médica.'
        : `${INELIGIBLE_USER_MESSAGE} ${getRefusalMessage(decision.reasonCode)}`.trim();

  await createAuditLog({
    entity_type: 'whatsapp_webhook',
    entity_id: atendimento.id,
    action: 'webhook_processed',
    actor: 'n8n',
    payload: {
      requestId,
      correlationId,
      from,
      idempotencyKey: idempotencyKey || null,
      eligible: decision.eligible,
      payment_confirmed: paymentConfirmed,
      can_enter_medical_queue: canEnterMedicalQueueAfterIngest,
      prescription_ingest_ok: Boolean(prescriptionMeta?.previous_prescription_url),
      prescription_ingest_error: prescriptionIngestError?.message || null,
      panel_visible: isVisibleInMedicalPanel(atendimento),
      atendimento_id: atendimento.id,
      criteriaUsed: decision.criteriaUsed || [],
      reasonCode: decision.reasonCode || null,
      protocolVersion: decision.protocolVersion || PROTOCOL_VERSION
    }
  });

  if (idempotencyKey) {
    await rememberWebhookResult(
      idempotencyKey,
      {
        atendimentoId: atendimento.id,
        decision,
        reply
      },
      { source: 'whatsapp' }
    );
  }

  return res.json({
    success: true,
    correlationId,
    reply,
    patient,
    atendimento,
    decision,
    upload_url: uploadSession?.uploadUrl || null,
    upload_status_url: uploadSession ? buildUploadStatusUrlByAtendimento(atendimento.id) : null,
    upload_status: uploadSession ? 'pending' : null,
    upload_expires_at: uploadSession?.expiresAt || null,
    awaiting_prescription_upload: atendimento.status === STATUS.AWAITING_PRESCRIPTION_UPLOAD
  });
});

module.exports = router;
