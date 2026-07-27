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
const { analyzeImageQualitySafe } = require('./prescription-image-validator.service');

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

async function completeExternalPrescriptionUpload({
  token,
  buffer,
  mimeType,
  filename,
  correlationId = null,
  mediaId = null,
  messageId = null
}) {
  const record = await resolveTokenRecord(token);
  assertTokenActive(record);

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

  const [atendimento, imageQuality] = await Promise.all([
    getAtendimento(record.atendimentoId),
    analyzeImageQualitySafe(buffer, resolvedMime)
  ]);

  // Reject images with inadequate quality — patient must re-upload
  if (imageQuality?.grade === 'inadequate') {
    const issues = imageQuality?.details?.issues || [];
    const reasons = {
      resolucao_baixa: 'a foto está com resolução muito baixa',
      imagem_escura: 'a foto está muito escura',
      imagem_clara_demais: 'a foto está muito clara / estourada',
      baixo_contraste: 'o texto não está legível (baixo contraste)',
      imagem_borrada: 'a foto está borrada',
    };
    const detail = issues.map(i => reasons[i] || i).filter(Boolean).join('; ') || 'qualidade insuficiente';
    const err = new Error(`Foto da receita ilegível: ${detail}. Tire uma nova foto com boa iluminação e foco.`);
    err.code = 'PRESCRIPTION_IMAGE_INADEQUATE';
    err.statusCode = 422;
    throw err;
  }

  const clinical = applyPrescriptionMetadataToClinical(atendimento?.dados_clinicos || {}, prescriptionMeta);

  await markUploadSessionCompleted({
    token,
    atendimentoId: record.atendimentoId,
    correlationId,
    clinicalPatch: {
      ...clinical,
      prescription_ingest: {
        ok: true,
        storage_path: prescriptionMeta.previous_prescription_storage_path,
        // Fase 2 pedido 3 já registrava caminho/tipo/tamanho/horário (via
        // prescriptionMeta, mesclado acima em ...clinical); message_id e
        // media_id da Meta ficam registrados aqui, quando o envio veio do
        // WhatsApp direto (ausentes no upload legado pela página externa).
        whatsapp_media_id: mediaId,
        whatsapp_message_id: messageId
      },
      prescription_image_quality: imageQuality
    }
  });

  const updated = await getAtendimento(record.atendimentoId);
  return { atendimento: updated, prescriptionMeta };
}

module.exports = {
  completeExternalPrescriptionUpload,
  mimeFromFilename
};
