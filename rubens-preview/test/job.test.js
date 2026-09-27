// Painting direction and the order of the job (Rubens_v2.md, section 4.5).

import test from 'node:test';
import assert from 'node:assert/strict';
import { PT_MM } from '../src/config.js';
import { P, dist } from '../src/util.js';
import { segStart, segEnd, segDirStart, segDirEnd } from '../src/geometry.js';
import { cncPlan, strokeDir } from '../src/cnc.js';
import { filleted } from '../src/fillet.js';
import { jobSteps, jobLengths } from '../src/job.js';
import { shape, poly, PAINT, EIGHT } from './shapes.js';

const LIFT = { ...PAINT, lift: true }, SNAKE = { ...PAINT, lift: false };
const startOf = segs => segStart(segs[0]), endOf = segs => segEnd(segs[segs.length - 1]);
const angle = (u, v) => Math.acos(Math.min(1, u.x * v.x + u.y * v.y));

// y grows downwards on the artboard: larger y is lower on the picture.
const drawnDown = () => poly([[300, 200], [300, 1200], [900, 1700]]);     // drawn from the top down
const drawnUp = () => poly([[300, 1700], [300, 700], [900, 200]]);        // drawn from the bottom up
const level = () => poly([[100, 500], [1400, 500 + 2 / PT_MM * 0.4]]);    // ends 0.8 mm apart in height

test('bottom-to-top: a stroke drawn downwards is painted against the drawing', () => {
  const p = drawnDown();
  assert.equal(strokeDir(filleted(p, PAINT.cornerR).segs), -1);
  for (const ps of cncPlan(p, EIGHT, LIFT).passes) {
    assert.equal(ps.dir, -1);
    assert.ok(startOf(ps.segs).y > endOf(ps.segs).y, `pass ${ps.lane} starts at the bottom`);
  }
});

test('bottom-to-top: a stroke drawn upwards keeps the drawing direction', () => {
  for (const ps of cncPlan(drawnUp(), EIGHT, LIFT).passes) {
    assert.equal(ps.dir, 1);
    assert.ok(startOf(ps.segs).y > endOf(ps.segs).y);
  }
});

test('ends within 1 mm of the same height keep the drawing direction', () => {
  for (const ps of cncPlan(level(), EIGHT, LIFT).passes) assert.equal(ps.dir, 1);
});

test('reversing a pass keeps its lane on the same edge of the line', () => {
  const p = drawnDown();
  const snake = cncPlan(p, EIGHT, SNAKE).passes;           // lane 1 drawn with, lane 2 against
  const up = cncPlan(p, EIGHT, LIFT).passes;               // all against
  for (let i = 0; i < 8; i++) {
    const a = snake[i], b = up[i];
    const [s, e] = a.dir === b.dir ? [startOf(a.segs), endOf(a.segs)] : [endOf(a.segs), startOf(a.segs)];
    assert.ok(dist(s, startOf(b.segs)) < 1e-6 && dist(e, endOf(b.segs)) < 1e-6, `lane ${i + 1} moved`);
  }
});

test('the first drop of every pass is where the pass starts', () => {
  for (const ps of cncPlan(drawnDown(), EIGHT, LIFT).passes)
    assert.ok(dist(ps.drops[0].at, startOf(ps.segs)) < 1e-6);
});

test('lift on: pass, travel, pass… — travel is one straight line from end to next start', () => {
  const p = drawnDown(), steps = jobSteps([p], () => EIGHT, LIFT);
  assert.deepEqual(steps.map(s => s.kind), ['paint', 'travel', 'paint', 'travel', 'paint', 'travel', 'paint', 'travel', 'paint', 'travel', 'paint', 'travel', 'paint', 'travel', 'paint']);
  for (let k = 1; k < steps.length; k += 2) {
    const tr = steps[k].segs;
    assert.equal(tr.length, 1); assert.equal(tr[0].t, 'L');
    assert.ok(dist(tr[0].a, endOf(steps[k - 1].segs)) < 1e-6 && dist(tr[0].b, startOf(steps[k + 1].segs)) < 1e-6);
  }
  assert.deepEqual(steps.filter(s => s.kind === 'paint').map(s => s.lane), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('lift off: a snake — passes alternate and are joined by smooth semicircles of radius pitch / 2', () => {
  const p = shape([['L', 1200], ['R', 300, 90], ['L', 600]], { start: P(100, 300), weight: 272 });
  const steps = jobSteps([p], () => EIGHT, SNAKE);
  assert.deepEqual(steps.map(s => s.kind), ['paint', 'turn', 'paint', 'turn', 'paint', 'turn', 'paint', 'turn', 'paint', 'turn', 'paint', 'turn', 'paint', 'turn', 'paint']);
  assert.deepEqual(steps.filter(s => s.kind === 'paint').map(s => s.dir), [1, -1, 1, -1, 1, -1, 1, -1]);
  const pitch = p.style.weight / 8;
  for (let k = 1; k < steps.length; k += 2) {
    const [arc] = steps[k].segs, before = steps[k - 1].segs, after = steps[k + 1].segs;
    assert.equal(arc.t, 'A');
    assert.ok(Math.abs(arc.r - pitch / 2) < 1e-6, `radius ${arc.r}`);
    assert.ok(Math.abs(Math.abs(arc.s) - Math.PI) < 1e-6, 'a half circle');
    assert.ok(dist(segStart(arc), endOf(before)) < 1e-6 && dist(segEnd(arc), startOf(after)) < 1e-6);
    assert.ok(angle(segDirEnd(before[before.length - 1]), segDirStart(arc)) < 1e-6, 'smooth into the turn');
    assert.ok(angle(segDirEnd(arc), segDirStart(after[0])) < 1e-6, 'smooth out of the turn');
  }
});

test('an empty lane: the snake turn spans two pitches', () => {
  const cols = [...EIGHT]; cols[2] = null;
  const p = shape([['L', 1200]], { start: P(100, 300), weight: 272 });
  const turns = jobSteps([p], () => cols, SNAKE).filter(s => s.kind === 'turn');
  assert.ok(Math.abs(turns[1].segs[0].r - p.style.weight / 8) < 1e-6);   // lane 2 → lane 4
});

test('between strokes the brush always leaves the canvas', () => {
  const a = shape([['L', 800]], { start: P(100, 300) }), b = shape([['L', 800]], { start: P(100, 1200) });
  for (const paint of [LIFT, SNAKE]) {
    const steps = jobSteps([a, b], () => EIGHT, paint);
    const i = steps.findIndex(s => s.stroke === b.id);
    assert.equal(steps[i].kind, 'travel');
  }
});

test('lengths: painted = all passes (+ turns), travel = the rest', () => {
  const p = shape([['L', 1000]], { start: P(100, 300), weight: 272 });
  const lift = jobLengths(jobSteps([p], () => EIGHT, LIFT));
  assert.ok(Math.abs(lift.paint - 8000) < 1e-6);
  assert.ok(lift.travel > 7 * 1000);
  const snake = jobLengths(jobSteps([p], () => EIGHT, SNAKE));
  assert.ok(Math.abs(snake.paint - (8000 + 7 * Math.PI * 272 / 16)) < 1e-6);
  assert.equal(snake.travel, 0);
});
