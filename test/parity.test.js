import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = path.join(root, 'test/fixtures/state.json');
const referencePath = path.join(root, 'test/fixtures/reference.svg');
const enginePath = path.join(root, 'src/engine/index.js');
const renderScript = path.join(root, 'src/syndicate/render.js');

/* SPEC 1.4.2 — "export the same state from the browser and from the CLI".
   generator/index.html and src/syndicate/render.js both call the one
   svgOut() exported by src/engine — there is no separate browser-side
   implementation left to drift from the CLI's, so there is nothing left for
   a live browser-vs-CLI comparison to actually exercise. What can regress is
   svgOut() itself: a change to the engine, a dependency bump, a different
   Node version, quietly producing different bytes for the same state. This
   compares a fresh render of the committed state fixture against a
   committed golden reference.svg, byte for byte — the same guarantee the
   determinism test makes across two processes, pinned against a frozen
   snapshot instead of against itself. Regenerate reference.svg deliberately
   (never to make a failing test pass) with:
     node --input-type=module -e "
       import { readFile, writeFile } from 'node:fs/promises';
       import { svgOut } from './src/engine/index.js';
       const { S, ovr, refs } = JSON.parse(await readFile('test/fixtures/state.json', 'utf8'));
       await writeFile('test/fixtures/reference.svg', svgOut(S, refs, ovr, { base: 1600, quality: 'full' }));
     " */
test('svgOut(fixture state) matches the committed reference.svg byte for byte', async () => {
  const { svgOut } = await import(enginePath);
  const { S, ovr, refs } = JSON.parse(await readFile(fixturePath, 'utf8'));
  const svg = svgOut(S, refs, ovr, { base: 1600, quality: 'full' });
  const reference = await readFile(referencePath, 'utf8');

  assert.equal(svg.length, reference.length, 'rendered SVG should be the same length as the reference');
  assert.equal(svg, reference, 'rendered SVG should be byte-identical to the committed reference.svg');
});

test('npm run render produces a real PNG from the fixture', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-render-'));
  const out = path.join(dir, 'var.png');
  try {
    execFileSync(process.execPath, [renderScript, '--state', fixturePath, '--out', out, '--height', '300'], {
      cwd: root
    });
    const png = await readFile(out);
    assert.ok(png.length > 0, 'render.js should write a non-empty PNG');
    assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'output should be a PNG file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
