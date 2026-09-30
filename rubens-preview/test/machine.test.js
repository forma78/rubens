// The machine model behind the Calibration page (src/machine.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS_PER_MM, HOME_STEPS, STOPS, WALLS, toMm, parsePing, cornerAt, fitAffine, canvasReport, artboardCorner, jobToMachine, arcSpeed, canvasFromEdges } from '../src/machine.js';
import { jobSteps, jobFile } from '../src/job.js';
import { PT_MM } from '../src/config.js';
import { P } from '../src/util.js';
import { poly, shape, EIGHT, PAINT } from './shapes.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('steps to mm: 80 per mm on X, 3200 per 120 mm on Y', () => {
  assert.equal(toMm('x', 46800), 585);
  assert.ok(near(toMm('y', 3200), 120));
  assert.ok(near(STEPS_PER_MM.y, 26.6666667, 1e-6));
});

test('home and walls: zero at the walls, the reserve to each stop is minus', () => {
  assert.equal(WALLS.x.min, 0); assert.equal(WALLS.y.min, 0);
  assert.equal(WALLS.x.max, 865);
  assert.equal(toMm('x', HOME_STEPS.x), STOPS.x.min);
  assert.ok(near(toMm('y', HOME_STEPS.y), -8.325));
  assert.equal(STOPS.x.max - WALLS.x.max, 5);   // the owner's fuel-tank reserve at the top
  assert.ok(near(WALLS.y.max, 568.5) && STOPS.y.max - WALLS.y.max > 10);
});

test('ping: numbers, no zero, walls', () => {
  assert.deepEqual(parsePing('ok P X 46800 Y 0'), { x: 46800, y: 0, edgeX: false, edgeY: false });
  assert.deepEqual(parsePing('ok P X ? Y -638'), { x: null, y: -638, edgeX: false, edgeY: false });
  assert.deepEqual(parsePing('ok P X 46000 край Y 267 край'), { x: 46000, y: 267, edgeX: true, edgeY: true });
  assert.equal(parsePing('нет платы'), null);
  assert.equal(parsePing(''), null);
});

test('a corner out of reach: the tip plus the ruler offset', () => {
  assert.deepEqual(cornerAt({ x: 585, y: 560, up: 12, right: 30 }), { x: 597, y: 590 });
  assert.deepEqual(cornerAt({ x: 1, y: 2 }), { x: 1, y: 2 });
  assert.equal(cornerAt(null), null);
});

test('affine fit recovers a turned canvas from its four corners', () => {
  // 600 × 800, top left corner at X 575, Y 20, turned by 0.3°:
  // artboard u → machine +Y, v (down) → machine −X.
  const t = 0.3 * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  const place = (u, v) => ({ x: 575 - v * c + u * s, y: 20 + u * c + v * s });
  const recs = {};
  for (const n of ['tl', 'tr', 'br', 'bl']) { const { u, v } = artboardCorner(n, 600, 800); recs[n] = place(u, v); }
  const rep = canvasReport(recs, 600, 800);
  for (const [u, v] of [[0, 0], [300, 400], [600, 800], [123, 777]]) {
    const q = rep.fit.at(u, v), p = place(u, v);
    assert.ok(near(q.x, p.x, 1e-6) && near(q.y, p.y, 1e-6));
  }
  assert.ok(rep.residual < 1e-6);
  const left = rep.edges.find(e => e.name === 'left');
  // the bottom sits 800·sin 0.3° = 4.19 mm to the right of the top: going up, the edge drifts to −Y
  assert.ok(near(left.length, 800) && near(left.deg, -0.3, 1e-9), `left edge ${left.deg}°`);
  assert.ok(near(left.drift, -800 * s));
  assert.ok(near(rep.diag.tlbr, 1000) && near(rep.diag.trbl, 1000));
});

test('two corners: edges are measured, no fit yet', () => {
  const rep = canvasReport({ bl: { x: -225, y: 12.7 }, tl: { x: 575, y: 14.7 } }, 600, 800);
  assert.equal(rep.fit, null);
  const [left] = rep.edges;
  assert.equal(left.name, 'left');
  assert.ok(near(left.length, Math.hypot(800, 2)));
  assert.ok(near(left.drift, 2));
});

