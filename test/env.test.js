import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnv } from '../src/syndicate/env.js';

test('loadEnv parses KEY=value lines, skips blanks and comments', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-env-'));
  try {
    const p = path.join(dir, '.env');
    await writeFile(p, '# a comment\nFOO=bar\n\nBAZ="quoted value"\nQUUX=\n');
    const env = await loadEnv(p);
    assert.equal(env.FOO, 'bar');
    assert.equal(env.BAZ, 'quoted value');
    assert.equal(env.QUUX, '');
    assert.equal(Object.keys(env).length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadEnv returns {} when the file does not exist, rather than throwing', async () => {
  const env = await loadEnv('/no/such/.env');
  assert.deepEqual(env, {});
});
