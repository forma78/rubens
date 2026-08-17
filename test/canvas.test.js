import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_PROFILES, canvasRangeOverrides, canvasGuidance } from '../src/syndicate/canvas.js';

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
