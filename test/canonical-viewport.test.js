import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S as DEFAULT_STATE, PRESETS, dom, frame, canonicalFrame, CANONICAL_BASE, svgOut } from '../src/engine/index.js';

/* S.weave/S.edge are raw pixel widths. svgOut used to render them literally,
   so the same state exported at preview size (base:700) came out with
   relatively thicker thread/edge lines than the same state exported full
   (base:1600) — the stroke didn't get proportionally thinner along with
   everything else. canonicalFrame() fixes the reference viewport at
   CANONICAL_BASE (the full-quality size) so every other viewport rescales
   weave/edge relative to it instead of drawing them at face value. */

function weaveStrokeWidth(svg) {
  const m = svg.match(/stroke="[^"]*" stroke-width="([\d.]+)" stroke-linejoin="round">/);
  assert.ok(m, 'expected to find the grid thread <g> opening tag');
  return Number(m[1]);
}

test('canonicalFrame is exactly frame() at CANONICAL_BASE', () => {
  const S = DEFAULT_STATE;
  const D = dom(S);
  const expected = frame(S, Math.round(CANONICAL_BASE * D.w), Math.round(CANONICAL_BASE * D.h));
  assert.deepEqual(canonicalFrame(S), expected);
});

test('sc is exactly 1 at full quality (base 1600), so weave renders at face value', () => {
  const S = { ...DEFAULT_STATE, cols: 6, rows: 8 };
  const refs = PRESETS.slice(0, 2);
  const ovr = [{}, {}, {}, {}, {}];
  const svg = svgOut(S, refs, ovr, { base: 1600, quality: 'full' });
  assert.equal(weaveStrokeWidth(svg), Number(S.weave.toFixed(2)));
});

test('preview (base 700) scales weave down relative to the canonical viewport, not to its own size', () => {
  const S = { ...DEFAULT_STATE, cols: 6, rows: 8 };
  const refs = PRESETS.slice(0, 2);
  const ovr = [{}, {}, {}, {}, {}];
  const D = dom(S);
  const previewK = frame(S, Math.round(700 * D.w), Math.round(700 * D.h)).k;
  const canonicalK = canonicalFrame(S).k;
  const expectedSc = previewK / canonicalK;

  const svg = svgOut(S, refs, ovr, { base: 700, quality: 'preview' });
  assert.equal(weaveStrokeWidth(svg), Number((S.weave * expectedSc).toFixed(2)));
  assert.ok(expectedSc < 1, 'a smaller-than-canonical viewport should scale weave down');
});
