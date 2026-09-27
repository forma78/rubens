// The machine model behind the Calibration page (src/machine.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { STEPS_PER_MM, HOME_STEPS, STOPS, WALLS, toMm, parsePing, cornerAt, fitAffine, canvasReport, artboardCorner } from '../src/machine.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('steps to mm: 80 per mm on X, 3200 per 120 mm on Y', () => {
  assert.equal(toMm('x', 46800), 585);
  assert.ok(near(toMm('y', 3200), 120));
  assert.ok(near(STEPS_PER_MM.y, 26.6666667, 1e-6));
});

test('home and walls: zero at the walls, the reserve to each stop is minus', () => {
  assert.equal(WALLS.x.min, 0); assert.equal(WALLS.y.min, 0);
  assert.equal(WALLS.x.max, 850);
  assert.equal(toMm('x', HOME_STEPS.x), STOPS.x.min);
  assert.ok(near(toMm('y', HOME_STEPS.y), -8.325));
  assert.ok(STOPS.x.max - WALLS.x.max > 10);
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

test('fit needs three points off one line', () => {
  assert.equal(fitAffine([{ u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 0, y: 1 }]), null);
  assert.equal(fitAffine([{ u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 0, y: 1 }, { u: 2, v: 0, x: 0, y: 2 }]), null);
});
