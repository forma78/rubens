import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyseSize, analysePixels } from '../src/analyse/analyse.js';
import { analyseFile } from '../src/analyse/decode.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(root, 'src/analyse/cli.js');

/* No browser is available in this environment, so these tests exercise the
   Node port against synthetic images with a known, unambiguous answer
   (solid colour bands, no JPEG artefacts) rather than the real hand-painted
   studies. Comparing analyse.js's output against PRESETS in colour.js on
   the four actual studies.jpg the presets were derived from still needs
   those source photographs, which are not in this repository yet. */

async function writeStripes(dir, name, { w, h, colours, axis }) {
  const buf = Buffer.alloc(w * h * 3);
  const n = colours.length;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = axis === 'x' ? x / w : y / h;
      const c = colours[Math.min(n - 1, Math.floor(t * n))];
      const o = (y * w + x) * 3;
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
    }
  }
  const file = path.join(dir, name);
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(file);
  return file;
}

const RED = [220, 40, 40], GREEN = [40, 180, 60], BLUE = [30, 60, 210], YELLOW = [230, 200, 30];

test('analyseSize never upscales and caps the long side at 340', () => {
  assert.deepEqual(analyseSize(1200, 600), { w: 340, h: 170 });
  assert.deepEqual(analyseSize(600, 1200), { w: 170, h: 340 });
  assert.deepEqual(analyseSize(100, 50), { w: 100, h: 50 }); // smaller than MAX: unchanged
});

test('vertical colour bands (running top-to-bottom, changing left-to-right) are detected as vertical strokes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-analyse-'));
  try {
    const file = await writeStripes(dir, 'vertical.png', { w: 240, h: 240, colours: [RED, GREEN, BLUE, YELLOW], axis: 'x' });
    const result = await analyseFile(file);
    assert.equal(result.vertical, true);
    assert.equal(result.pal.length, 8);
    assert.equal(result.prof.length, 48);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('horizontal colour bands (running left-to-right, changing top-to-bottom) are detected as horizontal strokes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-analyse-'));
  try {
    const file = await writeStripes(dir, 'horizontal.png', { w: 240, h: 240, colours: [RED, GREEN, BLUE, YELLOW], axis: 'y' });
    const result = await analyseFile(file);
    assert.equal(result.vertical, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the recovered palette lands close to the true stripe colours', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-analyse-'));
  try {
    const file = await writeStripes(dir, 'bands.png', { w: 300, h: 120, colours: [RED, GREEN, BLUE], axis: 'x' });
    const result = await analyseFile(file);
    // pal is the engine-native [r,g,b]-per-band shape (not hex — that's a
    // display concern for cli.js), so it can be compared to the truth colours directly
    for (const truth of [RED, GREEN, BLUE]) {
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const nearest = Math.min(...result.pal.map(rgb => dist(rgb, truth)));
      assert.ok(nearest < 20, `expected a swatch near ${truth}, closest was ${nearest.toFixed(1)} away`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('analysePixels is deterministic: same buffer in, same result out', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-analyse-'));
  try {
    const file = await writeStripes(dir, 'det.png', { w: 200, h: 200, colours: [RED, GREEN, BLUE], axis: 'x' });
    const { w, h } = analyseSize(200, 200);
    const { data } = await sharp(file).resize(w, h, { kernel: 'nearest', fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const a = analysePixels(data, w, h);
    const b = analysePixels(data, w, h);
    assert.deepEqual(a, b);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('npm run analyse (the real CLI) produces the documented shape for a real file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-analyse-'));
  try {
    const file = await writeStripes(dir, 'cli.png', { w: 200, h: 200, colours: [RED, GREEN, BLUE], axis: 'x' });
    const out = path.join(dir, 'out.json');
    execFileSync(process.execPath, [cliPath, file, '--out', out]);
    const result = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(result.source, file);
    assert.equal(typeof result.vertical, 'boolean');
    assert.equal(result.pal.length, 8);
    assert.ok(result.pal.every(c => /^#[0-9a-f]{6}$/i.test(c)));
    assert.equal(result.prof.length, 48);
    assert.equal(result.prof[0].length, 8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
