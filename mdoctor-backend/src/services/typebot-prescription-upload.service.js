const T = require('../db/tables');
const { STATUS, listAtendimentos, getAtendimento } = require('../store/atendimentos.store');
const { getSessionByPhone, upsertSessionIdentity } = require('../store/whatsapp-sessions.store');
const { dbQuery } = require('../db/persistence');
const { createIntegrationError } = require('../store/integration-logs.store');
const { hasStoredPreviousPrescription } = require('./clinical-payload-normalizer.service');
const { completeExternalPrescriptionUpload } = require('./prescription-upload.service');
const { resolveTokenRecord } = require('./prescription-upload-token.service');
const metaProvider = require('./providers/meta.provider');

const UPLOAD_SUCCESS_REPLY = 'Conferir novamente';

const UPLOAD_CHOICE_INPUT_IDS = new Set([
  'blk_upload_check',
  'blk_upload_pending_choice'
]);

const UPLOAD_CONFIRM_VALUES = new Set([
  'já enviei a receita',
  'ja enviei a receita',
  'check',
  'conferir novamente'
]);

function normalizePhone(value = '') {
  let digits = String(value).replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 11 || digits.length === 10) digits = `55${digits}`;
  return digits;
}

function phonesMatch(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (!left || !right) return false;
  return left === right || left.endsWith(right.slice(-11)) || right.endsWith(left.slice(-11));
}

function getPublicBackendBaseUrl() {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim();
  if (base) return base.replace(/\/$/, '');
  return '';
}

function buildUploadStatusUrl(token) {
  const base = getPublicBackendBaseUrl();
  if (!base || !token) return null;
  return `${base}/api/upload-receita/${encodeURIComponent(token)}/status`;
}

function buildUploadStatusUrlByAtendimento(atendimentoId) {
  const base = getPublicBackendBaseUrl();
  if (!base || !atendimentoId) return null;
  return `${base}/api/atendimentos/${encodeURIComponent(atendimentoId)}/prescription-upload/status`;
}

function resolveUploadStatus(clinical = {}) {
  const uploaded = hasStoredPreviousPrescription(clinical);
  if (uploaded) {
    return {
      upload_completed: true,
      upload_status: 'completed',
      foto_receita_url:
        clinical.foto_receita_url ||
        clinical.previous_prescription_url ||
        clinical.previous_prescription_file ||
        null
    };
  }
  const sessionStatus = clinical.prescription_upload_session?.status;
  return {
    upload_completed: false,
    upload_status: sessionStatus === 'completed' ? 'completed' : 'pending',
    foto_receita_url: null
  };
}

async function getPrescriptionUploadStatusByAtendimentoId(atendimentoId) {
  const id = String(atendimentoId || '').trim();
  if (!id) return { found: false, upload_completed: false, upload_status: 'pending' };

  const atendimento = await getAtendimento(id);
  if (!atendimento) return { found: false, upload_completed: false, upload_status: 'pending' };

  const clinical = atendimento.dados_clinicos || {};
  const status = resolveUploadStatus(clinical);
  return {
    found: true,
    atendimento_id: atendimento.id,
    atendimento_status: atendimento.status,
    upload_completed: status.upload_completed ? 'true' : 'false',
    upload_status: status.upload_status,
    foto_receita_url: status.foto_receita_url,
    message: status.upload_completed
      ? 'Receita anterior vinculada ao atendimento'
      : 'Aguardando envio da receita anterior nesta conversa do WhatsApp'
  };
}

function extractUploadSession(atendimento = {}) {
  const clinical = atendimento.dados_clinicos || atendimento.clinical_data || {};
  const session = clinical.prescription_upload_session || {};
  const token = session.token || null;
  if (!token) return null;
  return {
    atendimentoId: atendimento.id,
    token,
    uploadUrl: session.upload_url || null,
    uploadStatusUrl: buildUploadStatusUrlByAtendimento(atendimento.id) || buildUploadStatusUrl(token),
    status: atendimento.status
  };
}

