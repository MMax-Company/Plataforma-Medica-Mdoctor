/**
 * Opcional: espelha PDF Memed (URL HTTPS) no bucket prescriptions quando habilitado.
 */
const axios = require('axios');
const { initSupabase, getSupabase } = require('../config/supabase');
const logger = require('../config/logger');

const BUCKET = process.env.SUPABASE_BUCKET_PRESCRIPTIONS || 'prescriptions';

async function mirrorMemedPdfToStorage({ atendimentoId, memedId, sourceUrl }) {
  if (process.env.MEMED_MIRROR_PDF_TO_STORAGE !== 'true') {
    return { mirrored: false, reason: 'MEMED_MIRROR_PDF_TO_STORAGE not enabled' };
  }
  if (!sourceUrl || !/^https:\/\//i.test(String(sourceUrl))) {
    return { mirrored: false, reason: 'invalid_source_url' };
  }

  initSupabase();
  const supabase = getSupabase();
  const path = `memed/${atendimentoId}/${memedId || 'receita'}.pdf`;

  const response = await axios.get(sourceUrl, {
    responseType: 'arraybuffer',
    timeout: Number(process.env.MEMED_TIMEOUT_MS || 15000),
    maxRedirects: 5
  });

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, Buffer.from(response.data), {
    contentType: 'application/pdf',
    upsert: true
  });
  if (uploadError) throw uploadError;

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, Number(process.env.PRESCRIPTION_SIGNED_TTL_SECONDS || 3600));
  if (signError) throw signError;

  logger.info('memed_pdf_mirrored', { atendimentoId, path, bucket: BUCKET });
  return { mirrored: true, storagePath: path, signedUrl: signed?.signedUrl || null };
}

module.exports = { mirrorMemedPdfToStorage };
