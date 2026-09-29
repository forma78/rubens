// Painting direction and the order of the job (Rubens_v2.md, section 4.5).

import test from 'node:test';
import assert from 'node:assert/strict';
import { PT_MM } from '../src/config.js';
import { P, dist } from '../src/util.js';
import { segStart, segEnd, segDirStart, segDirEnd } from '../src/geometry.js';
import { cncPlan, strokeDir } from '../src/cnc.js';
import { filleted } from '../src/fillet.js';
import { jobSteps, jobLengths, jobTimeline, jobAt, jobFile, pointAlong, timeAtPercent } from '../src/job.js';
import { shape, poly, polyline, crossings, PAINT, EIGHT } from './shapes.js';

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

// ---------- brush: every lane there and back (the owner, 2026-09-28) ----------
const trips = steps => steps.filter(s => s.kind === 'paint');

test('brush: every lane is two trips, up then down, joined at the top by a straight step of a half lane', () => {
  const p = drawnDown(), W = p.style.weight, steps = jobSteps([p], () => EIGHT, LIFT, 'brush');
  const t = trips(steps);
  assert.equal(t.length, 16);
  assert.deepEqual(t.map(s => s.lane), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
  for (let k = 0; k < t.length; k += 2) {
    const there = t[k].segs, back = t[k + 1].segs;
    assert.ok(startOf(there).y > endOf(there).y, 'there goes up the picture');
    assert.ok(startOf(back).y < endOf(back).y, 'back comes down');
    assert.ok(Math.abs(dist(startOf(there), endOf(back)) - W / 16) < 1e-6, 'the trips lie W / 16 apart');
    const turn = steps[steps.indexOf(t[k]) + 1];
    assert.equal(turn.kind, 'turn');                          // the brush stays on the canvas
    assert.equal(turn.segs.length, 1); assert.equal(turn.segs[0].t, 'L');   // no semicircle (2026-09-29)
    assert.ok(Math.abs(dist(turn.segs[0].a, turn.segs[0].b) - W / 16) < 1e-6, 'straight across to the next trip');
  }
  assert.deepEqual(t.map(s => s.back ?? false), Array.from({ length: 16 }, (_, i) => i % 2 === 1));
  assert.ok(t.filter(s => s.back).every(s => s.pass.drops.length === 0), 'drops only where a lane starts');
});

test('brush: the two trips split the lane — its centre line lies halfway between them', () => {
  const p = shape([['L', 1200]], { start: P(100, 300), weight: 272 });
  const pencil = trips(jobSteps([p], () => EIGHT, LIFT)), brush = trips(jobSteps([p], () => EIGHT, LIFT, 'brush'));
  pencil.forEach((ps, i) => {
    const mid = P((startOf(brush[2 * i].segs).x + endOf(brush[2 * i + 1].segs).x) / 2,
                  (startOf(brush[2 * i].segs).y + endOf(brush[2 * i + 1].segs).y) / 2);
    assert.ok(dist(mid, startOf(ps.segs)) < 1e-6, `lane ${ps.lane}`);
  });
});

test('brush: the whole stroke is one line, straight steps only, whatever "brush off after each pass" says', () => {
  const p = shape([['L', 1200], ['R', 300, 90], ['L', 600]], { start: P(100, 300), weight: 272 });
  for (const paint of [LIFT, SNAKE]) {
    const steps = jobSteps([p], () => EIGHT, paint, 'brush');
    assert.equal(steps.filter(s => s.kind === 'travel').length, 0);
    assert.equal(steps.filter(s => s.kind === 'turn').length, 15);   // between trips and between lanes
    for (let k = 1; k < steps.length; k++) assert.ok(dist(endOf(steps[k - 1].segs), startOf(steps[k].segs)) < 1e-6);
    for (const s of steps.filter(s => s.kind === 'turn'))
      assert.ok(s.segs[0].t === 'L' && Math.abs(dist(s.segs[0].a, s.segs[0].b) - p.style.weight / 16) < 1e-6);
  }
});

test('brush: a stroke whose first lane is empty still starts off the canvas', () => {
  const a = shape([['L', 800]], { start: P(100, 300) }), b = shape([['L', 800]], { start: P(100, 1200) });
  const cols = [...EIGHT]; cols[0] = null;
  const steps = jobSteps([a, b], p => p === b ? cols : EIGHT, LIFT, 'brush');
  const i = steps.findIndex(s => s.stroke === b.id);
  assert.equal(steps[i].kind, 'travel');
  assert.equal(steps.filter(s => s.kind === 'travel').length, 1);
});

test('brush: no two trips of a stroke cross', () => {
  const p = shape([['L', 900], ['R', 250, 120], ['L', 500], ['T', 200, 70]], { start: P(200, 300), weight: 272 });
  const t = trips(jobSteps([p], () => EIGHT, LIFT, 'brush')).map(s => polyline(s.segs));
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++)
    assert.equal(crossings(t[i], t[j]).length, 0, `trips ${i} and ${j}`);
});

