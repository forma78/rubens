import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_PROFILES, canvasRangeOverrides, canvasGuidance } from '../src/syndicate/canvas.js';

test('canvasRangeOverrides returns {} for a ratio with no profile', () => {
  assert.deepEqual(canvasRangeOverrides(4), {});
  assert.deepEqual(canvasRangeOverrides(undefined), {});
});

test('canvasRangeOverrides returns the profile\'s nv/nh for a known ratio', () => {
  assert.deepEqual(canvasRangeOverrides(2), CANVAS_PROFILES[2].range);
  assert.deepEqual(canvasRangeOverrides(2), { nv: [1, 1], nh: [2, 3] });
});

test('canvasGuidance always includes the general cloth-physics framing', () => {
  const g = canvasGuidance(undefined);
  assert.match(g, /painted by hand/);
  assert.match(g, /Real cloth/);
});

test('canvasGuidance appends the format-specific note when a profile exists', () => {
  const g = canvasGuidance(2);
  assert.match(g, /60x80cm/);
  assert.match(g, /exactly 1, never 2/);
});
