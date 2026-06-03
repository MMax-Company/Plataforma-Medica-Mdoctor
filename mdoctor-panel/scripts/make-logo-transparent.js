#!/usr/bin/env node
/** Remove fundo branco do logo — gera PNG transparente oficial para login */
const path = require('node:path');
const sharp = require('sharp');

const PUBLIC = path.join(__dirname, '../public');
const INPUT = path.join(PUBLIC, 'doctor-prescreve-logo.png');
const OUTPUT = path.join(PUBLIC, 'doctor-prescreve-logo-transparent.png');

async function main() {
  const { data, info } = await sharp(INPUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r >= 238 && g >= 238 && b >= 238) {
      data[i + 3] = 0;
      continue;
    }
    if (r >= 225 && g >= 225 && b >= 225) {
      const lum = (r + g + b) / 3;
      data[i + 3] = Math.min(data[i + 3], Math.max(0, Math.floor((255 - lum) * 10)));
    }
  }

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(OUTPUT);

  const meta = await sharp(OUTPUT).metadata();
  console.log(`OK → ${OUTPUT} (${meta.width}x${meta.height}, alpha)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
