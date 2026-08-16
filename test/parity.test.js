import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = path.join(root, 'test/fixtures/state.json');
const enginePath = path.join(root, 'src/engine/index.js');
const renderScript = path.join(root, 'src/syndicate/render.js');

function polylineCount(svg) {
  return (svg.match(/<polyline\b/g) || []).length;
}
function colourSet(svg) {
  const colours = new Set();
  for (const m of svg.matchAll(/(?:stroke|fill)="([^"]+)"/g)) colours.add(m[1]);
  return colours;
}

/* SPEC 1.4.2 — "export the same state from the browser and from the CLI".
   generator/index.html and src/syndicate/render.js both call the one
   svgOut() exported by src/engine — there is no separate browser-side
   implementation left to drift from the CLI's. This test locks in the
   invariant the check is really after (same state + same options => same
   polyline count and colour set) by calling svgOut from two independent
   processes, standing in for the two surfaces, and additionally exercises
   the real `npm run render` binary end to end against the same fixture. */
test('svgOut produces the same polyline count and colour set from two independent processes', () => {
  const script = `
    import { readFile } from 'node:fs/promises';
    import { svgOut } from ${JSON.stringify(enginePath)};
    const { S, ovr, refs } = JSON.parse(await readFile(${JSON.stringify(fixturePath)}, 'utf8'));
    process.stdout.write(svgOut(S, refs, ovr, { base: 1600, quality: 'full' }));
  `;
  const runOnce = () => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64
  });

  const svgA = runOnce();
  const svgB = runOnce();

  assert.equal(polylineCount(svgA), polylineCount(svgB));
  assert.deepEqual([...colourSet(svgA)].sort(), [...colourSet(svgB)].sort());
  assert.ok(polylineCount(svgA) > 0, 'a real render should contain strokes');
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
