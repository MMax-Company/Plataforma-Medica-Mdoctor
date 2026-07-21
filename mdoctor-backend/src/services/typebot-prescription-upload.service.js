const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');
const { STATUS, listAtendimentos, getAtendimento } = require('../store/atendimentos.store');
const { upsertSessionIdentity, getSessionByPhone } = require('../store/whatsapp-sessions.store');
const { createIntegrationError } = require('../store/integration-logs.store');
const { hasStoredPreviousPrescription } = require('./clinical-payload-normalizer.service');
const { completeExternalPrescriptionUpload } = require('./prescription-upload.service');
const { resolveTokenRecord } = require('./prescription-upload-token.service');
const metaProvider = require('./providers/meta.provider');

const UPLOAD_SUCCESS_REPLY = 'Já enviei a receita';

// Fase 2 pedido 3 — mensagens oficiais enviadas diretamente pelo Backend
// (não dependem do texto de retorno do Typebot, que não pode ser alterado
// neste pedido) após receita válida armazenada e vinculada.
const PRESCRIPTION_RECEIVED_MESSAGE = 'Receita anterior recebida com sucesso.\n\nEstamos concluindo sua solicitação.';
const ATENDIMENTO_CREATED_MESSAGE = 'Recebemos suas informações e criamos seu atendimento.';
const QUEUE_ENTRY_MESSAGE = 'Sua solicitação foi enviada para avaliação médica.\n\nVocê receberá uma mensagem por este WhatsApp quando houver uma decisão.';

const UPLOAD_CHOICE_INPUT_IDS = new Set([
  'blk_upload_check',
  'blk_upload_pending_choice'
]);

const UPLOAD_CONFIRM_VALUES = new Set([
  'já enviei a receita',
  'ja enviei a receita',
  'check'
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

function extractUploadSession(atendimento = {}) {
  const clinical = atendimento.dados_clinicos || atendimento.clinical_data || {};
  const session = clinical.prescription_upload_session || {};
  const token = session.token || null;
  const uploadUrl = session.upload_url || null;
  if (!token || !uploadUrl) return null;
  return {
    atendimentoId: atendimento.id,
    token,
    uploadUrl,
    uploadStatusUrl: buildUploadStatusUrl(token),
    status: atendimento.status
  };
}

async function findPendingUploadContext(phone) {
  const rows = await listAtendimentos({ status: STATUS.AWAITING_PRESCRIPTION_UPLOAD });
  const matches = rows.filter(
    (row) => phonesMatch(row.paciente_telefone, phone) && !hasStoredPreviousPrescription(row.dados_clinicos || {})
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    // Nunca adivinhar a qual atendimento a mídia pertence: mais de um
    // atendimento aguardando receita para o mesmo telefone é tratado como
    // erro explícito, para nunca vincular a mídia ao paciente errado.
    const err = new Error('Mais de um atendimento aguardando receita anterior para este telefone.');
    err.code = 'WHATSAPP_UPLOAD_AMBIGUOUS_ATENDIMENTO';
    err.statusCode = 409;
    err.atendimentoIds = matches.map((row) => row.id);
    throw err;
  }
  return extractUploadSession(matches[0]);
}

async function findUploadContextForPhone(phone) {
  const pending = await findPendingUploadContext(phone);
  if (pending) return pending;
  const rows = await listAtendimentos();
  const match = rows.find((row) => phonesMatch(row.paciente_telefone, phone) && extractUploadSession(row));
  return match ? extractUploadSession(match) : null;
}

// Rastreia media_id/message_id já processados na própria sessão (Fase 2
// pedido 3): impede que a mesma mídia reenviada pela Meta (webhook
// duplicado, reentrega) seja baixada/armazenada uma segunda vez.
function readProcessedIds(whatsappSession = {}) {
  const meta = whatsappSession?.metadata?.typebot_prescription_upload || {};
  return {
    mediaIds: Array.isArray(meta.processed_media_ids) ? meta.processed_media_ids.map(String) : [],
    messageIds: Array.isArray(meta.processed_message_ids) ? meta.processed_message_ids.map(String) : []
  };
}

async function persistUploadContext({
  identity,
  uploadContext,
  whatsappSession = null,
  linkSentAt = null,
  processedMediaId = null,
  processedMessageId = null
}) {
  if (!uploadContext && !processedMediaId && !processedMessageId) return;
  const existing = whatsappSession?.metadata?.typebot_prescription_upload || {};
  const { mediaIds, messageIds } = readProcessedIds(whatsappSession);
  if (processedMediaId && !mediaIds.includes(String(processedMediaId))) mediaIds.push(String(processedMediaId));
  if (processedMessageId && !messageIds.includes(String(processedMessageId))) messageIds.push(String(processedMessageId));

  const patch = {
    ...existing,
    ...(uploadContext
      ? {
          atendimento_id: uploadContext.atendimentoId,
          token: uploadContext.token,
          upload_url: uploadContext.uploadUrl,
          upload_status_url: uploadContext.uploadStatusUrl
        }
      : {}),
    processed_media_ids: mediaIds.slice(-20),
    processed_message_ids: messageIds.slice(-20)
  };
  if (linkSentAt) patch.link_sent_at = linkSentAt;
  await upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: { typebot_prescription_upload: patch }
  });
}

