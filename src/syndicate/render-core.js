import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { svgOut } from '../engine/index.js';

/**
 * renderToPng(state, refs, ovr, opts) -> Promise<Buffer> (PNG)
 *
 * state -> svgOut -> resvg -> PNG -> optional sharp resize. Shared by
 * render.js (CLI, one state per process) and the syndicate runner (many
 * states per process, in a round).
 */
async function renderToPng(state, refs, ovr, opts = {}) {
  const svg = svgOut(state, refs, ovr, { quality: opts.quality ?? 'preview' });
  const png = new Resvg(svg).render().asPng();
  let out = sharp(png);
  if (opts.height) out = out.resize({ height: Number(opts.height) });
  return out.png().toBuffer();
}

export { renderToPng };
