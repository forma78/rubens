// Gesture fitting: a shaky trail becomes one clean line or arc.

import test from 'node:test';
import assert from 'node:assert/strict';
import { P, rad, rng } from '../src/util.js';
import { segLen } from '../src/geometry.js';
import { fitSegment, pushSeg } from '../src/gesture.js';

const shake = R => (R() - 0.5) * 2;   // ±1 unit of hand tremor

test('a shaky line at 31° snaps to 30° and keeps its length', () => {
  const R = rng(1), a = rad(31), raw = [];
  for (let i = 0; i <= 60; i++) raw.push(P(i * 5 * Math.cos(a) + shake(R), i * 5 * Math.sin(a) + shake(R)));
  raw[0] = P(0, 0);
  const g = fitSegment(raw, P(0, 0), null, null, 5, 15);
  assert.equal(g.t, 'L');
  assert.ok(Math.abs(Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x) - rad(30)) < 1e-9);
  assert.ok(Math.abs(segLen(g) - 300) < 3);
});

test('a shaky quarter circle becomes an arc of exactly 90°', () => {
  const R = rng(2), raw = [];
  for (let i = 0; i <= 44; i++) { const t = rad(i * 2); raw.push(P(200 - 200 * Math.cos(t) + shake(R), 200 * Math.sin(t) + shake(R))); }
  raw[0] = P(0, 0);
  const g = fitSegment(raw, P(0, 0), null, null, 5, 15);
  assert.equal(g.t, 'A');
  assert.ok(Math.abs(Math.abs(g.s) - Math.PI / 2) < 1e-9);
});

test('a line continuing a line is merged into it', () => {
  const path = { segs: [] };
  pushSeg(path, { t: 'L', a: P(0, 0), b: P(100, 0) });
  pushSeg(path, { t: 'L', a: P(100, 0), b: P(200, 0.1) });
  assert.equal(path.segs.length, 1);
  assert.deepEqual(path.segs[0].b, P(200, 0.1));
});
