const T = require('../db/tables');
const { dbQuery } = require('../db/persistence');
const { STATUS, listAtendimentos, getAtendimento, updateAtendimentoStatus } = require('../store/atendimentos.store');
const { upsertSessionIdentity, getSessionByPhone } = require('../store/whatsapp-sessions.store');
const { createIntegrationError } = require('../store/integration-logs.store');
const { hasStoredPreviousPrescription } = require('./clinical-payload-normalizer.service');
const { completeExternalPrescriptionUpload } = require('./prescription-upload.service');
const { resolveTokenRecord, createPrescriptionUploadSession } = require('./prescription-upload-token.service');
const metaProvider = require('./providers/meta.provider');

const UPLOAD_SUCCESS_REPLY = 'Já enviei a receita';

// Mensagem oficial enviada diretamente pelo Backend, assim que a receita
// anterior é validada e vinculada ao atendimento correto. O Typebot é
// retomado automaticamente em seguida (resumeTypebotAfterPrescriptionUpload)
// e é ele quem informa a entrada na fila médica (grupo final do fluxo) —
// por isso aqui só a confirmação do recebimento, sem repetir essa etapa.
const PRESCRIPTION_RECEIVED_MESSAGE = '✅ Recebemos sua receita médica com sucesso.';

const UPLOAD_CHOICE_INPUT_IDS = new Set([
  'blk_upload_check',
  'blk_upload_pending_choice'
]);

const UPLOAD_CONFIRM_VALUES = new Set([
  'já enviei a receita',
  'ja enviei a receita',
  'check'
]);

// Canonicaliza para DDD + 8 dígitos, removendo o 9º dígito quando presente.
// Achado em homologação real (26/07, atendimento da Eunice): o WhatsApp real
// manda o número sem o 9 (formato antigo), mas o telefone estruturado
// coletado pelo Typebot pode vir com o 9 — a comparação por sufixo antiga
// não cobria esse caso (o 9 é inserido no meio do número local, não é uma
// diferença de prefixo/país), então findPendingUploadContext e a
// reconciliação de pagamento pós-rejeição nunca encontravam o atendimento.
function normalizePhone(value = '') {
  let digits = String(value).replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 11 && digits[2] === '9') digits = digits.slice(0, 2) + digits.slice(3);
  return digits;
}

