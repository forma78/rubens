import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, INK_LIBRARY } from '../src/syndicate/patch2.js';
import { RANGE as CLOTH_RANGE } from '../src/syndicate/patch.js';

const someInk = [...INK_LIBRARY][0];

test('a clean model-2 patch passes through unchanged', () => {
  const patch = { cols: 4, pitch: 30, weight: 60, caps: 'square', 'L[1].dir': 'v', 'L[1].cover': 80 };
  const { ok, patch: out, errors } = validate(patch);
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(out, patch);
});

/* The cloth is the same cloth, so the same physics binds it. index2.html's
   own sliders are wider — angle from 45, overhang to +30 — but that is the
   artist's range while designing by hand, not an agent's. */
test('cloth ranges are model 1s, not index2.html s wider sliders', () => {
  const { patch } = validate({ angle: 45, over: 30, drape: 0, cols: 40 });
  assert.equal(patch.angle, CLOTH_RANGE.angle[0], 'a 45-degree fold is not cloth');
  assert.equal(patch.over, CLOTH_RANGE.over[1], 'an overhang past nothing is not cloth');
  assert.equal(patch.drape, CLOTH_RANGE.drape[0], 'zero drape is not cloth');
  assert.equal(patch.cols, CLOTH_RANGE.cols[1]);
});

test('polka is welded shut — pattern rejects the whole patch', () => {
  const { ok, patch, errors } = validate({ cols: 4, pattern: 'polka' });
  assert.equal(ok, false);
  assert.deepEqual(patch, {}, 'a locked key voids everything, including the keys that were fine');
  assert.ok(errors.some((e) => e.key === 'pattern' && e.reason.startsWith('locked')));
});

test('brush ranges come from index2.html s own sliders', () => {
  const { patch } = validate({ pitch: 200, weight: 0, length: 500, shade: 99, jitter: -5 });
  assert.equal(patch.pitch, 70);
  assert.equal(patch.weight, 8);
  assert.equal(patch.length, 100);
  assert.equal(patch.shade, 60);
  assert.equal(patch.jitter, 0);
});

test('caps takes its two enum values and nothing else', () => {
  assert.equal(validate({ caps: 'round' }).patch.caps, 'round');
  assert.equal(validate({ caps: 'square' }).patch.caps, 'square');
  const { ok, errors } = validate({ caps: 'oval' });
  assert.equal(ok, false);
  assert.match(errors[0].reason, /expected one of round\|square/);
});

test('inks are patchable, but only from the generator s own library', () => {
  const good = validate({ 'L[0].inks': [someInk] });
  assert.equal(good.ok, true);
  assert.deepEqual(good.patch['L[0].inks'], [someInk]);

  const invented = validate({ 'L[0].inks': ['#ff00ff'] });
  assert.equal(invented.ok, false);
  assert.match(invented.errors[0].reason, /not in the generator's ink library/);
  assert.deepEqual(invented.patch, {}, 'the only key in the patch was dropped, so nothing is left');
});

test('an unknown ink drops its own key and leaves the rest of the patch alone', () => {
  const { ok, patch, errors } = validate({ cols: 5, 'L[0].inks': ['#ff00ff'] });
  assert.equal(ok, false);
  assert.deepEqual(patch, { cols: 5 }, 'an invented colour is a slip, not an overstep');
  assert.equal(errors.length, 1);
});

test('inks must be an array of 1 to 3 real hex strings', () => {
  assert.match(validate({ 'L[0].inks': '#141414' }).errors[0].reason, /expected an array/);
  assert.match(validate({ 'L[0].inks': [] }).errors[0].reason, /expected 1 to 3 inks/);
  assert.match(validate({ 'L[0].inks': [someInk, someInk, someInk, someInk] }).errors[0].reason, /expected 1 to 3/);
  assert.match(validate({ 'L[0].inks': ['red'] }).errors[0].reason, /expected #rrggbb/);
});

test('inks, span and on exist on all five layers; dir and cover only on 0-3', () => {
  for (const i of [0, 1, 2, 3, 4]) {
    assert.equal(validate({ [`L[${i}].inks`]: [someInk] }).ok, true, `L[${i}].inks`);
    assert.equal(validate({ [`L[${i}].on`]: 1 }).ok, true, `L[${i}].on`);
    assert.equal(validate({ [`L[${i}].span`]: 'cell' }).ok, true, `L[${i}].span`);
  }
  // layer 4 is the ribbons: barRibbons lays along the band, and owner()
  // shares the cells between layers 0-3 only
  assert.equal(validate({ 'L[4].dir': 'v' }).ok, false);
  assert.equal(validate({ 'L[4].cover': 50 }).ok, false);
  assert.match(validate({ 'L[4].dir': 'v' }).errors[0].reason, /only applies to layers 0-3/);
});

test('span takes model 2s three values, not model 1s', () => {
  for (const v of ['bar', 'cell', 'sheet']) assert.equal(validate({ 'L[0].span': v }).ok, true, v);
  assert.equal(validate({ 'L[0].span': 'auto' }).ok, false, "'auto' is model 1's vocabulary");
});

test('model 1s dye keys are unknown here', () => {
  const { ok, patch, errors } = validate({ ilock: 40, grain: 50, load: 20, 'L[0].ref': 2, 'L[0].bands': 3 });
  assert.equal(ok, false);
  assert.deepEqual(patch, {});
  assert.equal(errors.length, 5);
  for (const e of errors) assert.match(e.reason, /unknown key/);
});

test('colour pickers are locked unless the brief unlocks them', () => {
  assert.equal(validate({ ribbon: '#123456' }).ok, false);
  const opened = validate({ ribbon: '#123456' }, { unlockedColours: ['ribbon'] });
  assert.equal(opened.ok, true);
  assert.equal(opened.patch.ribbon, '#123456');
});

test('the canvas profile narrows nv/nh here exactly as it does for model 1', () => {
  const { patch } = validate({ nv: 4, nh: 6 }, { canvasFormat: '60x80' });
  assert.equal(patch.nv, 1, '60x80 fixes a single vertical ribbon');
  assert.equal(patch.nh, 3);
});
