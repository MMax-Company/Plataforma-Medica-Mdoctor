const axios = require('axios');
const { randomUUID } = require('crypto');
const { getSupabase, isSupabaseConfigured } = require('../config/supabase');
const { createAuditLog } = require('../store/audit.store');

const BUCKET =
  process.env.SUPABASE_BUCKET_RECEITAS_ANTERIORES ||
  process.env.SUPABASE_RECEITAS_ANTERIORES_BUCKET ||
  'receitas-anteriores';

const MAX_BYTES = Number(process.env.PREVIOUS_PRESCRIPTION_MAX_BYTES || 10 * 1024 * 1024);
const SIGNED_URL_TTL_SECONDS = Number(process.env.PREVIOUS_PRESCRIPTION_SIGNED_TTL_SECONDS || 3600);

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);
const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf'
};

function getBucketName() {
  return BUCKET;
}

function isHttpUrl(value) {
  const raw = String(value || '').trim();
  return /^https?:\/\//i.test(raw);
}

function isAlreadyStoredInBucket({ fileUrl, storagePath } = {}) {
  if (storagePath && String(storagePath).includes('atendimentos/')) return true;
  const url = String(fileUrl || '');
  if (!url) return false;
  return url.includes(`/storage/v1/object/`) && url.includes(BUCKET);
}

function extensionFromMime(mime) {
  return EXT_BY_MIME[String(mime || '').toLowerCase()] || null;
}

function mimeFromExtension(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    pdf: 'application/pdf'
  };
  return map[String(ext || '').toLowerCase()] || null;
}

function guessMimeFromUrl(url) {
  const match = String(url || '').match(/\.([a-z0-9]+)(?:\?|$)/i);
  if (!match) return null;
  return mimeFromExtension(match[1]);
}

function buildStoragePath(atendimentoId, mimeType) {
  const ext = extensionFromMime(mimeType) || 'bin';
  const timestamp = Date.now();
  return `atendimentos/${atendimentoId}/receita-anterior-${timestamp}.${ext}`;
}

function validateBuffer(buffer, mimeType) {
  if (!buffer || !buffer.length) {
    const err = new Error('Arquivo da receita anterior vazio ou ausente');
    err.code = 'PRESCRIPTION_FILE_EMPTY';
    throw err;
  }
  if (buffer.length > MAX_BYTES) {
    const err = new Error(`Arquivo excede o limite de ${Math.round(MAX_BYTES / (1024 * 1024))}MB`);
    err.code = 'PRESCRIPTION_FILE_TOO_LARGE';
    throw err;
  }
  const mime = String(mimeType || '').toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    const err = new Error(`Tipo de arquivo não permitido: ${mime || 'desconhecido'}. Use jpg, png ou pdf.`);
    err.code = 'PRESCRIPTION_MIME_INVALID';
    throw err;
  }
}

