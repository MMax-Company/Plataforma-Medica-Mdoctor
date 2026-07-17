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
  const match = rows.find((row) => phonesMatch(row.paciente_telefone, phone));
  if (!match) return null;
  const ctx = extractUploadSession(match);
  if (!ctx) return null;
  if (hasStoredPreviousPrescription(match.dados_clinicos || {})) return null;
  return ctx;
}

async function findUploadContextForPhone(phone) {
  const pending = await findPendingUploadContext(phone);
  if (pending) return pending;
  const rows = await listAtendimentos();
  const match = rows.find((row) => phonesMatch(row.paciente_telefone, phone) && extractUploadSession(row));
  return match ? extractUploadSession(match) : null;
}

async function persistUploadContext({ identity, uploadContext, whatsappSession = null, linkSentAt = null }) {
  if (!uploadContext) return;
  const existing = whatsappSession?.metadata?.typebot_prescription_upload || {};
  const patch = {
    ...existing,
    atendimento_id: uploadContext.atendimentoId,
    token: uploadContext.token,
    upload_url: uploadContext.uploadUrl,
    upload_status_url: uploadContext.uploadStatusUrl
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

function augmentOutputsWithUploadLink(outputs = [], uploadContext = null, { force = false, linkAlreadySent = false } = {}) {
  if (!uploadContext?.uploadUrl) return outputs;

  const hasRetryHint = outputs.some((output) => /link abaixo|enviar foto da receita|não localizamos/i.test(String(output.text || '')));

  if (linkAlreadySent && !hasRetryHint && !force) return outputs;
  if (!force && !linkAlreadySent && outputsContainUrl(outputs, uploadContext.uploadUrl)) return outputs;

  const linkBlock = {
    kind: 'text',
    text: `📄 Envie a foto da receita anterior pelo link:\n${uploadContext.uploadUrl}\n\nFormatos: JPG, PNG ou PDF (até 10 MB).`
  };

  if (hasRetryHint || force) {
    return [...outputs, linkBlock];
  }
  if (!outputs.length) return [linkBlock];
  return outputs;
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

async function ingestWhatsAppPrescriptionMedia({
  mediaId,
  mimeType,
  filename = 'receita-whatsapp.jpg',
  identity,
  whatsappSession,
  messageId,
  provider = metaProvider
}) {
  const uploadContext = uploadContextFromSession(whatsappSession, await findPendingUploadContext(identity?.phone));
  if (!uploadContext?.token) {
    const err = new Error('Nenhuma sessão de upload de receita pendente para este contato');
    err.code = 'WHATSAPP_UPLOAD_NO_SESSION';
    throw err;
  }

  const downloadMedia = provider.downloadMedia || metaProvider.downloadMedia;
  const media = await downloadMedia(mediaId);
  const uploadResult = await completeExternalPrescriptionUpload({
    token: uploadContext.token,
    buffer: media.buffer,
    mimeType: mimeType || media.mimeType,
    filename,
    correlationId: messageId
  });

  await persistUploadContext({ identity, uploadContext, whatsappSession });

  let resumeResult = { ok: false, code: 'NOT_ATTEMPTED' };
  try {
    resumeResult = await resumeTypebotAfterPrescriptionUpload({
      token: uploadContext.token,
      atendimentoId: uploadResult.atendimento?.id || uploadContext.atendimentoId,
      correlationId: messageId,
      session: whatsappSession
    });
  } catch (error) {
    resumeResult = { ok: false, code: 'RESUME_FAILED', error: error.message };
  }

  return {
    handled: true,
    uploadContext,
    resumeResult,
    providerMessageId: null
  };
}

module.exports = {
  UPLOAD_CHOICE_INPUT_IDS,
  UPLOAD_SUCCESS_REPLY,
  augmentOutputsWithUploadLink,
  buildUploadStatusUrl,
  claimPrescriptionUploadResume,
  findPendingUploadContext,
  findUploadContextForPhone,
  getUploadStatus,
  ingestWhatsAppPrescriptionMedia,
  isUploadChoiceInput,
  isUploadConfirmationText,
  outputsContainUrl,
  persistUploadContext,
  responseLooksLikeUploadStage,
  resumeTypebotAfterPrescriptionUpload,
  revertPrescriptionUploadResume,
  stripUploadChoiceOutputs,
  uploadContextFromSession
};
