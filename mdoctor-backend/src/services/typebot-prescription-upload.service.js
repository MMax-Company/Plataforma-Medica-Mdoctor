const { STATUS, listAtendimentos } = require('../store/atendimentos.store');
const { upsertSessionIdentity } = require('../store/whatsapp-sessions.store');
const { hasStoredPreviousPrescription } = require('./clinical-payload-normalizer.service');
const { completeExternalPrescriptionUpload } = require('./prescription-upload.service');
const { resolveTokenRecord } = require('./prescription-upload-token.service');
const metaProvider = require('./providers/meta.provider');

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

async function persistUploadContext({ identity, uploadContext }) {
  if (!uploadContext) return;
  await upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: {
      typebot_prescription_upload: {
        atendimento_id: uploadContext.atendimentoId,
        token: uploadContext.token,
        upload_url: uploadContext.uploadUrl,
        upload_status_url: uploadContext.uploadStatusUrl
      }
    }
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
  const { getAtendimento } = require('../store/atendimentos.store');
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

function augmentOutputsWithUploadLink(outputs = [], uploadContext = null, { force = false } = {}) {
  if (!uploadContext?.uploadUrl) return outputs;
  if (!force && outputsContainUrl(outputs, uploadContext.uploadUrl)) return outputs;

  const linkBlock = {
    kind: 'text',
    text: `📄 Envie a foto da receita anterior pelo link:\n${uploadContext.uploadUrl}\n\nFormatos: JPG, PNG ou PDF (até 10 MB).`
  };

  const hasRetryHint = outputs.some((output) => /link abaixo|enviar foto da receita|não localizamos/i.test(String(output.text || '')));
  if (hasRetryHint || force) {
    return [...outputs, linkBlock];
  }
  if (!outputs.length) return [linkBlock];
  return outputs;
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
  await completeExternalPrescriptionUpload({
    token: uploadContext.token,
    buffer: media.buffer,
    mimeType: mimeType || media.mimeType,
    filename,
    correlationId: messageId
  });

  await persistUploadContext({ identity, uploadContext });

  const sent = await provider.sendTextMessage({
    to: identity.phone,
    bsuid: identity.bsuid,
    correlationId: messageId,
    idempotencyKey: `${messageId}:upload-ack`,
    text: '✅ Receita recebida com sucesso! Aguarde enquanto confirmamos o envio...'
  });

  return {
    handled: true,
    uploadContext,
    providerMessageId: sent?.providerMessageId || null
  };
}

module.exports = {
  UPLOAD_CHOICE_INPUT_IDS,
  augmentOutputsWithUploadLink,
  buildUploadStatusUrl,
  findPendingUploadContext,
  getUploadStatus,
  ingestWhatsAppPrescriptionMedia,
  isUploadChoiceInput,
  isUploadConfirmationText,
  outputsContainUrl,
  persistUploadContext,
  responseLooksLikeUploadStage,
  uploadContextFromSession
};
