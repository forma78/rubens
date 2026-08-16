import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutate, numericKeyPool } from '../src/syndicate/mutate.js';
import { validate } from '../src/syndicate/patch.js';
import { S as DEFAULT_STATE } from '../src/engine/index.js';

test('mutate is deterministic: same parent + seed => same patch', () => {
  const a = mutate(DEFAULT_STATE, 4242);
  const b = mutate(DEFAULT_STATE, 4242);
  assert.deepEqual(a, b);
});

test('different seeds produce different patches', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed++) seen.add(JSON.stringify(mutate(DEFAULT_STATE, seed)));
  assert.ok(seen.size > 1, 'expected variety across seeds');
});

test('mutate touches 2-4 keys, all from the numeric pool', () => {
  const poolKeys = new Set(numericKeyPool().map(k => k.key));
  for (let seed = 1; seed <= 50; seed++) {
    const patch = mutate(DEFAULT_STATE, seed);
    const keys = Object.keys(patch);
    assert.ok(keys.length >= 2 && keys.length <= 4, `seed ${seed}: expected 2-4 keys, got ${keys.length}`);
    for (const k of keys) assert.ok(poolKeys.has(k), `seed ${seed}: ${k} is not in the numeric pool`);
  }
});

test('mutate never touches categorical or locked keys', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const patch = mutate(DEFAULT_STATE, seed);
    for (const k of Object.keys(patch)) {
      assert.ok(!/\.(dir|span|ref)$/.test(k), `seed ${seed}: ${k} should not be mutated`);
      assert.ok(!['ratio', 'pattern', 'thread', 'cell', 'ribbon', 'bg'].includes(k), `seed ${seed}: ${k} is locked`);
    }
  }
});

test('every mutate() patch passes validate() cleanly', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const raw = mutate(DEFAULT_STATE, seed);
    const { ok, errors } = validate(raw);
    assert.equal(ok, true, `seed ${seed}: unexpected errors ${JSON.stringify(errors)}`);
  }
});

test('perturbations are centred on the parent value (sigma = 12% of range)', () => {
  // L[0].bands has range [2,8], sigma = 0.12*6 = 0.72. Sample many seeds and
  // check the mean lands close to the parent's current value (5), not to
  // the middle of the range or a bound.
  const parent = { ...DEFAULT_STATE, L: DEFAULT_STATE.L.map(l => ({ ...l, bands: 5 })) };
  let sum = 0, n = 0;
  for (let seed = 1; seed <= 2000; seed++) {
    const raw = mutate(parent, seed);
    if ('L[0].bands' in raw) { sum += raw['L[0].bands']; n++; }
  }
  assert.ok(n > 50, 'expected L[0].bands to be picked reasonably often across 2000 seeds');
  const mean = sum / n;
  assert.ok(Math.abs(mean - 5) < 1, `expected mean near 5, got ${mean.toFixed(2)} over ${n} samples`);
});
