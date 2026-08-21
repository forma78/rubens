import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_PROFILES, canvasRangeOverrides, canvasGuidance } from '../src/syndicate/canvas.js';
import { validate, RANGE } from '../src/syndicate/patch.js';

test('canvasRangeOverrides returns {} for a format with no profile', () => {
  assert.deepEqual(canvasRangeOverrides('50x50'), {});
  assert.deepEqual(canvasRangeOverrides(undefined), {});
});

test('canvasRangeOverrides returns the profile\'s nv/nh for a known format', () => {
  assert.deepEqual(canvasRangeOverrides('60x80'), CANVAS_PROFILES['60x80'].range);
  assert.deepEqual(canvasRangeOverrides('60x80'), { nv: [1, 1], nh: [2, 3] });
});

test('60x80 and 120x90 share an engine ratio but get different nv/nh treatment', () => {
  assert.equal(CANVAS_PROFILES['60x80'].ratio, CANVAS_PROFILES['120x90'].ratio);
  assert.deepEqual(canvasRangeOverrides('120x90'), {}); // soft preference only, no hard clamp
});

test('canvasGuidance always includes the general cloth-physics framing', () => {
  const g = canvasGuidance(undefined);
  assert.match(g, /painted by hand/);
  assert.match(g, /Real cloth/);
});

test('canvasGuidance appends the format-specific note when a profile exists', () => {
  const g = canvasGuidance('60x80');
  assert.match(g, /60x80cm/);
  assert.match(g, /exactly 1, never 2/);
});

test('canvasGuidance explains the rotation for 120x90', () => {
  const g = canvasGuidance('120x90');
  assert.match(g, /rotated 90 degrees/);
});

test('canvasGuidance explains the brush-coverage reasoning for 90x120', () => {
  const g = canvasGuidance('90x120');
  assert.match(g, /1.5x the physical size/);
});

/* The owner's own painting constraints, given 2026-08-21. Two of them are
   preferences the hard ranges are deliberately wider than; the third is a
   coupling that the ranges already make unreachable, said out loud so an
   agent aims rather than bounces. */
test('cloth guidance carries the preferred thread weight and swell band', () => {
  const g = canvasGuidance(undefined);
  assert.match(g, /thread weight of 2\.0px/);
  assert.match(g, /swell between 15% and 50%/);
});

test('cloth guidance explains why a narrow ribbon cannot be hard-squeezed', () => {
  const g = canvasGuidance(undefined);
  assert.match(g, /Squeeze and ribbon width are coupled/);
  assert.match(g, /tears instead of folding/);
});

test('the squeeze/ribbon-width coupling is unreachable, not merely advised', () => {
  const { patch } = validate({ squeeze: 35, rw: 12 });
  assert.equal(patch.squeeze, 20, 'squeeze cannot exceed 20 whatever an agent asks for');
  assert.equal(patch.rw, 30, 'ribbon width cannot go under 30');
});

test('the preferred bands sit inside the hard ranges, never outside them', () => {
  assert.ok(RANGE.swell[0] <= 15 && RANGE.swell[1] >= 50, 'swell 15-50 must be proposable');
  assert.ok(RANGE.weave[0] <= 2.0 && RANGE.weave[1] >= 2.0, 'a 2.0px thread must be proposable');
  assert.equal(validate({ weave: 2.0 }).patch.weave, 2.0);
  assert.equal(validate({ swell: 15 }).patch.swell, 15);
  assert.equal(validate({ swell: 50 }).patch.swell, 50);
});
