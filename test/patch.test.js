import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/syndicate/patch.js';

test('a clean patch passes through unchanged', () => {
  const { ok, patch, errors } = validate({ cols: 7, weave: 3.4, seed: 42 });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(patch, { cols: 7, weave: 3.4, seed: 42 });
});

test('out-of-range numerics are clamped, not rejected', () => {
  const { ok, patch, errors } = validate({ cols: 999, over: -50, angle: 10 });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(patch, { cols: 8, over: -10, angle: 70 });
});

test('integer keys round; weave/edge round to one decimal', () => {
  const { patch } = validate({ cols: 5.6, weave: 3.456, edge: 7.04 });
  assert.deepEqual(patch, { cols: 6, weave: 3.5, edge: 7.0 });
});

test('unknown keys are dropped and logged, the rest of the patch survives', () => {
  const { ok, patch, errors } = validate({ cols: 7, glow: 5 });
  assert.equal(ok, false);
  assert.deepEqual(patch, { cols: 7 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].key, 'glow');
  assert.match(errors[0].reason, /unknown key/);
});

test('wrong types are dropped and logged, the rest of the patch survives', () => {
  const { ok, patch, errors } = validate({ cols: 7, seed: '42' });
  assert.equal(ok, false);
  assert.deepEqual(patch, { cols: 7 });
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

test('L[i].ref is patchable for every layer, including 4 (the ribbons)', () => {
  for (const i of [0, 1, 2, 3, 4]) {
    const { ok, patch, errors } = validate({ [`L[${i}].ref`]: 2 });
    assert.equal(ok, true, `L[${i}].ref should be patchable`);
    assert.deepEqual(errors, []);
    assert.deepEqual(patch, { [`L[${i}].ref`]: 2 });
  }
});

test('L[i].ref clamps to 0-3 (a brief always has exactly 4 references) and rounds to an integer', () => {
  assert.deepEqual(validate({ 'L[0].ref': -1 }).patch, { 'L[0].ref': 0 });
  assert.deepEqual(validate({ 'L[0].ref': 9 }).patch, { 'L[0].ref': 3 });
  assert.deepEqual(validate({ 'L[0].ref': 1.6 }).patch, { 'L[0].ref': 2 });
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

test('opts.canvasFormat overrides nv/nh with the canvas profile\'s narrower range', () => {
  // 60x80cm: nv is fixed at exactly 1, nh is 2 or 3 (canvas.js)
  const { patch } = validate({ nv: 3, nh: 6 }, { canvasFormat: '60x80' });
  assert.deepEqual(patch, { nv: 1, nh: 3 });
});

test('opts.canvasFormat with no canvas profile falls back to the base RANGE', () => {
  // 70x100cm has no nv/nh override in canvas.js
  const { patch } = validate({ nv: 3, nh: 6 }, { canvasFormat: '70x100' });
  assert.deepEqual(patch, { nv: 3, nh: 6 });
});

test('no canvasFormat at all still clamps against the base RANGE', () => {
  const { patch } = validate({ nv: 9, nh: 9 });
  assert.deepEqual(patch, { nv: 4, nh: 6 });
});

test('60x80 and 120x90 share an engine ratio but validate() clamps nv/nh differently', () => {
  const p1 = validate({ nv: 3 }, { canvasFormat: '60x80' }).patch;
  const p2 = validate({ nv: 3 }, { canvasFormat: '120x90' }).patch;
  assert.deepEqual(p1, { nv: 1 });   // hard-fixed
  assert.deepEqual(p2, { nv: 3 });   // no hard clamp, soft preference only
});

test('an empty patch is valid and produces no errors', () => {
  const { ok, patch, errors } = validate({});
  assert.equal(ok, true);
  assert.deepEqual(patch, {});
  assert.deepEqual(errors, []);
});