test('the canvas from four edges: the tip at each edge plus the ruler past it (2026-09-30)', () => {
  // the owner's 70 × 100 canvas: the tip at the machine's limits, the canvas edges past them
  const edges = { left: { at: -8.32, past: 12 }, right: { at: 569.36, past: 108 },
                  top: { at: 867.36, past: 50 }, bottom: { at: -5.69, past: 78 } };
  const c = canvasFromEdges(edges);
  assert.deepEqual(c.tl, { x: 917.36, y: -20.32, up: 0, right: 0 });
  assert.deepEqual(c.br, { x: -83.69, y: 677.36, up: 0, right: 0 });
  const rep = canvasReport(c, 700, 1000);
  for (const e of rep.edges) {
    assert.ok(Math.abs(e.length / e.nominal - 1) < 0.015, `${e.name} ${e.length}`);   // the Job tab takes it
    assert.ok(near(e.drift, 0), `${e.name} drift ${e.drift}`);                        // parallel to the rails
  }
  assert.ok(near(rep.fit.at(0, 0).x, 917.36, 1e-6) && near(rep.fit.at(0, 0).y, -20.32, 1e-6));   // artboard top left
  // a ruler number forgotten: the canvas comes out too small, and the Job tab refuses it
  const short = canvasReport(canvasFromEdges({ ...edges, top: { at: 867.36 } }), 700, 1000);
  assert.ok(short.edges.some(e => Math.abs(e.length / e.nominal - 1) > 0.015));
  assert.equal(canvasFromEdges({ left: edges.left, right: edges.right, top: edges.top }), null);   // all four, or none
});

test('fit needs three points off one line', () => {
  assert.equal(fitAffine([{ u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 0, y: 1 }]), null);
  assert.equal(fitAffine([{ u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 0, y: 1 }, { u: 2, v: 0, x: 0, y: 2 }]), null);
});

// ---------- the job on the machine ----------

// A 600 × 800 canvas lying straight: its top left corner at X 800, Y 0.
// Artboard u (right) → machine +Y, v (down) → machine −X.
const straight = () => canvasReport({ tl: { x: 800, y: 0 }, tr: { x: 800, y: 600 }, br: { x: 0, y: 600 }, bl: { x: 0, y: 0 } }, 600, 800);
const fileOf = (paths, paint) => jobFile(jobSteps(paths, () => EIGHT, paint), { formatKey: 'p60x80', format: { w: 600, h: 800 }, paint });
const MM = v => v / PT_MM;   // mm → document units

test('job on the machine: brush off, travel, brush on, pass… brush off and home at the end', () => {
  const p = poly([[MM(100), MM(700)], [MM(100), MM(100)]]);   // drawn upwards, 600 mm
  const { blocks, pastWall } = jobToMachine(fileOf([p], { ...PAINT, lift: true }), straight().fit);
  assert.deepEqual(pastWall, []);
  const kinds = blocks.map(b => b.kind === 'arm' ? (b.off ? 'off' : 'on') : b.cmds.some(c => c[0] === 'M') ? 'travel' : 'pass');
  assert.deepEqual(kinds.slice(0, 5), ['off', 'travel', 'on', 'pass', 'off']);
  assert.deepEqual(kinds.slice(-2), ['off', 'travel']);
  const home = blocks[blocks.length - 1];
  assert.ok(home.home);
  assert.deepEqual(home.cmds, ['T 100', 'M 0.10 0.10', 'G']);   // the bottom left corner inside the walls
  assert.equal(kinds.filter(k => k === 'pass').length, 8);
  for (const b of blocks) if (b.kind === 'move') assert.equal(b.cmds[b.cmds.length - 1], 'G');
});

test('job on the machine: a pass from the bottom up runs towards +X', () => {
  const p = poly([[MM(100), MM(700)], [MM(100), MM(100)]]);
  const { blocks } = jobToMachine(fileOf([p], { ...PAINT, lift: true }), straight().fit);
  const first = blocks.find(b => b.kind === 'move' && b.cmds[0].startsWith('F'));
  const [, x, y] = first.cmds[1].split(' ').map(Number);
  assert.ok(Math.abs(x - 700) < 1, `ends at X ${x}`);                 // v = 100 mm → X = 700
  const travel = blocks[1].cmds.find(c => c[0] === 'M').split(' ').map(Number);
  assert.ok(Math.abs(travel[1] - 100) < 1, `starts at X ${travel[1]}`); // v = 700 mm → X = 100
  assert.ok(Math.abs(first.paintMM - 600) < 1);
});

