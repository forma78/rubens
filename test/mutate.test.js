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

/* ---------------------------------------------------------------- model 2 */

import { SCHEMA as MODEL_2, validate as validate2 } from '../src/syndicate/patch2.js';
import { S as DEFAULT_STATE_2 } from '../src/engine2/index.js';

test('model 2 mutates its own keys, not model 1s', () => {
  const keys = new Set(numericKeyPool(MODEL_2).map((k) => k.key));
  for (const brush of ['pitch', 'weight', 'length', 'jitter', 'shade', 'wover', 'paint']) {
    assert.ok(keys.has(brush), `${brush} should be mutable on model 2`);
  }
  for (const dye of ['ilock', 'grain', 'load']) {
    assert.equal(keys.has(dye), false, `${dye} is model 1's dye, not model 2's brush`);
  }
  assert.equal(keys.has('L[0].bands'), false, "bands is model 1's vocabulary");
  assert.equal(keys.has('L[0].ref'), false);
});

test('model 2 never mechanically nudges a categorical field', () => {
  const keys = numericKeyPool(MODEL_2).map((k) => k.key);
  for (const k of keys) {
    assert.equal(k.includes('.dir'), false, `${k} is categorical`);
    assert.equal(k.includes('.span'), false, `${k} is categorical`);
    assert.equal(k.includes('.inks'), false, `${k} is a palette swap, not a nudge`);
    assert.notEqual(k, 'caps');
  }
});

test('L[4].cover is not in model 2s pool — the ribbons layer has no share of the cells', () => {
  const keys = new Set(numericKeyPool(MODEL_2).map((k) => k.key));
  assert.ok(keys.has('L[4].on'), 'the ribbon layer can still be switched off');
  assert.equal(keys.has('L[4].cover'), false);
  assert.ok(keys.has('L[3].cover'));
});

test('every model 2 mutate() patch passes model 2s validate() cleanly', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const raw = mutate(DEFAULT_STATE_2, seed, MODEL_2);
    const { ok, errors } = validate2(raw);
    assert.equal(ok, true, `seed ${seed}: ${JSON.stringify(errors)}`);
  }
});

test('model 2 mutation is deterministic in its seed', () => {
  assert.deepEqual(mutate(DEFAULT_STATE_2, 77, MODEL_2), mutate(DEFAULT_STATE_2, 77, MODEL_2));
});

/* The two models share a mutator but must not share its choices: the same
   seed picks from a different pool, so a model-2 shift is not a model-1
   shift with different colours. */
test('the same seed picks differently for the two models', () => {
  const differ = [1, 2, 3, 4, 5].filter(
    (s) => JSON.stringify(Object.keys(mutate(DEFAULT_STATE_2, s, MODEL_2))) !==
           JSON.stringify(Object.keys(mutate(DEFAULT_STATE_2, s))),
  );
  assert.ok(differ.length > 0, 'model 2 should not be drawing from model 1s key pool');
});
