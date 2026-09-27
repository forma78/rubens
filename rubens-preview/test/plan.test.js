// Paint math and the drop plan.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PT_MM } from '../src/config.js';
import { lengthMM, mlNeeded, cleanReachMM, beadMM } from '../src/paint.js';
import { cncPlan } from '../src/cnc.js';
import { shape, PAINT, EIGHT } from './shapes.js';

const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} vs ${b}`);

// A straight 1 m stroke of a 96 mm trace (272.13 pt): lanes are 12 mm.
const meter = (extra = {}) => {
  const p = shape([['L', 1000 / PT_MM]], { weight: 96 / PT_MM });
  Object.assign(p.style, extra);
  return p;
};

test('length of a straight stroke', () => {
  near(lengthMM(meter(), PAINT), 1000, 1e-6, 'mm');
});

test('paint per lane: 1000 mm × 12 mm × 0.3 mm × 1.25 = 4.5 ml', () => {
  near(mlNeeded(meter(), PAINT), 4.5, 1e-9, 'ml');
});

test('auto load: 4.5 ml split into drops of at most 1 ml → 5 × 0.9 ml', () => {
  const plan = cncPlan(meter(), EIGHT, PAINT);
  for (const ps of plan.passes) {
    assert.equal(ps.n, 5);
    near(ps.ml, 0.9, 1e-3, 'ml per drop');
    near(ps.drops[1].s * PT_MM, 200, 0.5, 'drop spacing, mm');
  }
});

test('manual load of 1 ml: a refill every 200 mm, clean reach 222 mm', () => {
  const p = meter({ load: 'manual', ml: 1 });
  for (const ps of cncPlan(p, EIGHT, PAINT).passes) { assert.equal(ps.n, 5); assert.equal(ps.ml, 1); }
  near(cleanReachMM(p, PAINT), 222.22, 0.01, 'reach, mm');
});

test('an empty palette slot has no pass', () => {
  const cols = [...EIGHT]; cols[3] = null;
  const lanes = cncPlan(meter(), cols, PAINT).passes.map(ps => ps.lane);
  assert.deepEqual(lanes, [1, 2, 3, 5, 6, 7, 8]);
});

test('bead length from a 6 mm nozzle: 0.9 ml ≈ 31.8 mm', () => {
  near(beadMM(0.9, 6), 31.83, 0.01, 'mm');
});
