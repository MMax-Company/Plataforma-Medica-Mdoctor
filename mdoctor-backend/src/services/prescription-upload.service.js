const { getAtendimento } = require('../store/atendimentos.store');
const { createAuditLog } = require('../store/audit.store');
const {
  applyPrescriptionMetadataToClinical,
  formatIngestError
} = require('./previous-prescription-storage.service');
const { uploadBufferFromExternal } = require('./previous-prescription-storage.service');
const {
  assertTokenActive,
  markUploadSessionCompleted,
  resolveTokenRecord
} = require('./prescription-upload-token.service');

function mimeFromFilename(name = '') {
  const ext = String(name).split('.').pop()?.toLowerCase();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    pdf: 'application/pdf'
  };
  return map[ext] || null;
}

async function completeExternalPrescriptionUpload({ token, buffer, mimeType, filename, correlationId = null }) {
  const record = await resolveTokenRecord(token);
  try {
    assertTokenActive(record);
  } catch (error) {
    throw error;
  }

  const resolvedMime = String(mimeType || mimeFromFilename(filename) || '').toLowerCase();
  let prescriptionMeta;
  try {
    prescriptionMeta = await uploadBufferFromExternal({
      buffer,
      mimeType: resolvedMime,
      atendimentoId: record.atendimentoId,
      source: 'external_upload'
    });
  } catch (error) {
    await createAuditLog({
      entity_type: 'prescription_upload',
      entity_id: record.atendimentoId,
      action: 'upload_failed',
      actor: 'patient',
      payload: { correlationId, ...formatIngestError(error) }
    });
    throw error;
  }

  const atendimento = await getAtendimento(record.atendimentoId);
  const clinical = applyPrescriptionMetadataToClinical(atendimento?.dados_clinicos || {}, prescriptionMeta);

  await markUploadSessionCompleted({
    token,
    atendimentoId: record.atendimentoId,
    correlationId,
    clinicalPatch: {
      ...clinical,
      prescription_ingest: { ok: true, storage_path: prescriptionMeta.previous_prescription_storage_path }
    }
  });

  const updated = await getAtendimento(record.atendimentoId);
  return { atendimento: updated, prescriptionMeta };
}

module.exports = {
  completeExternalPrescriptionUpload,
  mimeFromFilename
};