function uploadContextFromSession(whatsappSession = {}, fallback = null) {
  const stored = whatsappSession?.metadata?.typebot_prescription_upload;
  if (stored?.upload_url && stored?.token) {
    return {
      atendimentoId: stored.atendimento_id || null,
      token: stored.token,
      uploadUrl: stored.upload_url,
      uploadStatusUrl: stored.upload_status_url || buildUploadStatusUrl(stored.token)
    };
  }
  return fallback;
}

async function getUploadStatus(token) {
  const record = await resolveTokenRecord(token);
  if (!record) return { found: false, upload_completed: false };
  const atendimento = await getAtendimento(record.atendimentoId);
  if (!atendimento) return { found: false, upload_completed: false };
  const clinical = atendimento.dados_clinicos || {};
  const uploaded = hasStoredPreviousPrescription(clinical);
  return {
    found: true,
    upload_completed: uploaded,
    atendimento_id: atendimento.id,
    atendimento_status: atendimento.status,
    upload_url: clinical.prescription_upload_session?.upload_url || null
  };
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

function responseLooksLikeUploadStage(typebot = {}, expectedInputId = null) {
  if (isUploadChoiceInput(expectedInputId) || isUploadChoiceInput(typebot.input?.id)) return true;
  const blob = JSON.stringify(typebot.messages || []);
  return /receita|upload|enviar foto/i.test(blob);
}

function stripUploadChoiceOutputs(outputs = []) {
  return outputs.filter((output) => output.kind !== 'buttons' && output.kind !== 'list');
}

// Fase 2 pedido 3 — caminho oficial do WhatsApp nunca envia upload_url nem
// qualquer link externo de upload: a mídia é recebida direto nesta
// conversa. Qualquer saída do Typebot que mencione link/URL de upload é
// substituída por uma instrução simples (sem link) para enviar a foto/PDF
// aqui mesmo. Função legada mantida (mesmo nome/assinatura, ainda usada
// pelo bridge) — só o conteúdo enviado ao paciente muda.
function augmentOutputsWithUploadLink(outputs = [], uploadContext = null) {
  const whatsappHint = {
    kind: 'text',
    text: 'Envie agora uma foto legível ou um arquivo em PDF da sua receita anterior nesta conversa do WhatsApp.\n\nFormatos aceitos: JPG, JPEG, PNG ou PDF (até 10 MB).'
  };
  const stripped = (outputs || []).filter(
    (output) => !(output.kind === 'text' && /upload-receita|upload_url|https?:\/\//i.test(String(output.text || '')))
  );
  const mentionsExternalLink = (outputs || []).some((output) =>
    /link abaixo|upload-receita|http/i.test(String(output.text || ''))
  );
  if (uploadContext && (mentionsExternalLink || stripped.length === 0)) {
    return stripped.concat([whatsappHint]);
  }
  return stripped.length ? stripped : outputs;
}

async function claimPrescriptionUploadResume(session, { token, atendimentoId }) {
  const resume = session?.metadata?.prescription_upload_resume;
  if (resume?.token === token && resume?.completed_at) return false;

  const now = new Date().toISOString();
  const metadata = {
    ...(session.metadata || {}),
    prescription_upload_resume: {
      token,
      atendimento_id: atendimentoId,
      started_at: now
    }
  };
  const rows = await dbQuery('claim prescription upload resume', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .update({ metadata, updated_at: now })
      .eq('id', session.id)
      .filter('metadata->prescription_upload_resume->>completed_at', 'is', null)
      .select('id')
  );
  return Array.isArray(rows) && rows.length === 1;
}

async function revertPrescriptionUploadResume(session) {
  const metadata = { ...(session.metadata || {}) };
  delete metadata.prescription_upload_resume;
  await dbQuery('revert prescription upload resume', async (supabase) =>
    supabase
      .from(T.WHATSAPP_SESSIONS)
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('id', session.id)
  ).catch(() => {});
}

async function sendTypebotOutputs({ session, outputs, correlationId, provider }) {
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

async function resumeTypebotAfterPrescriptionUpload({ token, atendimentoId, correlationId }, deps = {}) {
  // Lazy require para evitar ciclo bridge <-> service.
  // eslint-disable-next-line global-require
  const bridge = require('./typebot-whatsapp.bridge');
  const callTypebot = deps.callTypebot || bridge.fetchTypebot;
  const convertResponse = deps.convertTypebotResponse || bridge.convertTypebotResponse;
  const provider = deps.provider || metaProvider;
  const getAtendimentoFn = deps.getAtendimento || getAtendimento;
  const getSession = deps.getSessionByPhone || getSessionByPhone;
  const persistSession = deps.upsertSessionIdentity || upsertSessionIdentity;
  const logError = deps.createIntegrationError || createIntegrationError;
  const claimResume = deps.claimPrescriptionUploadResume || claimPrescriptionUploadResume;
  const revertResume = deps.revertPrescriptionUploadResume || revertPrescriptionUploadResume;

  const atendimento = await getAtendimentoFn(atendimentoId);
  if (!atendimento?.paciente_telefone) return { ok: false, code: 'NO_PHONE' };

  const session = deps.session || await getSession(atendimento.paciente_telefone);
  if (!session?.typebot_session_id) return { ok: false, code: 'NO_TYPEBOT_SESSION' };

  const resume = session.metadata?.prescription_upload_resume;
  if (resume?.token === token && resume?.completed_at) {
    return { ok: true, alreadyCompleted: true };
  }

  const claimed = await claimResume(session, { token, atendimentoId });
  if (!claimed) return { ok: true, alreadyCompleted: true };

  const resumeCorrelationId = correlationId || `prescription-upload-${token.slice(-8)}`;
  try {
    const typebot = await callTypebot(
      `/sessions/${encodeURIComponent(session.typebot_session_id)}/continueChat`,
      { message: { type: 'text', text: UPLOAD_SUCCESS_REPLY, metadata: { replyId: resumeCorrelationId } } }
    );

    const uploadContext = uploadContextFromSession(session);
    let outputs = stripUploadChoiceOutputs(convertResponse(typebot));
    outputs = augmentOutputsWithUploadLink(outputs, uploadContext, { linkAlreadySent: true });

    const providerMessageIds = await sendTypebotOutputs({
      session,
      outputs,
      correlationId: resumeCorrelationId,
      provider
    });

    await persistSession({
      phone: session.phone,
      bsuid: session.bsuid,
      metadataPatch: {
        typebot_expected_input_id: typebot.input?.id || null,
        prescription_upload_resume: {
          token,
          atendimento_id: atendimentoId,
          completed_at: new Date().toISOString()
        }
      }
    }).catch(() => {});

    return { ok: true, responsesSent: providerMessageIds.length, nextInputId: typebot.input?.id || null };
  } catch (error) {
    await revertResume(session);
    await logError({
      integration: 'typebot_prescription_upload',
      correlationId: resumeCorrelationId,
      error,
      request: { token_suffix: String(token).slice(-8), atendimento_id: atendimentoId, phase: 'continue_after_upload' }
    }).catch(() => {});
    throw error;
  }
}

// Envia as 3 mensagens oficiais do Backend (Fase 2 pedido 3) uma única vez,
// com idempotencyKey estável por atendimento — não depende do texto que o
// Typebot devolveria (não pode ser alterado neste pedido).
async function sendPostUploadConfirmation({ session, atendimentoId, correlationId, provider }) {
  const common = { to: session.phone, bsuid: session.bsuid, correlationId };
  await provider.sendTextMessage({ ...common, idempotencyKey: `prescription-received:${atendimentoId}`, text: PRESCRIPTION_RECEIVED_MESSAGE });
  await provider.sendTextMessage({ ...common, idempotencyKey: `atendimento-created:${atendimentoId}`, text: ATENDIMENTO_CREATED_MESSAGE });
  await provider.sendTextMessage({ ...common, idempotencyKey: `queue-entry:${atendimentoId}`, text: QUEUE_ENTRY_MESSAGE });
}

// Fase 2 pedido 2 já é a única fonte de verdade sobre pagamento confirmado
// (whatsapp_sessions.metadata.typebot_payment). Aqui só LEMOS esse estado —
// não criamos nova forma de verificar "paid" nem tocamos no pagamento.
function isPaymentConfirmedByPedido2(whatsappSession = {}) {
  return whatsappSession?.metadata?.typebot_payment?.payment_status === 'paid';
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
  const findPending = deps.findPendingUploadContext || findPendingUploadContext;
  const getAtend = deps.getAtendimento || getAtendimento;
  const completeUpload = deps.completeExternalPrescriptionUpload || completeExternalPrescriptionUpload;
  const persist = deps.persistUploadContext || persistUploadContext;
  const sendConfirmation = deps.sendPostUploadConfirmation || sendPostUploadConfirmation;
  const hasStored = deps.hasStoredPreviousPrescription || hasStoredPreviousPrescription;
  const isPaymentConfirmed = deps.isPaymentConfirmedByPedido2 || isPaymentConfirmedByPedido2;

  const mediaKey = String(mediaId || '').trim();
  const messageKey = String(messageId || '').trim();
  const processed = readProcessedIds(whatsappSession);

  // Mídia (ou o envelope da mensagem) já processada nesta sessão: não baixa
  // de novo, não reenvia confirmação — no-op idempotente.
  if ((mediaKey && processed.mediaIds.includes(mediaKey)) || (messageKey && processed.messageIds.includes(messageKey))) {
    return { handled: true, duplicate: true };
  }

  const uploadContext = uploadContextFromSession(whatsappSession, await findPending(identity?.phone));
  if (!uploadContext?.token) {
    const err = new Error('Nenhuma sessão de upload de receita pendente para este contato');
    err.code = 'WHATSAPP_UPLOAD_NO_SESSION';
    throw err;
  }

  if (!isPaymentConfirmed(whatsappSession)) {
    const err = new Error('Pagamento não confirmado para esta sessão — receita não pode ser vinculada a um atendimento definitivo ainda');
    err.code = 'PRESCRIPTION_PAYMENT_NOT_CONFIRMED';
    err.statusCode = 409;
    throw err;
  }

  const existingAtendimento = await getAtend(uploadContext.atendimentoId);
  if (hasStored(existingAtendimento?.dados_clinicos || {})) {
    // Conteúdo já vinculado (ex.: outra entrega da mesma mídia com
    // message_id diferente): registra o id novo para futuras deduplicações
    // e não reprocessa nem reenvia as mensagens de confirmação.
    await persist({ identity, uploadContext, whatsappSession, processedMediaId: mediaKey || null, processedMessageId: messageKey || null });
    return { handled: true, duplicate: true, uploadContext };
  }

  const downloadMedia = provider.downloadMedia || metaProvider.downloadMedia;
  const media = await downloadMedia(mediaId);
  const uploadResult = await completeUpload({
    token: uploadContext.token,
    buffer: media.buffer,
    mimeType: mimeType || media.mimeType,
    filename,
    correlationId: messageId
  });

  await persist({
    identity,
    uploadContext,
    whatsappSession,
    processedMediaId: mediaKey || null,
    processedMessageId: messageKey || null
  });

  const atendimentoId = uploadResult.atendimento?.id || uploadContext.atendimentoId;
  await sendConfirmation({ session: whatsappSession, atendimentoId, correlationId: messageId, provider });

  return {
    handled: true,
    uploadContext,
    atendimentoId,
    providerMessageId: null
  };
}

module.exports = {
  ATENDIMENTO_CREATED_MESSAGE,
  PRESCRIPTION_RECEIVED_MESSAGE,
  QUEUE_ENTRY_MESSAGE,
  UPLOAD_CHOICE_INPUT_IDS,
  UPLOAD_SUCCESS_REPLY,
  augmentOutputsWithUploadLink,
  buildUploadStatusUrl,
  claimPrescriptionUploadResume,
  findPendingUploadContext,
  findUploadContextForPhone,
  getUploadStatus,
  ingestWhatsAppPrescriptionMedia,
  isPaymentConfirmedByPedido2,
  isUploadChoiceInput,
  isUploadConfirmationText,
  outputsContainUrl,
  persistUploadContext,
  readProcessedIds,
  responseLooksLikeUploadStage,
  resumeTypebotAfterPrescriptionUpload,
  revertPrescriptionUploadResume,
  sendPostUploadConfirmation,
  stripUploadChoiceOutputs,
  uploadContextFromSession
};