test('job on the machine: an arc keeps its centre, end and turning direction', () => {
  // a quarter circle in mm, radius 100 around (300, 400), clockwise on screen
  const job = { steps: [{ kind: 'paint', stroke: 1, lane: 1, length: 157.08, segs: [{ t: 'A', c: { x: 300, y: 400 }, r: 100, a0: 0, s: Math.PI / 2 }] }] };
  const { blocks } = jobToMachine(job, straight().fit);
  const cmd = blocks.find(b => b.kind === 'move' && b.cmds[0].startsWith('F')).cmds.find(c => c[0] === 'A');
  const [, cx, cy, x, y, dir] = cmd.split(' ').map(Number);
  assert.deepEqual([cx, cy, x, y], [400, 300, 300, 300]);   // centre (u 300, v 400) → (X 400, Y 300); end (300, 500) → (300, 300)
  assert.equal(dir, 1);                                      // on the machine it turns from +X towards +Y
});

test('job on the machine: the snake paints a whole stroke in one run', () => {
  const p = shape([['L', MM(400)]], { start: P(MM(100), MM(300)), weight: 272 });
  const { blocks } = jobToMachine(fileOf([p], { ...PAINT, lift: false }), straight().fit);
  const runs = blocks.filter(b => b.kind === 'move' && b.cmds[0].startsWith('F'));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].cmds.filter(c => c[0] === 'A').length, 7);   // seven semicircle turns
});

test('job on the machine: brush mode paints the whole stroke in one run, brush down, straight steps', () => {
  const p = shape([['L', MM(400)]], { start: P(MM(100), MM(300)), weight: 272 });
  const file = jobFile(jobSteps([p], () => EIGHT, { ...PAINT, lift: true }, 'brush'),
    { formatKey: 'p60x80', format: { w: 600, h: 800 }, paint: PAINT, mode: 'brush' });
  assert.equal(file.mode, 'brush');
  const { blocks } = jobToMachine(file, straight().fit);
  const runs = blocks.filter(b => b.kind === 'move' && b.cmds[0].startsWith('F'));
  assert.equal(runs.length, 1);                                        // 16 trips, one line
  assert.deepEqual(runs[0].cmds.map(c => c[0]), ['F', ...Array(31).fill('L'), 'G']);
  assert.equal(blocks.filter(b => b.kind === 'arm').length, 3);        // off, on at the start; off at the end
});

// Every coordinate the board gets, from L, A (end and centre excluded) and M.
const pointsOf = blocks => blocks.filter(b => b.kind === 'move').flatMap(b => b.cmds)
  .filter(c => /^[LAM] /.test(c)).map(c => { const n = c.split(' ').slice(1).map(Number); return c[0] === 'A' ? { x: n[2], y: n[3] } : { x: n[0], y: n[1] }; });

test('job on the machine: a pass that starts past a wall starts at the wall', () => {
  // the canvas 50 mm lower: its bottom edge below the X wall at 0
  const low = canvasReport({ tl: { x: 750, y: 0 }, tr: { x: 750, y: 600 }, br: { x: -50, y: 600 }, bl: { x: -50, y: 0 } }, 600, 800);
  const p = poly([[MM(100), MM(790)], [MM(100), MM(500)]]);   // from 40 mm below the wall up to 250 mm above it
  const { blocks, pastWall, pastWallMM } = jobToMachine(fileOf([p], { ...PAINT, lift: true }), low.fit);
  assert.equal(pastWall.length, 8);                             // every lane starts past the wall
  assert.ok(Math.abs(pastWallMM - 8 * 40.1) < 1, `past the wall ${pastWallMM}`);
  for (const q of pointsOf(blocks)) assert.ok(q.x >= 0 && q.y >= 0, `past a wall: ${q.x} ${q.y}`);
  const runs = blocks.filter(b => b.kind === 'move' && b.cmds[0].startsWith('F'));
  assert.equal(runs.length, 8);
  for (const r of runs) assert.ok(Math.abs(r.paintMM - 249.9) < 1, `painted ${r.paintMM}`);
});

