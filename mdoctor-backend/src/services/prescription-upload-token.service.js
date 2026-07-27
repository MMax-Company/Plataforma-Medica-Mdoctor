const crypto = require('crypto');
const { getAtendimento, listAtendimentos, updateAtendimentoStatus, STATUS } = require('../store/atendimentos.store');
const { createAuditLog } = require('../store/audit.store');

const TOKEN_TTL_MS = Number(process.env.PRESCRIPTION_UPLOAD_TOKEN_TTL_MS || 24 * 60 * 60 * 1000);
const tokenIndex = new Map();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function getPublicUploadBaseUrl() {
  const panel = String(process.env.UPLOAD_PAGE_BASE_URL || process.env.PANEL_PUBLIC_URL || '').trim();
  if (panel) return panel.replace(/\/$/, '');
  const base = String(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').trim();
  if (base) return base.replace(/\/$/, '');
  const port = process.env.PORT || 3004;
  return `http://localhost:${port}`;
}

function buildUploadPageUrl(token) {
  return `${getPublicUploadBaseUrl()}/upload-receita/${encodeURIComponent(token)}`;
}

function rememberToken(record) {
  tokenIndex.set(record.token, record);
}

function getTokenRecord(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;
  const cached = tokenIndex.get(normalized);
  if (cached) return cached;
  return null;
}

async function findTokenRecordFromStorage(token) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;

  const rows = await listAtendimentos();
  const match = rows.find((row) => {
    const session = row?.dados_clinicos?.prescription_upload_session || {};
    return session.token === normalized;
  });
  if (!match) return null;

  const session = match.dados_clinicos.prescription_upload_session;
  const record = {
    token: normalized,
    tokenHash: session.token_hash || sha256(normalized),
    atendimentoId: match.id,
    patientId: session.patient_id || null,
    expiresAt: new Date(session.expires_at).getTime(),
    used: session.status === 'completed',
    status: session.status || 'pending',
    createdAt: session.created_at || match.criado_em
  };
  rememberToken(record);
  return record;
}

async function resolveTokenRecord(token) {
  const cached = getTokenRecord(token);
  if (cached) return cached;
  return findTokenRecordFromStorage(token);
}

function assertTokenActive(record) {
  if (!record) {
    const err = new Error('Link de upload inválido ou expirado');
    err.code = 'UPLOAD_TOKEN_INVALID';
    err.statusCode = 404;
    throw err;
  }
  if (record.used || record.status === 'completed') {
    const err = new Error('Este link de upload já foi utilizado');
    err.code = 'UPLOAD_TOKEN_USED';
    err.statusCode = 409;
    throw err;
  }
  if (record.expiresAt <= Date.now()) {
    const err = new Error('Link de upload expirado. Solicite um novo link no atendimento');
    err.code = 'UPLOAD_TOKEN_EXPIRED';
    err.statusCode = 410;
    throw err;
  }
}

async function createPrescriptionUploadSession({ atendimentoId, patientId = null, correlationId = null } = {}) {
  if (!atendimentoId) {
    const err = new Error('atendimento_id obrigatório para sessão de upload');
    err.code = 'UPLOAD_SESSION_INVALID';
    throw err;
  }

  const token = generateToken();
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const uploadUrl = buildUploadPageUrl(token);
  const record = {
    token,
    tokenHash: sha256(token),
    atendimentoId,
    patientId,
    expiresAt,
    used: false,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  rememberToken(record);

  const atendimento = await getAtendimento(atendimentoId);
  const clinical = atendimento?.dados_clinicos || {};
  await updateAtendimentoStatus(atendimentoId, STATUS.AWAITING_PRESCRIPTION_UPLOAD, {
    dados_clinicos: {
      ...clinical,
      prescription_upload_session: {
        token,
        token_hash: record.tokenHash,
        patient_id: patientId,
        expires_at: new Date(expiresAt).toISOString(),
        status: 'pending',
        upload_url: uploadUrl,
        created_at: record.createdAt,
        correlation_id: correlationId
      },
      prescription_upload_pending: true,
      previous_prescription_pending: true
    }
  });

  await createAuditLog({
    entity_type: 'prescription_upload',
    entity_id: atendimentoId,
    action: 'upload_session_created',
    actor: 'backend',
    payload: { correlationId, expires_at: new Date(expiresAt).toISOString(), upload_url: uploadUrl }
  });

  return { token, uploadUrl, expiresAt: new Date(expiresAt).toISOString(), atendimentoId };
}

async function markUploadSessionCompleted({ token, atendimentoId, correlationId = null, clinicalPatch = {} }) {
  const record = (await resolveTokenRecord(token)) || { token, atendimentoId };
  record.used = true;
  record.status = 'completed';
  rememberToken(record);

  const atendimento = await getAtendimento(atendimentoId);
  const clinical = atendimento?.dados_clinicos || {};
  await updateAtendimentoStatus(atendimentoId, STATUS.WAITING, {
    dados_clinicos: {
      ...clinical,
      ...clinicalPatch,
      prescription_upload_pending: false,
      previous_prescription_pending: false,
      prescription_upload_session: {
        ...(clinical.prescription_upload_session || {}),
        status: 'completed',
        completed_at: new Date().toISOString()
      }
    },
    elegibilidade: {
      ...(atendimento?.elegibilidade || {}),
      eligible: true,
      reason: 'Receita anterior recebida — aguardando análise médica'
    },
    risco: 'BAIXO'
  });

  await createAuditLog({
    entity_type: 'prescription_upload',
    entity_id: atendimentoId,
    action: 'upload_session_completed',
    actor: 'patient',
    payload: { correlationId, token_hash: record.tokenHash }
  });
}

function isExternalUploadEnabled() {
  return process.env.PRESCRIPTION_EXTERNAL_UPLOAD !== 'false';
}

module.exports = {
  TOKEN_TTL_MS,
  assertTokenActive,
  buildUploadPageUrl,
  createPrescriptionUploadSession,
  findTokenRecordFromStorage,
  generateToken,
  getPublicUploadBaseUrl,
  isExternalUploadEnabled,
  markUploadSessionCompleted,
  resolveTokenRecord,
  rememberToken
};
