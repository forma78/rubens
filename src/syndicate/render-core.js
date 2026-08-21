import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { modelFor } from './models.js';

/**
 * renderToPng(state, refs, ovr, opts) -> Promise<Buffer> (PNG)
 *
 * state -> svgOut -> resvg -> PNG -> optional sharp resize. Shared by
 * render.js (CLI, one state per process) and the syndicate runner (many
 * states per process, in a round).
 *
 * opts.model picks the generator (see models.js); absent means model 1,
 * which is what every shift before generators were a choice ran. refs/ovr
 * are model 1's colour studies and are ignored by a model that has none.
 */
async function renderToPng(state, refs, ovr, opts = {}) {
  const svg = modelFor(opts.model).svg(state, refs, ovr, { quality: opts.quality ?? 'preview' });
  const png = new Resvg(svg).render().asPng();
  let out = sharp(png);
  if (opts.height) out = out.resize({ height: Number(opts.height) });
  return out.png().toBuffer();
}

export { renderToPng };