function phonesMatch(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (!left || !right) return false;
  return left === right;
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

// Restaurada (era dangling reference desde a reconciliação da PR #36 —
// função removida daqui, mas whatsapp.routes.js e triagem-webhook.service.js
// continuaram chamando-a, causando "is not a function" em produção).
// URL para GET /api/atendimentos/:id/prescription-upload/status (ver
// atendimentos.routes.js), consumida por scripts/test-receita-whatsapp-pedidos.js.
function buildUploadStatusUrlByAtendimento(atendimentoId) {
  const base = getPublicBackendBaseUrl();
  if (!base || !atendimentoId) return null;
  return `${base}/api/atendimentos/${encodeURIComponent(atendimentoId)}/prescription-upload/status`;
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

// Alias de findPendingUploadContext: NÃO ampliar para atendimentos fora de
// STATUS.AWAITING_PRESCRIPTION_UPLOAD. O fallback antigo buscava em
// listAtendimentos() sem filtro de status, reaproveitando o contexto de
// upload de qualquer atendimento passado (entregue, rejeitado, encerrado)
// só porque o telefone coincidia — incidente 2026-07-21 (contexto do
// atendimento já entregue horas antes sequestrando a resposta de um
// atendimento novo).
async function findUploadContextForPhone(phone) {
  return findPendingUploadContext(phone);
}

// Reconciliação pós-pagamento (achado 24/07/2026, atendimento do Willian):
// o webhook de triagem roda no instante em que o Typebot chega na etapa de
// pagamento — se o Stripe confirma alguns segundos/minutos DEPOIS desse
// instante, o atendimento nasce REJEITADO só por "pagamento_pendente",
// mesmo com todos os dados clínicos corretos (achado documentado no
// commit b2afa33 como pendente de autorização). Chamada só quando
// findPendingUploadContext não encontra nenhum atendimento já aguardando
// (ou seja, nunca interfere no caminho feliz). Só reabre o atendimento
// quando o ÚNICO motivo da rejeição foi pagamento — nunca toca em
// atendimentos rejeitados por motivo clínico/dados incompletos. Reaproveita
// createPrescriptionUploadSession (mesma função do caminho normal) para
// criar o token de upload e virar o status — sem duplicar lógica.
async function reconcileRejectedPaymentPendingAppointment(phone, { correlationId = null } = {}) {
  const rows = await listAtendimentos({ status: STATUS.REJECTED });
  const match = rows.find(
    (row) => phonesMatch(row.paciente_telefone, phone) && row.elegibilidade?.reasonCode === 'pagamento_pendente'
  );
  if (!match) return null;

  const clinical = match.dados_clinicos || {};
  await updateAtendimentoStatus(match.id, STATUS.REJECTED, {
    motivo: 'Pagamento confirmado após criação do atendimento — elegibilidade revalidada automaticamente',
    pagamento_status: 'CONFIRMADO',
    elegibilidade: {
      ...match.elegibilidade,
      eligible: true,
      reason: 'Pagamento confirmado (reconciliado após criação do atendimento)',
      reasonCode: 'eligible',
      riskLevel: 'BAIXO',
      renewalStatus: 'coerente'
    },
    risco: 'BAIXO',
    dados_clinicos: {
      ...clinical,
      payment_status: 'paid',
      payment_confirmed: true,
      pagamento_status: 'CONFIRMADO',
      payment_sync_source: 'whatsapp_session_reconciliation',
      validation: {
        ...(clinical.validation || {}),
        payment_confirmed: true,
        can_enter_medical_queue: true,
        awaiting_prescription_upload: true
      }
    }
  });

  const session = await createPrescriptionUploadSession({ atendimentoId: match.id, correlationId });
  return {
    atendimentoId: match.id,
    token: session.token,
    uploadUrl: session.uploadUrl,
    uploadStatusUrl: buildUploadStatusUrl(session.token),
    status: STATUS.AWAITING_PRESCRIPTION_UPLOAD
  };
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
  return outputs.some(
    (output) =>
      (output.kind === 'text' && String(output.text || '').includes(target)) ||
      (output.kind === 'document' && String(output.url || '').includes(target))
  );
}

// Detecção exclusivamente estrutural (IDs oficiais dos blocos de upload) —
// NÃO usar regex sobre o texto das mensagens: a palavra "receita" aparece
// também em textos comuns (ex.: a saudação inicial menciona "renovação de
// receita"), o que gerava falso positivo e removia botões/listas de outras
// etapas do fluxo (incidente 2026-07-21).
function responseLooksLikeUploadStage(typebot = {}, expectedInputId = null) {
  return isUploadChoiceInput(expectedInputId) || isUploadChoiceInput(typebot.input?.id);
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
    (output) =>
      !(output.kind === 'text' && /upload-receita|upload_url|https?:\/\//i.test(String(output.text || ''))) &&
      !(output.kind === 'document' && /upload-receita|upload_url/i.test(String(output.url || '')))
  );
  const mentionsExternalLink = (outputs || []).some(
    (output) =>
      /link abaixo|upload-receita|http/i.test(String(output.text || '')) ||
      (output.kind === 'document' && /upload-receita|upload_url/i.test(String(output.url || '')))
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

// Confirmação oficial do Backend, enviada uma única vez (idempotencyKey
// estável por atendimento) assim que a receita é validada e vinculada. O
// Typebot retomado logo em seguida já informa a entrada na fila médica —
// evita repetir a mesma informação em duas mensagens seguidas.
async function sendPostUploadConfirmation({ session, atendimentoId, correlationId, provider }) {
  const common = { to: session.phone, bsuid: session.bsuid, correlationId };
  await provider.sendTextMessage({ ...common, idempotencyKey: `prescription-received:${atendimentoId}`, text: PRESCRIPTION_RECEIVED_MESSAGE });
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
  const resumeTypebot = deps.resumeTypebotAfterPrescriptionUpload || resumeTypebotAfterPrescriptionUpload;

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
    correlationId: messageId,
    mediaId: mediaKey || null,
    messageId: messageKey || null
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

  // Retoma o Typebot automaticamente — sem depender do paciente clicar em
  // "Conferir novamente"/"Já enviei a receita". Reaproveita o mesmo mecanismo
  // (com claim atômico próprio) já usado pela página externa de upload.
  try {
    await resumeTypebot({ token: uploadContext.token, atendimentoId, correlationId: messageId }, deps);
  } catch (error) {
    await createIntegrationError({
      integration: 'typebot_prescription_upload',
      correlationId: messageId,
      error,
      request: { atendimento_id: atendimentoId, phase: 'auto_resume_after_whatsapp_media' }
    }).catch(() => {});
  }

  return {
    handled: true,
    uploadContext,
    atendimentoId,
    providerMessageId: null
  };
}

module.exports = {
  PRESCRIPTION_RECEIVED_MESSAGE,
  UPLOAD_CHOICE_INPUT_IDS,
  UPLOAD_SUCCESS_REPLY,
  augmentOutputsWithUploadLink,
  buildUploadStatusUrl,
  buildUploadStatusUrlByAtendimento,
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
  reconcileRejectedPaymentPendingAppointment,
  responseLooksLikeUploadStage,
  resumeTypebotAfterPrescriptionUpload,
  revertPrescriptionUploadResume,
  sendPostUploadConfirmation,
  stripUploadChoiceOutputs,
  uploadContextFromSession
};