test('brush, 4 trips a lane: 32 trips a quarter lane apart, up-down-up-down, one line with straight steps', () => {
  const p = drawnDown(), W = p.style.weight, steps = jobSteps([p], () => EIGHT, LIFT, 'brush', 4);
  const t = trips(steps);
  assert.equal(t.length, 32);
  assert.deepEqual(t.map(s => s.trip), Array.from({ length: 32 }, (_, i) => i % 4));
  const bottom = s => s.back ? endOf(s.segs) : startOf(s.segs);
  for (let i = 0; i < 32; i++) {
    const up = startOf(t[i].segs).y > endOf(t[i].segs).y;
    assert.equal(up, i % 2 === 0, `trip ${i} goes ${up ? 'up' : 'down'}`);
    if (i) assert.ok(Math.abs(dist(bottom(t[i - 1]), bottom(t[i])) - W / 32) < 1e-6, `trips ${i - 1}, ${i} lie W / 32 apart`);
  }
  const turns = steps.filter(s => s.kind === 'turn');
  assert.equal(turns.length, 31);                           // three in every lane, seven between lanes
  for (const s of turns) assert.ok(s.segs[0].t === 'L' && Math.abs(dist(s.segs[0].a, s.segs[0].b) - W / 32) < 1e-6);
  assert.equal(steps.filter(s => s.kind === 'travel').length, 0);
  assert.ok(t.filter(s => s.trip > 0).every(s => s.pass.drops.length === 0));
});

test('brush, 4 trips a lane: the lane centre is the middle of its four trips; no trips cross', () => {
  const p = shape([['L', 900], ['R', 250, 120], ['L', 500], ['T', 200, 70]], { start: P(200, 300), weight: 272 });
  const pencil = trips(jobSteps([p], () => EIGHT, LIFT)), four = trips(jobSteps([p], () => EIGHT, LIFT, 'brush', 4));
  pencil.forEach((ps, i) => {
    const b = four.slice(4 * i, 4 * i + 4).map(s => s.back ? endOf(s.segs) : startOf(s.segs));
    const mid = P(b.reduce((a, q) => a + q.x, 0) / 4, b.reduce((a, q) => a + q.y, 0) / 4);
    assert.ok(dist(mid, startOf(ps.segs)) < 1e-6, `lane ${ps.lane}`);
  });
  const lines = four.map(s => polyline(s.segs));
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    assert.equal(crossings(lines[i], lines[j]).length, 0, `trips ${i} and ${j}`);
});

test('brush, 8 trips a lane: the same lane, 64 trips an eighth lane apart, one line; no trips cross', () => {
  const p = shape([['L', 900], ['R', 250, 120], ['L', 500], ['T', 200, 70]], { start: P(200, 300), weight: 272 });
  const W = p.style.weight, steps = jobSteps([p], () => EIGHT, LIFT, 'brush', 8), t = trips(steps);
  assert.equal(t.length, 64);
  assert.deepEqual(t.map(s => s.trip), Array.from({ length: 64 }, (_, i) => i % 8));
  const bottom = s => s.back ? endOf(s.segs) : startOf(s.segs);
  for (let i = 1; i < 64; i++)
    assert.ok(Math.abs(dist(bottom(t[i - 1]), bottom(t[i])) - W / 64) < 1e-6, `trips ${i - 1}, ${i} lie W / 64 apart`);
  const turns = steps.filter(s => s.kind === 'turn');
  assert.equal(turns.length, 63);                           // seven in every lane, seven between lanes
  for (const s of turns) assert.ok(s.segs[0].t === 'L' && Math.abs(dist(s.segs[0].a, s.segs[0].b) - W / 64) < 1e-6);
  assert.equal(steps.filter(s => s.kind === 'travel').length, 0);
  // the lane is where it was: its centre is the middle of its eight trips
  trips(jobSteps([p], () => EIGHT, LIFT)).forEach((ps, i) => {
    const b = t.slice(8 * i, 8 * i + 8).map(bottom);
    const mid = P(b.reduce((a, q) => a + q.x, 0) / 8, b.reduce((a, q) => a + q.y, 0) / 8);
    assert.ok(dist(mid, startOf(ps.segs)) < 1e-6, `lane ${ps.lane}`);
  });
  const lines = t.map(s => polyline(s.segs));
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    assert.equal(crossings(lines[i], lines[j]).length, 0, `trips ${i} and ${j}`);
});