test('job on the machine: a pass that leaves the reach and comes back runs along the wall, brush down', () => {
  // a line across the right Y wall and back: out at 568.5, in again (the owner, 2026-09-29: no lifting at a wall)
  const job = { steps: [{ kind: 'paint', stroke: 1, lane: 1, length: 0, segs: [
    { t: 'L', a: { x: 500, y: 400 }, b: { x: 620, y: 400 } },     // artboard u 500 → 620: Y 500 → 620, past the wall
    { t: 'L', a: { x: 620, y: 400 }, b: { x: 520, y: 300 } },     // back inside
  ] }] };
  const { blocks, pastWall, pastWallMM } = jobToMachine(job, straight().fit);
  const kinds = blocks.map(b => b.kind === 'arm' ? (b.off ? 'off' : 'on') : b.cmds.some(c => c[0] === 'M') ? 'travel' : 'run');
  assert.deepEqual(kinds, ['off', 'travel', 'on', 'run', 'off', 'travel']);   // one run … and home
  // to the wall (Y 568.4, 0.1 inside it), along it to where the line comes back, on inside
  assert.deepEqual(blocks[3].cmds, ['F 20', 'L 400.00 568.40', 'L 451.60 568.40', 'L 500.00 520.00', 'G']);
  assert.equal(pastWall.length, 1);
  assert.ok(Math.abs(pastWallMM - 51.6 * (1 + Math.SQRT2)) < 0.01, `past the wall ${pastWallMM}`);
  for (const q of pointsOf(blocks)) assert.ok(q.y <= WALLS.y.max, `past the right wall: ${q.y}`);
});

test('job on the machine: an arc across a wall runs along the wall between its two parts', () => {
  // a half circle, radius 30 mm, bulging past the bottom wall (X 0)
  const job = { steps: [{ kind: 'paint', stroke: 1, lane: 1, length: 0, segs: [
    { t: 'A', c: { x: 300, y: 790 }, r: 30, a0: Math.PI, s: -Math.PI },   // centre at X 10: its lowest point at X −20
  ] }] };
  const { blocks, pastWallMM } = jobToMachine(job, straight().fit);
  const runs = blocks.filter(b => b.kind === 'move' && b.cmds[0].startsWith('F'));
  assert.equal(runs.length, 1);
  // before the wall, along it (split where the arc is lowest, one straight line), after it
  assert.deepEqual(runs[0].cmds.map(c => c[0]).filter(c => c !== 'F'), ['A', 'L', 'L', 'A', 'G']);
  for (const c of runs[0].cmds.filter(c => c[0] === 'L')) assert.equal(Number(c.split(' ')[1]), 0.1);   // on the wall, 0.1 inside it
  for (const q of pointsOf(blocks)) assert.ok(q.x >= 0, `past the bottom wall: ${q.x}`);
  const lost = 2 * Math.acos(9.9 / 30) * 30;                    // the part below X 0.1
  assert.ok(Math.abs(pastWallMM - lost) < 0.01, `past the wall ${pastWallMM}, expected ${lost}`);
});

test('job on the machine: an arc pressed into a corner goes round the corner, not across it', () => {
  // a half circle past the bottom wall (X 0) and the right one (Y 568.5): centre (u 570, v 790) → X 10, Y 570
  const job = { steps: [{ kind: 'paint', stroke: 1, lane: 1, length: 0, segs: [
    { t: 'A', c: { x: 570, y: 790 }, r: 30, a0: Math.PI, s: -Math.PI },
  ] }] };
  const { blocks } = jobToMachine(job, straight().fit);
  const run = blocks.find(b => b.kind === 'move' && b.cmds[0].startsWith('F')).cmds;
  const end = c => { const n = c.split(' ').slice(1).map(Number); return c[0] === 'A' ? [n[2], n[3]] : [n[0], n[1]]; };
  let at = blocks[1].cmds.find(c => c[0] === 'M').split(' ').slice(1).map(Number);   // where the run starts
  const along = [];
  for (const c of run.filter(c => c[0] === 'L' || c[0] === 'A')) {
    const q = end(c);
    if (c[0] === 'L') {
      assert.ok((at[0] === 0.1 && q[0] === 0.1) || (at[1] === 568.4 && q[1] === 568.4), `across: ${at} → ${q}`);
      along.push(q.join(' '));
    }
    at = q;
  }
  assert.deepEqual(along, ['0.1 568.4', '10 568.4']);   // along the bottom wall to the corner, then along the right one
  for (const q of pointsOf(blocks)) assert.ok(q.x >= 0 && q.y <= WALLS.y.max, `past a wall: ${q.x} ${q.y}`);
});