function listPendingUploadMatches(phone, rows = []) {
  return rows.filter((row) => {
    if (!phonesMatch(row.paciente_telefone, phone)) return false;
    if (!extractUploadSession(row)) return false;
    if (hasStoredPreviousPrescription(row.dados_clinicos || {})) return false;
    return true;
  });
}

/**
 * FASE 5B: prioriza contexto da sessão WhatsApp; fallback por telefone só sem ambiguidade.
 */
async function findPendingUploadContext(phone, { whatsappSession = null } = {}) {
  const fromSession = uploadContextFromSession(whatsappSession, null);
  if (fromSession?.token && fromSession?.atendimentoId) {
    const atendimento = await getAtendimento(fromSession.atendimentoId);
    if (atendimento) {
      const clinical = atendimento.dados_clinicos || {};
      const hasSession = Boolean(clinical.prescription_upload_session?.token);
      const awaiting =
        String(atendimento.status || '').toLowerCase() === STATUS.AWAITING_PRESCRIPTION_UPLOAD ||
        clinical.prescription_upload_pending === true;
      if (hasSession && awaiting && !hasStoredPreviousPrescription(clinical)) {
        return {
          ...fromSession,
          uploadStatusUrl:
            fromSession.uploadStatusUrl ||
            buildUploadStatusUrlByAtendimento(fromSession.atendimentoId) ||
            buildUploadStatusUrl(fromSession.token)
        };
      }
    }
  }

  const rows = await listAtendimentos({ status: STATUS.AWAITING_PRESCRIPTION_UPLOAD });
  const matches = listPendingUploadMatches(phone, rows);

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    const err = new Error(
      'Mais de um atendimento aguardando receita anterior para este telefone. Não é possível vincular a mídia automaticamente.'
    );
    err.code = 'WHATSAPP_UPLOAD_AMBIGUOUS_ATENDIMENTO';
    err.statusCode = 409;
    err.atendimentoIds = matches.map((row) => row.id);
    throw err;
  }

  return extractUploadSession(matches[0]);
}

/**
 * Contexto de upload só via findPendingUploadContext (sessão válida + AWAITING,
 * sem receita anexada). Sem fallback histórico amplo por listAtendimentos().
 * Atendimento entregue/finalizado/antigo → null.
 */
async function findUploadContextForPhone(phone, { whatsappSession = null } = {}) {
  return findPendingUploadContext(phone, { whatsappSession });
}

function readProcessedIds(whatsappSession = {}) {
  const meta = whatsappSession?.metadata?.typebot_prescription_upload || {};
  return {
    mediaIds: Array.isArray(meta.processed_media_ids) ? meta.processed_media_ids.map(String) : [],
    messageIds: Array.isArray(meta.processed_message_ids) ? meta.processed_message_ids.map(String) : []
  };
}

async function persistUploadContext({ identity, uploadContext, processedMediaId = null, processedMessageId = null }) {
  if (!uploadContext && !processedMediaId && !processedMessageId) return;

  const current = identity?.phone
    ? await getSessionByPhone(identity.phone).catch(() => null)
    : null;
  const existingMeta = current?.metadata?.typebot_prescription_upload || {};
  const mediaIds = Array.isArray(existingMeta.processed_media_ids)
    ? existingMeta.processed_media_ids.map(String)
    : [];
  const messageIds = Array.isArray(existingMeta.processed_message_ids)
    ? existingMeta.processed_message_ids.map(String)
    : [];

  if (processedMediaId && !mediaIds.includes(String(processedMediaId))) {
    mediaIds.push(String(processedMediaId));
  }
  if (processedMessageId && !messageIds.includes(String(processedMessageId))) {
    messageIds.push(String(processedMessageId));
  }

  const base = uploadContext
    ? {
        atendimento_id: uploadContext.atendimentoId,
        token: uploadContext.token,
        upload_url: uploadContext.uploadUrl,
        upload_status_url: uploadContext.uploadStatusUrl
      }
    : {
        atendimento_id: existingMeta.atendimento_id || null,
        token: existingMeta.token || null,
        upload_url: existingMeta.upload_url || null,
        upload_status_url: existingMeta.upload_status_url || null
      };

  await upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: {
      typebot_prescription_upload: {
        ...existingMeta,
        ...base,
        processed_media_ids: mediaIds.slice(-20),
        processed_message_ids: messageIds.slice(-20)
      }
    }
  });
}

