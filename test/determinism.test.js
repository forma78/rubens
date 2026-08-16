import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = path.join(root, 'test/fixtures/state.json');

/* SPEC 1.4.1 — same fixed state, rendered twice in separate processes, must
   come out byte-identical. Engine code must never call Math.random(). */
test('svgOut is byte-identical across two separate processes', async () => {
  const script = `
    import { readFile } from 'node:fs/promises';
    import { svgOut } from ${JSON.stringify(path.join(root, 'src/engine/index.js'))};
    const { S, ovr, refs } = JSON.parse(await readFile(${JSON.stringify(fixturePath)}, 'utf8'));
    process.stdout.write(svgOut(S, refs, ovr, { quality: 'preview' }));
  `;
  const runOnce = () => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64
  });

  const a = runOnce();
  const b = runOnce();

  assert.equal(a.length, b.length, 'both renders should have the same length');
  assert.equal(a, b, 'both renders should be byte-identical');
});

test('the committed fixture is a valid { v, S, ovr, refs } state file', async () => {
  const raw = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.equal(typeof raw.v, 'number');
  assert.equal(typeof raw.S, 'object');
  assert.ok(Array.isArray(raw.ovr));
  assert.ok(Array.isArray(raw.refs));
});
