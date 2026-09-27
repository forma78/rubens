// The two SVG files: the drawing (reopens exactly) and the machine plan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { FORMATS, DEFAULT_PALETTES } from '../src/config.js';
import { cncPlan, cncSvg } from '../src/cnc.js';
import { drawingSvg } from '../src/svg.js';
import { shape, poly, PAINT, EIGHT } from './shapes.js';

const paths = [
  shape([['L', 500], ['R', 300, 180], ['L', 500]], { weight: 200 }),
  poly([[100, 1500], [900, 1500], [900, 2100]], 150),
];
const pal = DEFAULT_PALETTES[0];

test('machine SVG: every pass is a path of M, L and A only', () => {
  const s = cncSvg({ format: FORMATS.p60x80, paths, colorsOf: () => EIGHT, paletteNameOf: () => pal.name, paint: PAINT });
  const passes = s.split('<g id="drop-marks">')[0];
  const ds = [...passes.matchAll(/ d="([^"]*)"/g)].map(m => m[1]);
  const planned = paths.reduce((n, p) => n + cncPlan(p, EIGHT, PAINT).passes.length, 0);
  assert.equal(ds.length, planned);
  for (const d of ds) assert.match(d, /^M[-\d. ]+( [LA][-\d. ]+)+$/);
});

test('drawing SVG: the state in <metadata> restores the strokes exactly', () => {
  const s = drawingSvg({ formatKey: 'p60x80', format: FORMATS.p60x80, paths, palettes: DEFAULT_PALETTES, paint: PAINT, paletteOf: () => pal });
  const meta = s.match(/<metadata id="rubens-state">([\s\S]*?)<\/metadata>/)[1];
  const st = JSON.parse(meta.replace(/- -/g, '--'));
  assert.equal(st.format, 'p60x80');
  assert.deepEqual(st.paths, JSON.parse(JSON.stringify(paths)));
  assert.equal((s.match(/<g id="stroke-/g) || []).length, 2);
});