function uploadContextFromSession(whatsappSession = {}, fallback = null) {
  const stored = whatsappSession?.metadata?.typebot_prescription_upload;
  if (stored?.token && stored?.atendimento_id) {
    return {
      atendimentoId: stored.atendimento_id,
      token: stored.token,
      uploadUrl: stored.upload_url || null,
      uploadStatusUrl:
        stored.upload_status_url ||
        buildUploadStatusUrlByAtendimento(stored.atendimento_id) ||
        buildUploadStatusUrl(stored.token)
    };
  }
  return fallback;
}

async function getUploadStatus(token) {
  const record = await resolveTokenRecord(token);
  if (!record) return { found: false, upload_completed: false, upload_status: 'pending' };
  return getPrescriptionUploadStatusByAtendimentoId(record.atendimentoId);
}

function isUploadConfirmationText(text = '') {
  return UPLOAD_CONFIRM_VALUES.has(String(text || '').trim().toLowerCase());
}

function isUploadChoiceInput(inputId) {
  return UPLOAD_CHOICE_INPUT_IDS.has(String(inputId || '').trim());
}

function outputsContainUrl(outputs = [], url = '') {
  const target = String(url || '').trim();
  if (!target) return false;
  return outputs.some((output) => output.kind === 'text' && String(output.text || '').includes(target));
}

/**
 * Somente IDs estruturais oficiais de upload.
 * Textos de LGPD (“receita digital”, PDFs https) NÃO acionam estágio de upload.
 */
function responseLooksLikeUploadStage(typebot = {}, expectedInputId = null) {
  return isUploadChoiceInput(expectedInputId) || isUploadChoiceInput(typebot.input?.id);
}

