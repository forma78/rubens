// The main property of the CNC plan: the passes of one stroke never cross
// and never come closer than their lane spacing; every pass is smooth.

import test from 'node:test';
import assert from 'node:assert/strict';
import { P, dist, rad } from '../src/util.js';
import { segStart, segEnd, segDirStart, segDirEnd } from '../src/geometry.js';
import { filleted } from '../src/fillet.js';
import { cncPlan } from '../src/cnc.js';
import { shape, poly, PAINT, EIGHT, polyline, minDist, crossings } from './shapes.js';

// Shapes whose centre line does not cross itself and whose corners fit.
const CLEAN = {
  'right angle': poly([[0, 0], [1200, 0], [1200, 1200]]),
  'acute 30° corner': poly([[0, 0], [1500, 0], [100, 380]]),
  'zigzag, 120° turns': poly([[0, 0], [900, 0], [450, 780], [1350, 780], [900, 1560]]),
  'S of two half circles': shape([['L', 500], ['R', 300, 180], ['L', 500], ['T', 300, 180], ['L', 500]]),
  'demo stroke 1': shape([['L', 1130], ['R', 190, 180], ['L', 420], ['T', 170, 135], ['L', 1500]], { start: P(-60, 330), weight: 230 }),
  'demo stroke 3': shape([['L', 700], ['T', 190, 90], ['L', 120]], { start: P(-60, 2060), weight: 170 }),
  // a kink just under 0.5° is not rounded: inner passes must not run backwards there
  'a 0.49° kink': poly([[0, 0], [1000, 0], [1000 + 1000 * Math.cos(rad(0.49)), 1000 * Math.sin(rad(0.49))]]),
};

for (const [name, p] of Object.entries(CLEAN)) {
  test(`${name}: no warnings`, () => {
    assert.deepEqual(filleted(p, PAINT.cornerR).warn, []);
  });

  test(`${name}: passes keep their lane spacing, so they never cross`, () => {
    const plan = cncPlan(p, EIGHT, PAINT), W = p.style.weight;
    assert.equal(plan.passes.length, 8);
    const lines = plan.passes.map(ps => polyline(ps.segs));
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++) {
        const want = (j - i) * W / 8;
        const got = minDist(lines[i], lines[j]);
        assert.ok(got > want - 1, `passes ${i + 1} and ${j + 1}: ${got.toFixed(2)} pt apart, want ${want.toFixed(2)}`);
      }
  });

  test(`${name}: every pass is smooth — no gaps, no kinks`, () => {
    const plan = cncPlan(p, EIGHT, PAINT);
    for (const ps of plan.passes)
      for (let k = 1; k < ps.segs.length; k++) {
        const a = ps.segs[k - 1], b = ps.segs[k];
        assert.ok(dist(segEnd(a), segStart(b)) < 0.06, `pass ${ps.lane}, joint ${k}: gap`);
        const da = segDirEnd(a), db = segDirStart(b);
        const turn = Math.acos(Math.min(1, da.x * db.x + da.y * db.y));
        assert.ok(turn <= rad(0.5) + 1e-6, `pass ${ps.lane}, joint ${k}: kink of ${(turn * 180 / Math.PI).toFixed(2)}°`);
      }
  });
}

test('a zigzag too tight for the width is flagged', () => {
  const p = poly([[0, 0], [200, 0], [0, 60], [200, 120]], 272);
  assert.ok(filleted(p, PAINT.cornerR).warn.length > 0);
});

// Zigzags with segments too short for the rounding (marked "!" in the app).
// There the inner passes must meet in a sharp point, not cross each other.
const TIGHT = {
  'tight zigzag 1': poly([[40, 300], [420, 300], [260, 560], [700, 560], [560, 820]], 200),
  'tight zigzag 2': poly([[60, 1100], [380, 980], [330, 1200], [620, 1120], [760, 1350]], 200),
};
for (const [name, p] of Object.entries(TIGHT))
  test(`${name}: too tight for the rounding, yet the passes do not cross`, () => {
    assert.ok(filleted(p, PAINT.cornerR).warn.length > 0, 'the shape must be too tight');
    const lines = cncPlan(p, EIGHT, PAINT).passes.map(ps => polyline(ps.segs));
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++)
        assert.equal(crossings(lines[i], lines[j]).length, 0, `passes ${i + 1} and ${j + 1} cross`);
  });

test('an arc of the drawing smaller than W/2 is flagged', () => {
  const p = shape([['L', 300], ['R', 50, 90], ['L', 300]], { weight: 272 });
  assert.ok(filleted(p, PAINT.cornerR).warn.length > 0);
});

// Shapes whose centre line crosses itself: there the passes cross too, by design.
const LOOPS = {
  'a 270° loop': shape([['L', 800], ['R', 300, 270], ['L', 900]], { weight: 200 }),
  'demo stroke 2 (it crosses itself)': shape([['L', 520], ['R', 200, 90], ['L', 160], ['R', 160, 180], ['L', 380], ['T', 150, 90], ['L', 900]], { start: P(1780, 1330), dir: 180, weight: 200 }),
};
for (const [name, p] of Object.entries(LOOPS))
  test(`${name}: passes cross only where the centre line crosses itself`, () => {
    const axis = polyline(filleted(p, PAINT.cornerR).segs);
    const selfX = crossings(axis, axis, true);
    assert.ok(selfX.length > 0, 'the test shape must really loop');
    const lines = cncPlan(p, EIGHT, PAINT).passes.map(ps => polyline(ps.segs));
    for (let i = 0; i < 8; i++)
      for (let j = i + 1; j < 8; j++)
        for (const x of crossings(lines[i], lines[j]))
          assert.ok(selfX.some(s => dist(s, x) < p.style.weight), `passes ${i + 1}/${j + 1} cross away from the loop`);
  });
