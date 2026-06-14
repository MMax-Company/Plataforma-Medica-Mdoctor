const logger = require('../config/logger');

const IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png']);

// Laplacian kernel for edge detection (sharpness estimation)
const LAPLACIAN = { width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] };

// Thresholds — tuned for mobile photos of printed prescriptions
const MIN_PIXELS = 200 * 150;  // 30k px
const MIN_BRIGHTNESS = 30;     // too dark
const MAX_BRIGHTNESS = 230;    // too washed out
const MIN_CONTRAST = 10;       // near-zero stdev = no texture
const MIN_SHARPNESS = 80;      // Laplacian variance

async function analyzeImageQuality(buffer, mimeType) {
  const mime = String(mimeType || '').toLowerCase();

  if (!IMAGE_MIME.has(mime)) {
    return {
      grade: 'not_analyzed',
      score: null,
      analyzed_at: new Date().toISOString(),
      reason: 'Formato PDF não é analisado'
    };
  }

  // Require sharp lazily so missing module causes graceful degradation
  const sharp = require('sharp');

  const [metadata, stats] = await Promise.all([
    sharp(buffer).metadata(),
    sharp(buffer).stats()
  ]);

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  const pixels = width * height;

  // Brightness: mean across all colour channels
  const brightness = stats.channels.reduce((acc, ch) => acc + ch.mean, 0) / stats.channels.length;

  // Contrast: mean stdev across channels
  const contrast = stats.channels.reduce((acc, ch) => acc + ch.stdev, 0) / stats.channels.length;

  // Sharpness via Laplacian variance (resize first for speed, keep proportions)
  const { data: edgeData } = await sharp(buffer)
    .greyscale()
    .resize(800, null, { withoutEnlargement: true, fit: 'inside' })
    .convolve(LAPLACIAN)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const n = edgeData.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += edgeData[i];
  const mean = sum / n;
  let sqDiff = 0;
  for (let i = 0; i < n; i++) sqDiff += (edgeData[i] - mean) ** 2;
  const sharpness = sqDiff / n; // Laplacian variance

  const issues = [];
  if (pixels < MIN_PIXELS) issues.push('resolucao_baixa');
  if (brightness < MIN_BRIGHTNESS) issues.push('imagem_escura');
  else if (brightness > MAX_BRIGHTNESS) issues.push('imagem_clara_demais');
  if (contrast < MIN_CONTRAST) issues.push('baixo_contraste');
  if (sharpness < MIN_SHARPNESS) issues.push('imagem_borrada');

  let grade;
  if (issues.length === 0) grade = 'adequate';
  else if (issues.length === 1) grade = 'marginal';
  else grade = 'inadequate';

  return {
    grade,
    score: Math.round(sharpness),
    analyzed_at: new Date().toISOString(),
    details: {
      width,
      height,
      pixels,
      brightness: Math.round(brightness),
      contrast: Math.round(contrast),
      sharpness_variance: Math.round(sharpness),
      issues
    }
  };
}

async function analyzeImageQualitySafe(buffer, mimeType) {
  try {
    return await analyzeImageQuality(buffer, mimeType);
  } catch (e) {
    logger.warn('prescription_image_quality_analysis_failed', { error: e.message });
    return { grade: 'not_analyzed', score: null, analyzed_at: new Date().toISOString(), reason: e.message };
  }
}

module.exports = { analyzeImageQuality, analyzeImageQualitySafe };