function augmentOutputsWithUploadLink(outputs = [], uploadContext = null) {
  const whatsappHint = {
    kind: 'text',
    text: 'Envie agora uma foto legível ou um arquivo em PDF da sua receita anterior nesta conversa do WhatsApp.\n\nFormatos aceitos: JPG, JPEG, PNG ou PDF (até 10 MB).'
  };
  // FASE 5B: nunca reenviar upload_url / link externo no caminho Meta ativo.
  const stripped = (outputs || []).filter(
    (output) => !(output.kind === 'text' && /upload-receita|upload_url|https?:\/\//i.test(String(output.text || '')))
  );
  const mentionsExternalLink = (outputs || []).some((output) =>
    /link abaixo|upload-receita|http/i.test(String(output.text || ''))
  );
  if (uploadContext && (mentionsExternalLink || stripped.length === 0)) {
    return stripped.concat([whatsappHint]);
  }
  if (mentionsExternalLink) return stripped.concat([whatsappHint]);
  return stripped.length ? stripped : outputs;
}

async function findWhatsAppSessionForPrescriptionUpload({ atendimentoId, phone = null, whatsappSession = null } = {}) {
  if (whatsappSession?.typebot_session_id) return whatsappSession;

  const digits = phone ? normalizePhone(phone) : '';
  if (digits) {
    const byPhone = await getSessionByPhone(digits);
    if (byPhone?.typebot_session_id) return byPhone;
  }

  if (!atendimentoId) return null;

  const byAtendimento = await dbQuery('buscar whatsapp session por atendimento de upload', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .select('*')
      .filter('metadata->typebot_prescription_upload->>atendimento_id', 'eq', String(atendimentoId))
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  return byAtendimento || null;
}

async function sendTypebotOutputs({ session, outputs, correlationId, provider = metaProvider }) {
  const providerMessageIds = [];
  for (const output of outputs) {
    const common = {
      to: session.phone,
      bsuid: session.bsuid,
      correlationId,
      idempotencyKey: `${correlationId}:${providerMessageIds.length}`
    };
    let sent;
    if (output.kind === 'buttons') sent = await provider.sendButtonMessage({ ...common, body: output.body, buttons: output.choices });
    else if (output.kind === 'list') sent = await provider.sendListMessage({ ...common, body: output.body, button: output.button, rows: output.choices });
    else sent = await provider.sendTextMessage({ ...common, text: output.text });
    if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
  }
  return providerMessageIds;
}

async function resumeTypebotAfterPrescriptionUpload(
  { atendimentoId, token, correlationId = null, whatsappSession = null, phone = null },
  deps = {}
) {
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    return { ok: false, code: 'WHATSAPP_DISABLED' };
  }

  const provider = deps.provider || metaProvider;
  if (!provider.isConfigured || !provider.isConfigured()) {
    return { ok: false, code: 'WHATSAPP_NOT_CONFIGURED' };
  }

  let resolvedPhone = phone || whatsappSession?.phone || null;
  if (!resolvedPhone && atendimentoId) {
    const atendimento = await getAtendimento(atendimentoId);
    resolvedPhone = atendimento?.paciente_telefone || null;
  }

  const session = await findWhatsAppSessionForPrescriptionUpload({
    atendimentoId,
    phone: resolvedPhone,
    whatsappSession
  });

  if (!session?.typebot_session_id) {
    return { ok: false, code: 'NO_TYPEBOT_SESSION' };
  }

  const uploadMeta = session.metadata?.typebot_prescription_upload || {};
  if (uploadMeta.resumed_for_token === token && uploadMeta.resumed_at) {
    return { ok: true, alreadyResumed: true, responsesSent: 0 };
  }

  const bridge = require('./typebot-whatsapp.bridge');
  const callTypebot = deps.callTypebot || bridge.fetchTypebot;
  const convertResponse = deps.convertTypebotResponse || bridge.convertTypebotResponse;
  const upsertSession = deps.upsertSessionIdentity || upsertSessionIdentity;
  const logError = deps.createIntegrationError || createIntegrationError;
  const correlation = correlationId || `prescription-upload-${String(token || atendimentoId).slice(-12)}`;

  try {
    const typebot = await callTypebot(
      `/sessions/${encodeURIComponent(session.typebot_session_id)}/continueChat`,
      { message: { type: 'text', text: UPLOAD_SUCCESS_REPLY, metadata: { replyId: correlation } } }
    );

    const providerMessageIds = await sendTypebotOutputs({
      session,
      outputs: convertResponse(typebot),
      correlationId: correlation,
      provider
    });

    await upsertSession({
      phone: session.phone,
      bsuid: session.bsuid,
      metadataPatch: {
        typebot_expected_input_id: typebot.input?.id || null,
        typebot_prescription_upload: {
          ...uploadMeta,
          atendimento_id: uploadMeta.atendimento_id || atendimentoId || null,
          token: uploadMeta.token || token || null,
          resumed_at: new Date().toISOString(),
          resumed_for_token: token || uploadMeta.token || null
        }
      }
    }).catch(() => {});

    return { ok: true, responsesSent: providerMessageIds.length, typebotSessionId: session.typebot_session_id };
  } catch (error) {
    await logError({
      integration: 'typebot_prescription_upload',
      correlationId: correlation,
      error,
      request: {
        atendimento_id: atendimentoId || null,
        token_suffix: token ? String(token).slice(-8) : null,
        phase: 'continue_after_upload'
      }
    }).catch(() => {});
    return { ok: false, code: 'RESUME_FAILED', error: error.message };
  }
}

async function ingestWhatsAppPrescriptionMedia({
  mediaId,
  mimeType,
  filename = 'receita-whatsapp.jpg',
  identity,
  whatsappSession,
  messageId,
  provider = metaProvider,
  deps = {}
}) {
  const processed = readProcessedIds(whatsappSession);
  const mediaKey = String(mediaId || '').trim();
  const messageKey = String(messageId || '').trim();

  // FASE 5B: mesma mediaId/messageId não processa de novo (além do claim Meta).
  if (
    (mediaKey && processed.mediaIds.includes(mediaKey)) ||
    (messageKey && processed.messageIds.includes(messageKey))
  ) {
    return {
      handled: true,
      duplicate: true,
      alreadyProcessed: true,
      whatsappResume: { ok: true, alreadyResumed: true, responsesSent: 0 }
    };
  }

  const findPending = deps.findPendingUploadContext || findPendingUploadContext;
  const uploadContext = uploadContextFromSession(
    whatsappSession,
    await findPending(identity?.phone, { whatsappSession })
  );
  if (!uploadContext?.token) {
    const err = new Error('Nenhuma sessão de upload de receita pendente para este contato');
    err.code = 'WHATSAPP_UPLOAD_NO_SESSION';
    throw err;
  }

  const getAtend = deps.getAtendimento || getAtendimento;
  const atendimento = await getAtend(uploadContext.atendimentoId);
  const completeUpload = deps.completeExternalPrescriptionUpload || completeExternalPrescriptionUpload;
  const resumeFlow = deps.resumeTypebotAfterPrescriptionUpload || resumeTypebotAfterPrescriptionUpload;
  const persist = deps.persistUploadContext || persistUploadContext;

  if (hasStoredPreviousPrescription(atendimento?.dados_clinicos || {})) {
    await persist({
      identity,
      uploadContext,
      processedMediaId: mediaKey || null,
      processedMessageId: messageKey || null
    });
    const resume = await resumeFlow(
      {
        atendimentoId: uploadContext.atendimentoId,
        token: uploadContext.token,
        correlationId: messageId,
        whatsappSession,
        phone: identity?.phone
      },
      { provider, ...deps }
    );
    return {
      handled: true,
      uploadContext,
      duplicate: true,
      whatsappResume: resume
    };
  }

  const downloadMedia = provider.downloadMedia || metaProvider.downloadMedia;
  const media = await downloadMedia(mediaId);
  await completeUpload({
    token: uploadContext.token,
    buffer: media.buffer,
    mimeType: mimeType || media.mimeType,
    filename,
    correlationId: messageId
  });

  await persist({
    identity,
    uploadContext,
    processedMediaId: mediaKey || null,
    processedMessageId: messageKey || null
  });

  const resume = await resumeFlow(
    {
      atendimentoId: uploadContext.atendimentoId,
      token: uploadContext.token,
      correlationId: messageId,
      whatsappSession,
      phone: identity?.phone
    },
    { provider, ...deps }
  );

  return {
    handled: true,
    uploadContext,
    whatsappResume: resume
  };
}

module.exports = {
  UPLOAD_CHOICE_INPUT_IDS,
  UPLOAD_SUCCESS_REPLY,
  augmentOutputsWithUploadLink,
  buildUploadStatusUrl,
  buildUploadStatusUrlByAtendimento,
  findPendingUploadContext,
  findUploadContextForPhone,
  findWhatsAppSessionForPrescriptionUpload,
  getPrescriptionUploadStatusByAtendimentoId,
  getUploadStatus,
  ingestWhatsAppPrescriptionMedia,
  isUploadChoiceInput,
  isUploadConfirmationText,
  listPendingUploadMatches,
  outputsContainUrl,
  persistUploadContext,
  resolveUploadStatus,
  responseLooksLikeUploadStage,
  resumeTypebotAfterPrescriptionUpload,
  sendTypebotOutputs,
  uploadContextFromSession
};
