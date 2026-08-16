import sharp from 'sharp';
import { analyseSize, analysePixels } from './analyse.js';

/* decode + resize is the one step that genuinely differs from the browser:
   sharp().raw() where canvas's getImageData() stood before. `kernel:
   'nearest'` matches the browser's imageSmoothingEnabled=false — a smooth
   resample would blend adjacent stroke colours together before analysePixels
   ever sees them, changing what the k-means finds. ensureAlpha() forces RGBA
   output so analysePixels (`d[i*4]`, `d[i*4+1]`, `d[i*4+2]`) reads it
   exactly like ImageData.data, regardless of whether the source had alpha.

   `pal` stays in the engine's native [r,g,b]-per-band shape (the same shape
   PRESETS and every REFS entry in src/engine/ uses) — run.js feeds this
   straight to dye()/reband() as a REFS entry. Formatting it as hex strings
   is a display concern for whoever prints it (src/analyse/cli.js), not
   this function's job. */
async function analyseFile(path) {
  const img = sharp(path);
  const meta = await img.metadata();
  const { w, h } = analyseSize(meta.width, meta.height);
  const { data } = await img
    .resize(w, h, { kernel: 'nearest', fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = analysePixels(data, w, h);
  return {
    source: path,
    width: meta.width,
    height: meta.height,
    analysedAt: { w, h },
    vertical: result.vertical,
    pal: result.pal,
    prof: result.prof
  };
}

export { analyseFile };
