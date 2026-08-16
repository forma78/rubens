import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/syndicate/patch.js';

test('a clean patch passes through unchanged', () => {
  const { ok, patch, errors } = validate({ cols: 18, weave: 3.4, seed: 42 });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(patch, { cols: 18, weave: 3.4, seed: 42 });
});

test('out-of-range numerics are clamped, not rejected', () => {
  const { ok, patch, errors } = validate({ cols: 999, over: -50, angle: 10 });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(patch, { cols: 40, over: -10, angle: 45 });
});

test('integer keys round; weave/edge round to one decimal', () => {
  const { patch } = validate({ cols: 15.6, weave: 3.456, edge: 7.04 });
  assert.deepEqual(patch, { cols: 16, weave: 3.5, edge: 7.0 });
});

test('unknown keys are dropped and logged, the rest of the patch survives', () => {
  const { ok, patch, errors } = validate({ cols: 10, glow: 5 });
  assert.equal(ok, false);
  assert.deepEqual(patch, { cols: 10 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].key, 'glow');
  assert.match(errors[0].reason, /unknown key/);
});

test('wrong types are dropped and logged, the rest of the patch survives', () => {
  const { ok, patch, errors } = validate({ cols: 10, seed: '42' });
  assert.equal(ok, false);
  assert.deepEqual(patch, { cols: 10 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].key, 'seed');
  assert.match(errors[0].reason, /wrong type/);
});

test('a locked top-level key rejects the whole patch', () => {
  const { ok, patch, errors } = validate({ cols: 10, ratio: 2 });
  assert.equal(ok, false);
  assert.deepEqual(patch, {});
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /locked/);
});

test('pattern is locked', () => {
  const { ok, errors } = validate({ pattern: 'dots' });
  assert.equal(ok, false);
  assert.match(errors[0].reason, /locked/);
});

test('L[i].ref is locked for every layer', () => {
  for (const i of [0, 1, 2, 3, 4]) {
    const { ok, patch, errors } = validate({ [`L[${i}].ref`]: 1 });
    assert.equal(ok, false, `L[${i}].ref should be locked`);
    assert.deepEqual(patch, {});
    assert.match(errors[0].reason, /locked/);
  }
});

test('colour pickers are locked by default', () => {
  const { ok, patch, errors } = validate({ thread: '#112233' });
  assert.equal(ok, false);
  assert.deepEqual(patch, {});
  assert.match(errors[0].reason, /locked/);
});

test('colour pickers are patchable once the brief unlocks them', () => {
  const { ok, patch, errors } = validate({ thread: '#112233' }, { unlockedColours: ['thread'] });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(patch, { thread: '#112233' });
});

test('an unlocked colour key still needs a real hex value', () => {
  const { ok, patch, errors } = validate({ thread: 'blue' }, { unlockedColours: ['thread'] });
  assert.equal(ok, false);
  assert.deepEqual(patch, {});
  assert.match(errors[0].reason, /wrong type/);
});

test('L[i].dir and L[i].span accept only their enum values', () => {
  const good = validate({ 'L[1].dir': 'v', 'L[2].span': 'sheet' });
  assert.equal(good.ok, true);
  assert.deepEqual(good.patch, { 'L[1].dir': 'v', 'L[2].span': 'sheet' });

  const bad = validate({ 'L[1].dir': 'diagonal' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.patch, {});
  assert.match(bad.errors[0].reason, /wrong type/);
});

test('L[i].bands and L[i].on are patchable for every layer including the ribbons (4)', () => {
  const { ok, patch } = validate({ 'L[4].bands': 5, 'L[4].on': 0 });
  assert.equal(ok, true);
  assert.deepEqual(patch, { 'L[4].bands': 5, 'L[4].on': 0 });
});

test('L[i].dir, L[i].span, L[i].cover do not exist on the ribbons layer (4)', () => {
  for (const key of ['L[4].dir', 'L[4].span', 'L[4].cover']) {
    const { ok, patch, errors } = validate({ [key]: 'v' });
    assert.equal(ok, false, `${key} should be rejected`);
    assert.deepEqual(patch, {});
    assert.match(errors[0].reason, /unknown key/);
  }
});

test('L[i].cover is clamped like any other numeric range', () => {
  const { patch } = validate({ 'L[0].cover': 150 });
  assert.deepEqual(patch, { 'L[0].cover': 100 });
});

test('wover and L[i].on clamp to the 0/1 domain', () => {
  const { patch } = validate({ wover: 0.6, 'L[2].on': -3 });
  assert.deepEqual(patch, { wover: 1, 'L[2].on': 0 });
});

test('a non-object patch is rejected outright', () => {
  for (const bad of [null, 'cols:10', 42, ['cols', 10]]) {
    const { ok, patch, errors } = validate(bad);
    assert.equal(ok, false);
    assert.deepEqual(patch, {});
    assert.ok(errors.length > 0);
  }
});

test('an empty patch is valid and produces no errors', () => {
  const { ok, patch, errors } = validate({});
  assert.equal(ok, true);
  assert.deepEqual(patch, {});
  assert.deepEqual(errors, []);
});
