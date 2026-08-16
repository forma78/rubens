import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S as DEFAULT_STATE, PRESETS, reband, invalidateReband, dye, svgOut } from '../src/engine/index.js';

/* The reband() cache used to be a single flat object keyed "idx:K", shared
   by every caller in the process. That is correct for a page that only ever
   holds one REFS array, but wrong the moment a process renders more than
   one — exactly what the Phase 3 runner will do, rendering many variants
   with different reference palettes back to back. These tests pin the two
   ways that used to go wrong. */

function colourSet(svg) {
  return new Set([...svg.matchAll(/(?:stroke|fill)="([^"]+)"/g)].map(m => m[1]));
}

test('reband() does not cross-contaminate two different REFS arrays at the same idx:K', () => {
  const refsA = PRESETS.slice(0, 2);
  const refsB = [PRESETS[2], PRESETS[3]]; // genuinely different palettes at index 0 and 1

  // interleaved on purpose: A, B, A again — a flat "idx:K" cache would have
  // let B's call at index 0 clobber (or be clobbered by) A's
  const a1 = reband(refsA, 0, 3);
  const b1 = reband(refsB, 0, 3);
  const a2 = reband(refsA, 0, 3);

  assert.deepEqual(a1, a2, 'repeated reband on the same array is stable');
  assert.notDeepEqual(a1.pal, b1.pal, 'two different REFS arrays must not share a cached result');
});

test('invalidateReband() drops a REFS array\'s cache after it is spliced', () => {
  const refs = [PRESETS[0], PRESETS[1], PRESETS[2]];

  const before = reband(refs, 1, 2); // caches PRESETS[1]'s reduction under key "1:2"
  refs.splice(0, 1);                 // now refs = [PRESETS[1], PRESETS[2]]; index 1 is PRESETS[2]
  invalidateReband(refs);
  const after = reband(refs, 1, 2);  // must recompute against PRESETS[2], not return the stale PRESETS[1] answer

  assert.notDeepEqual(before.pal, after.pal, 'stale cache for a spliced array must not survive invalidation');
});

test('dye() for two different states, interleaved in one process, does not cross-contaminate', () => {
  const stateA = { ...DEFAULT_STATE, cseed: 11 };
  const stateB = { ...DEFAULT_STATE, cseed: 11 }; // same cseed on purpose: only refs differ
  const refsA = PRESETS.slice(0, 2);
  const refsB = [PRESETS[2], PRESETS[3]];
  const ovr = [{}, {}, {}, {}, {}];

  const a1 = dye(stateA, refsA, ovr, 1, 0);
  const b1 = dye(stateB, refsB, ovr, 1, 0);
  const a2 = dye(stateA, refsA, ovr, 1, 0);

  assert.deepEqual(a1.pal, a2.pal, 'the same state+refs must reband the same way regardless of what rendered in between');
  assert.notDeepEqual(a1.pal, b1.pal, 'two states with different reference palettes must not share dye colours');
});

test('svgOut() for two different states, interleaved in one process, does not cross-contaminate', () => {
  const stateA = { ...DEFAULT_STATE, cols: 6, rows: 8, seed: 101, cseed: 5 };
  const stateB = { ...DEFAULT_STATE, cols: 6, rows: 8, seed: 101, cseed: 5 }; // same geometry seed, different refs
  const refsA = PRESETS.slice(0, 2);
  const refsB = [PRESETS[2], PRESETS[3]];
  const ovr = [{}, {}, {}, {}, {}];
  const opts = { quality: 'preview' };

  const svgA1 = svgOut(stateA, refsA, ovr, opts);
  const svgB = svgOut(stateB, refsB, ovr, opts);
  const svgA2 = svgOut(stateA, refsA, ovr, opts);

  assert.equal(svgA1, svgA2, 'rendering state B in between must not change state A\'s output');
  assert.notDeepEqual([...colourSet(svgA1)].sort(), [...colourSet(svgB)].sort(),
    'two states with different reference palettes should not land on the same colour set');
});