async function downloadFile(fileUrl) {
  if (!isHttpUrl(fileUrl)) {
    const err = new Error('URL da receita anterior inválida para download');
    err.code = 'PRESCRIPTION_URL_INVALID';
    throw err;
  }

  try {
    const response = await axios.get(fileUrl, {
      responseType: 'arraybuffer',
      timeout: 45000,
      maxContentLength: MAX_BYTES + 1024,
      maxBodyLength: MAX_BYTES + 1024,
      validateStatus: (status) => status >= 200 && status < 400
    });
    const mimeType =
      String(response.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase() || guessMimeFromUrl(fileUrl);
    return {
      buffer: Buffer.from(response.data),
      mimeType: mimeType || guessMimeFromUrl(fileUrl)
    };
  } catch (error) {
    const err = new Error(`Falha ao baixar a foto da receita: ${error.message}`);
    err.code = 'PRESCRIPTION_DOWNLOAD_FAILED';
    err.cause = error;
    throw err;
  }
}

async function uploadToStorage({ buffer, mimeType, storagePath }) {
  if (!isSupabaseConfigured()) {
    const err = new Error('Supabase não configurado para upload da receita anterior');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false
  });

  if (error) {
    const err = new Error(`Falha no upload da receita anterior: ${error.message}`);
    err.code = 'PRESCRIPTION_UPLOAD_FAILED';
    throw err;
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (signError) {
    const err = new Error(`Upload OK, mas falha ao gerar URL assinada: ${signError.message}`);
    err.code = 'PRESCRIPTION_SIGNED_URL_FAILED';
    throw err;
  }

  return {
    previous_prescription_url: signed.signedUrl,
    previous_prescription_storage_path: storagePath,
    previous_prescription_mime_type: mimeType,
    previous_prescription_size: buffer.length,
    previous_prescription_uploaded_at: new Date().toISOString()
  };
}

function buildMetadataFromExisting(input = {}) {
  const url = pickFirst(
    input.previous_prescription_url,
    input.previous_prescription_file,
    input.foto_receita_url
  );
  const storagePath = input.previous_prescription_storage_path || null;
  if (!url && !storagePath) return null;

  return {
    previous_prescription_url: url,
    previous_prescription_storage_path: storagePath,
    previous_prescription_mime_type: input.previous_prescription_mime_type || null,
    previous_prescription_size: input.previous_prescription_size || null,
    previous_prescription_uploaded_at: input.previous_prescription_uploaded_at || null,
    previous_prescription_file: url,
    foto_receita_url: url,
    previous_prescription_source: input.previous_prescription_source || input.source || 'typebot/n8n'
  };
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return null;
}

async function uploadBufferFromExternal({ buffer, mimeType, atendimentoId, source = 'external_upload' }) {
  validateBuffer(buffer, mimeType);
  const storagePath = buildStoragePath(atendimentoId, mimeType);
  const uploaded = await uploadToStorage({ buffer, mimeType, storagePath });
  return {
    ...uploaded,
    previous_prescription_file: uploaded.previous_prescription_url,
    foto_receita_url: uploaded.previous_prescription_url,
    previous_prescription_source: source
  };
}

async function ingestPreviousPrescription({
  fileUrl,
  storagePath: existingPath = null,
  atendimentoId,
  patientId = null,
  correlationId = null,
  source = 'typebot/n8n',
  skipDownload = false
} = {}) {
  const atendimento_id = atendimentoId || randomUUID();

  if (isAlreadyStoredInBucket({ fileUrl, storagePath: existingPath })) {
    const meta = buildMetadataFromExisting({
      previous_prescription_url: fileUrl,
      previous_prescription_storage_path: existingPath,
      source
    });
    if (meta) {
      return {
        ok: true,
        skipped: true,
        atendimento_id,
        patient_id: patientId || null,
        ...meta
      };
    }
  }

  if (!fileUrl && !existingPath) {
    const err = new Error('Receita anterior ausente (previous_prescription_file)');
    err.code = 'PRESCRIPTION_FILE_MISSING';
    throw err;
  }

  if (skipDownload && existingPath) {
    const supabase = getSupabase();
    const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrl(existingPath, SIGNED_URL_TTL_SECONDS);
    if (error) throw error;
    return {
      ok: true,
      skipped: true,
      atendimento_id,
      patient_id: patientId || null,
      previous_prescription_url: signed.signedUrl,
      previous_prescription_storage_path: existingPath,
      previous_prescription_file: signed.signedUrl,
      foto_receita_url: signed.signedUrl,
      previous_prescription_source: source
    };
  }

  const { buffer, mimeType } = await downloadFile(fileUrl);
  validateBuffer(buffer, mimeType);

  const storagePath = existingPath || buildStoragePath(atendimento_id, mimeType);
  const uploaded = await uploadToStorage({ buffer, mimeType, storagePath });

  const result = {
    ok: true,
    skipped: false,
    atendimento_id,
    patient_id: patientId || null,
    ...uploaded,
    previous_prescription_file: uploaded.previous_prescription_url,
    foto_receita_url: uploaded.previous_prescription_url,
    previous_prescription_source: source
  };

  await createAuditLog({
    entity_type: 'previous_prescription',
    entity_id: atendimento_id,
    action: 'ingest_success',
    actor: 'backend',
    payload: {
      correlationId,
      patient_id: patientId || null,
      storage_path: storagePath,
      mime_type: mimeType,
      size: buffer.length,
      source
    }
  }).catch(() => {});

  return result;
}

async function createViewSignedUrl(storagePath) {
  if (!storagePath) return null;
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) {
    const err = new Error(`Não foi possível gerar link de visualização: ${error.message}`);
    err.code = 'PRESCRIPTION_VIEW_URL_FAILED';
    throw err;
  }
  return data.signedUrl;
}

function applyPrescriptionMetadataToClinical(clinical = {}, meta = {}) {
  if (!meta || !meta.previous_prescription_url) return clinical;
  return {
    ...clinical,
    previous_prescription: true,
    has_previous_prescription: true,
    receita_anterior: true,
    previous_prescription_file: meta.previous_prescription_url,
    previous_prescription_url: meta.previous_prescription_url,
    previous_prescription_storage_path: meta.previous_prescription_storage_path,
    previous_prescription_mime_type: meta.previous_prescription_mime_type,
    previous_prescription_size: meta.previous_prescription_size,
    previous_prescription_uploaded_at: meta.previous_prescription_uploaded_at,
    previous_prescription_source: meta.previous_prescription_source || meta.source || 'typebot/n8n',
    foto_receita_url: meta.foto_receita_url || meta.previous_prescription_url
  };
}

function formatIngestError(error) {
  const code = error?.code || 'PRESCRIPTION_INGEST_FAILED';
  const message = error?.message || 'Erro ao processar foto da receita anterior';
  return { code, message };
}

module.exports = {
  ALLOWED_MIME,
  MAX_BYTES,
  BUCKET,
  applyPrescriptionMetadataToClinical,
  buildMetadataFromExisting,
  buildStoragePath,
  createViewSignedUrl,
  extensionFromMime,
  formatIngestError,
  getBucketName,
  ingestPreviousPrescription,
  isAlreadyStoredInBucket,
  isHttpUrl,
  uploadBufferFromExternal,
  uploadToStorage,
  validateBuffer
};
