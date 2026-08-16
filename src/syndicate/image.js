import sharp from 'sharp';

/**
 * toTransmitJpeg(pngBuffer, opts) -> Promise<Buffer> (JPEG)
 *
 * SPEC 3.3: "longest side 768 px, JPEG q80 for transmission" — this is what
 * both judge and generator calls attach, not the full preview PNG, so an
 * image costs under 1 792 tokens on xAI (which tiles at 448 px, capping at
 * six tiles) and stays cheap on Anthropic too.
 */
async function toTransmitJpeg(pngBuffer, { longestSide = 768, quality = 80 } = {}) {
  const meta = await sharp(pngBuffer).metadata();
  const dim = meta.width >= meta.height ? 'width' : 'height';
  return sharp(pngBuffer).resize({ [dim]: longestSide, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
}

export { toTransmitJpeg };