test('pass speed: lines at the pass speed, tight arcs no faster than √(250 · r)', () => {
  assert.equal(arcSpeed(80, 5.5), 37);
  assert.equal(arcSpeed(20, 5.5), 20);          // at ×1 nothing changes
  assert.equal(arcSpeed(80, 300), 80);          // a wide arc keeps the pass speed
  const p = shape([['L', MM(400)]], { start: P(MM(100), MM(300)), weight: 272 });
  const file = fileOf([p], { ...PAINT, lift: false });   // the Pencil snake: semicircles of half a lane
  const run = jobToMachine(file, straight().fit, { paintMMs: 80 }).blocks.find(b => b.kind === 'move' && b.cmds[0].startsWith('F'));
  const turnV = arcSpeed(80, 272 * 25.4 / 72 / 16);
  assert.equal(turnV, 38);
  assert.deepEqual(run.cmds.map(c => c[0] === 'F' ? c : c[0]), ['F 80', 'L', ...Array(7).fill([`F ${turnV}`, 'A', 'F 80', 'L']).flat(), 'G']);
  assert.equal(jobToMachine(file, straight().fit, { paintMMs: 900 }).blocks.find(b => b.cmds?.[0]?.startsWith('F')).cmds[0], 'F 200');
});

test('job on the machine: every piece of a run is marked painted or a turn, for the percent', () => {
  const p = shape([['L', MM(400)]], { start: P(MM(100), MM(300)), weight: 500 });
  const file = jobFile(jobSteps([p], () => EIGHT, { ...PAINT, lift: true }, 'brush', 4),
    { formatKey: 'p60x80', format: { w: 600, h: 800 }, paint: PAINT, mode: 'brush', perLane: 4 });
  const run = jobToMachine(file, straight().fit).blocks.find(b => b.kind === 'move' && b.cmds[0].startsWith('F'));
  const pieces = run.cmds.filter(c => /^[LAM] /.test(c));
  assert.equal(run.painted.length, pieces.length);
  assert.deepEqual(run.painted, pieces.map((_, i) => (i % 2 ? 0 : 1)));   // trip, step across, trip…
  assert.ok(Math.abs(run.paintMM - 32 * 400) < 1);
});

// Brush with n trips a lane on a 500 pt stroke: one run, 8n trips of 400 mm at
// the pass speed, each followed by a straight step of a lane / n across.
const brushRun = n => {
  const p = shape([['L', MM(400)]], { start: P(MM(100), MM(300)), weight: 500 });
  const file = jobFile(jobSteps([p], () => EIGHT, { ...PAINT, lift: true }, 'brush', n),
    { formatKey: 'p60x80', format: { w: 600, h: 800 }, paint: PAINT, mode: 'brush', perLane: n });
  assert.equal(file.perLane, n);
  const runs = jobToMachine(file, straight().fit, { paintMMs: 80 }).blocks.filter(b => b.kind === 'move' && b.cmds[0].startsWith('F'));
  assert.equal(runs.length, 1);
  const cmds = runs[0].cmds;
  assert.deepEqual(cmds.filter(c => c[0] !== 'L'), ['F 80', 'G']);   // no arcs, no slow turns
  const pts = cmds.filter(c => c[0] === 'L').map(c => c.split(' ').slice(1).map(Number));
  assert.equal(pts.length, 16 * n - 1);
  const step = 500 * 25.4 / 72 / 8 / n;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    assert.ok(Math.abs(d - (i % 2 ? step : 400)) < 0.02, `piece ${i}: ${d} mm`);
  }
};
test('job on the machine: brush with 4 trips a lane is one run, steps of 5.5 mm straight across', () => brushRun(4));
test('job on the machine: brush with 8 trips a lane is one run, steps of 2.8 mm straight across', () => brushRun(8));