test('between strokes the brush always leaves the canvas', () => {
  const a = shape([['L', 800]], { start: P(100, 300) }), b = shape([['L', 800]], { start: P(100, 1200) });
  for (const [paint, mode] of [[LIFT], [SNAKE], [LIFT, 'brush'], [SNAKE, 'brush']]) {
    const steps = jobSteps([a, b], () => EIGHT, paint, mode);
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

// ---------- the clock ----------
const MODEL = { paintMMs: 20, travelMMs: 100, swingS: 1.5 };

test('clock: paint at the pass speed, travel at the travel speed plus two swings', () => {
  const p = shape([['L', 1000 / PT_MM]], { start: P(100, 300), weight: 272 });   // 1000 mm
  const steps = jobSteps([p], () => EIGHT, LIFT), tl = jobTimeline(steps, MODEL);
  const paint = tl.rows.filter(r => r.step.kind === 'paint'), travel = tl.rows.filter(r => r.step.kind === 'travel');
  assert.equal(paint.length, 8); assert.equal(travel.length, 7);
  for (const r of paint) assert.ok(Math.abs(r.dur - r.Lmm / 20) < 1e-9);
  for (const r of travel) assert.ok(Math.abs(r.dur - (r.Lmm / 100 + 3)) < 1e-9);
  assert.ok(Math.abs(tl.paintMM - 8000) < 1e-6);
  assert.ok(Math.abs(tl.total - tl.rows.reduce((a, r) => a + r.dur, 0)) < 1e-9);
});

test('clock: the percent counts painted length only, and the time left runs down to zero', () => {
  const p = shape([['L', 1000 / PT_MM]], { start: P(100, 300), weight: 272 });
  const tl = jobTimeline(jobSteps([p], () => EIGHT, LIFT), MODEL);
  assert.equal(jobAt(tl, 0).percent, 0);
  const firstPass = tl.rows[0];
  const half = jobAt(tl, firstPass.dur / 2);
  assert.ok(Math.abs(half.percent - 100 / 16) < 1e-9, `${half.percent}`);   // half of one pass of eight
  const during = jobAt(tl, tl.rows[1].t0 + 0.1);                              // in the swing of the first travel
  assert.equal(during.kind, 'travel'); assert.ok(during.off);
  assert.ok(Math.abs(during.percent - 100 / 8) < 1e-9);                     // travel adds nothing
  const end = jobAt(tl, tl.total + 5);
  assert.equal(end.percent, 100); assert.equal(end.left, 0);
});

test('clock: during a swing the brush stands still; then it moves along the travel line', () => {
  const p = shape([['L', 1000 / PT_MM]], { start: P(100, 300), weight: 272 });
  const tl = jobTimeline(jobSteps([p], () => EIGHT, LIFT), MODEL);
  const tr = tl.rows[1], [g] = tr.step.segs;
  const a = jobAt(tl, tr.t0 + 1.0), b = jobAt(tl, tr.t0 + tr.dur - 1.0);
  assert.ok(dist(a, g.a) < 1e-9 && dist(b, g.b) < 1e-9);
  const mid = jobAt(tl, tr.t0 + tr.dur / 2);
  assert.ok(dist(mid, P((g.a.x + g.b.x) / 2, (g.a.y + g.b.y) / 2)) < 1e-6);
});

test('a point along a chain of segments, arcs included', () => {
  const segs = [{ t: 'L', a: P(0, 0), b: P(10, 0) }, { t: 'A', c: P(10, 5), r: 5, a0: -Math.PI / 2, s: Math.PI }];
  assert.ok(dist(pointAlong(segs, 5), P(5, 0)) < 1e-9);
  assert.ok(dist(pointAlong(segs, 10 + 5 * Math.PI / 2), P(15, 5)) < 1e-9);
  assert.ok(dist(pointAlong(segs, 1e9), P(10, 10)) < 1e-9);
});

test('the job file: mm, execution order, drops on paint steps', () => {
  const p = drawnDown(), steps = jobSteps([p], () => EIGHT, LIFT);
  const f = jobFile(steps, { formatKey: 'p60x80', format: { w: 600, h: 800 }, paint: LIFT });
  assert.equal(f.units, 'mm'); assert.equal(f.steps.length, steps.length);
  assert.deepEqual(f.steps.map(s => s.kind), steps.map(s => s.kind));
  const s0 = f.steps[0], g0 = steps[0].segs[0];
  assert.equal(s0.dir, 'against'); assert.equal(s0.lane, 1);
  assert.ok(Math.abs(s0.segs[0].a.x - g0.a.x * PT_MM) < 1e-3);
  assert.ok(s0.drops.length >= 1 && s0.drops[0].ml > 0);
  assert.equal(f.steps[1].drops, undefined);
});

test('clock: the time at which a running machine has painted a given percent', () => {
  const p = drawnDown(), tl = jobTimeline(jobSteps([p], () => EIGHT, LIFT));
  assert.equal(timeAtPercent(tl, 0), 0);
  for (const pct of [12.5, 50, 87]) assert.ok(Math.abs(jobAt(tl, timeAtPercent(tl, pct)).percent - pct) < 1e-6, `${pct} %`);
  const lastPaint = tl.rows.filter(r => r.step.kind === 'paint').pop();
  assert.ok(Math.abs(timeAtPercent(tl, 100) - (lastPaint.t0 + lastPaint.dur)) < 1e-9);
});
