const express = require('express');
const { randomUUID } = require('crypto');
const eligibilityEngine = require('../eligibility/engine');
const logger = require('../config/logger');
const { createAuditLog } = require('../store/audit.store');
const { createPatient } = require('../store/patients.store');
const { STATUS, createAtendimento, getAtendimento, listAtendimentos } = require('../store/atendimentos.store');
const { getRememberedWebhookResult, rememberWebhookResult } = require('../store/webhook-idempotency.store');
const { requireAuth } = require('../auth/auth.middleware');
const { getWhatsAppProviderStatus, sendPrescription, isSandboxMode } = require('../delivery/delivery.service');
const {
  buildClinicalNarrative,
  getRefusalMessage,
  PROTOCOL_VERSION
} = require('../services/clinical-intelligence.service');
const { mapTypebotPayload, INELIGIBLE_USER_MESSAGE } = require('../services/typebot-payload.mapper');
const { isVisibleInMedicalPanel } = require('../services/clinical-payload-normalizer.service');
const {
  createPrescriptionUploadSession,
  isExternalUploadEnabled
} = require('../services/prescription-upload-token.service');
const {
  createWhatsAppSupportEntry,
  closeWhatsAppSupportEntry,
  processIncomingMessage
} = require('../services/whatsapp-support.service');
const { extractMetaIdentifiers, extractStatusErrors } = require('../services/whatsapp-meta-identity.service');
const { upsertSessionIdentity } = require('../store/whatsapp-sessions.store');
const metaProvider = require('../services/providers/meta.provider');
const { createTypebotWhatsAppBridge } = require('../services/typebot-whatsapp.bridge');
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

router.post('/support', async (req, res) => {
  const auth = verifyN8nWebhookSecret(req);
  if (!auth.ok) return res.status(auth.status).json(auth.body);

  const requestId = req.requestId || 'unknown';
  const correlationId = auth.correlationId;
  const { from, phone } = req.body || {};
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.messageId || '').trim();

  try {
    const result = await createWhatsAppSupportEntry({
      phone: from || phone,
      correlationId,
      idempotencyKey,
      requestId
    });
    return res.json({
      success: true,
      correlationId,
      duplicate: result.duplicate,
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

  const { phone, from, text } = req.body || {};
  const resolvedPhone = phone || from;
  if (!resolvedPhone || !text) {
    return res.status(400).json({ success: false, error: 'phone e text obrigatórios' });
  }

  try {
    const result = await processIncomingMessage({ phone: resolvedPhone, text });
    return res.json({ success: true, reply: result.reply });
  } catch (error) {
    logger.warn('process_message_failed', { error: error.message });
    return res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
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
                        ...(identity.parentBsuid ? { parent_bsuid_confirmed: identity.parentBsuidConfirmed } : {})
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
                    const pendingUpload = await findPendingUploadContext(identity.phone);
                    if (!pendingUpload) {
                      logger.warn('whatsapp_business_media_skipped_no_upload_session', { messageId: msg.id });
                      continue;
                    }
                    try {
                      await ingestWhatsAppPrescriptionMedia({
                        ...mediaPayload,
                        identity,
                        whatsappSession,
                        messageId: msg.id
                      });
                    } catch (error) {
                      logger.error('whatsapp_business_prescription_media_failed', {
                        messageId: msg.id,
                        error: error.message,
                        code: error.code || null
                      });
                      await metaProvider.sendTextMessage({
                        to: identity.phone,
                        bsuid: identity.bsuid,
                        correlationId: msg.id,
                        idempotencyKey: `${msg.id}:upload-error`,
                        text: `Não foi possível receber a foto da receita: ${error.message}`
                      }).catch(() => {});
                      continue;
                    }
                    text = 'Conferir novamente';
                  }

                  const result = await handleTypebotWhatsAppInbound({
                    messageId: msg.id,
                    text,
                    identity,
                    whatsappSession
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
  const patientData = {
    ...mapped.patientData,
    rawMessage,
    idempotency_key: idempotencyKey || null,
    protocol_version: PROTOCOL_VERSION,
    pagamento_status: normalized.pagamento_status,
    payment_status: normalized.payment_status,
    payment_confirmed: normalized.payment_confirmed,
    queue_type: 'medical',
    validation: normalized.validation,
    prescription_upload_pending: normalized.validation?.awaiting_prescription_upload === true
  };

  const decision = eligibilityEngine.evaluate(patientData);
  const paymentConfirmed = normalized.payment_confirmed === true;
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
    pagamento_status: normalized.pagamento_status,
    status: atendimentoStatus,
    risco: canEnterMedicalQueueAfterIngest || atendimentoStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD ? 'BAIXO' : 'BLOQUEADO',
    elegibilidade: decision,
    dados_clinicos: enrichedClinicalData
  });

  if (atendimentoStatus === STATUS.AWAITING_PRESCRIPTION_UPLOAD) {
    uploadSession = await createPrescriptionUploadSession({
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
