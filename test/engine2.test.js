import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = path.join(root, 'test/fixtures/state2.json');
const referencePath = path.join(root, 'test/fixtures/reference2.svg');

/* Model 2 ("lines"), extracted from generator/index2.html on 2026-08-21.
   The extraction was verified the only way that actually proves anything:
   four states were rendered by the untouched index2.html in a real browser
   and by the extracted engine in Node, and all four matched byte for byte —
   the browser's own svgOut divided by view.clientWidth, so each capture set
   the canvas to the canonical 1600*D size to make that ratio 1, which is
   exactly what canonicalFrame() computes here. The rewired page was then
   screenshotted and its canvas came out pixel-identical to the original's.

   This test is what keeps that true: the same guarantee test/parity.test.js
   makes for model 1. Regenerate the reference deliberately (never to make a
   failing test pass) with:
     node --input-type=module -e "
       import { readFile, writeFile } from 'node:fs/promises';
       import { svgOut } from './src/engine2/index.js';
       const { S } = JSON.parse(await readFile('test/fixtures/state2.json', 'utf8'));
       await writeFile('test/fixtures/reference2.svg', svgOut(S, { base: 1600, quality: 'full' }));
     " */
test('engine2 svgOut(fixture) matches the committed reference2.svg byte for byte', async () => {
  const { svgOut } = await import(path.join(root, 'src/engine2/index.js'));
  const { S } = JSON.parse(await readFile(fixturePath, 'utf8'));
  const svg = svgOut(S, { base: 1600, quality: 'full' });
  const reference = await readFile(referencePath, 'utf8');
  assert.equal(svg.length, reference.length, 'rendered SVG should be the same length as the reference');
  assert.equal(svg, reference, 'rendered SVG should be byte-identical to reference2.svg');
});

test('engine2 renders the same bytes twice — no hidden state between calls', async () => {
  const { svgOut } = await import(path.join(root, 'src/engine2/index.js'));
  const { S } = JSON.parse(await readFile(fixturePath, 'utf8'));
  const a = svgOut(S, { base: 800, quality: 'preview' });
  const b = svgOut(S, { base: 800, quality: 'preview' });
  assert.equal(a, b, 'COLC caches brush loads across calls; it must not change what comes out');
});

/* The cloth is model 1's, function for function — the whole reason engine2
   imports geometry instead of keeping a second copy of frozen maths. If
   these ever stop being the same object, one of the two has been edited. */
test('engine2 reuses model 1s cloth rather than duplicating it', async () => {
  const e1 = await import(path.join(root, 'src/engine/index.js'));
  const e2 = await import(path.join(root, 'src/engine2/index.js'));
  for (const fn of ['ribbons', 'layers', 'lattice', 'panels', 'edges', 'drape', 'outline', 'bbox', 'h3', 'owner', 'shareOf', 'ribbonSpan', 'frame']) {
    assert.equal(e2[fn], e1[fn], `${fn} should be the very same function in both engines`);
  }
});
