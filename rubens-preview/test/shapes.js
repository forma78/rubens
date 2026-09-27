// Test shapes and helpers. Not a test file itself.

import { P, rad, dist, sub, cross, dot } from '../src/util.js';
import { segEnd, segDirEnd, samplePath } from '../src/geometry.js';

let nextId = 1000;
const style = weight => ({ weight, brush: 'flat12', mix: 35, palette: 'L1', load: 'auto', ml: 1 });

// A stroke from commands, like the demo: ['L', length] — straight;
// ['R'|'T', radius, degrees] — an arc turning right / left.
export function shape(ops, { start = P(0, 0), dir = 0, weight = 272 } = {}) {
  const p = { id: nextId++, segs: [], style: style(weight), seed: 1 };
  let pos = { ...start }, d = P(Math.cos(rad(dir)), Math.sin(rad(dir)));
  for (const [op, a, b] of ops) {
    let g;
    if (op === 'L') g = { t: 'L', a: { ...pos }, b: P(pos.x + d.x * a, pos.y + d.y * a) };
    else {
      const right = op === 'R', n = right ? P(-d.y, d.x) : P(d.y, -d.x), c = P(pos.x + n.x * a, pos.y + n.y * a);
      g = { t: 'A', c, r: a, a0: Math.atan2(pos.y - c.y, pos.x - c.x), s: (right ? 1 : -1) * rad(b) };
    }
    p.segs.push(g); pos = segEnd(g); d = segDirEnd(g);
  }
  return p;
}

// A stroke of straight lines through the given points: sharp kinks at every point.
export function poly(points, weight = 272) {
  const p = { id: nextId++, segs: [], style: style(weight), seed: 1 };
  for (let i = 1; i < points.length; i++) p.segs.push({ t: 'L', a: P(...points[i - 1]), b: P(...points[i]) });
  return p;
}

export const PAINT = { film: 0.3, retention: 25, nozzle: 6, maxDrop: 1, cornerR: 10 };
export const EIGHT = ['#D63A22', '#EC7422', '#5A2B2B', '#5A2B2B', '#5A2B2B', '#EC7422', '#F2C12E', '#FAF8F3'];

// Segments sampled into a polyline, every step units.
export const polyline = (segs, step = 6) => samplePath({ segs }, step).filter(q => !q.fan).map(q => P(q.x, q.y));

function pointSegDist(q, a, b) {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (dot(ab, ab) || 1)));
  return dist(q, P(a.x + ab.x * t, a.y + ab.y * t));
}
// Smallest distance between two polylines (brute force; fine for test sizes).
export function minDist(A, B) {
  let m = Infinity;
  for (const q of A) for (let j = 1; j < B.length; j++) m = Math.min(m, pointSegDist(q, B[j - 1], B[j]));
  for (const q of B) for (let j = 1; j < A.length; j++) m = Math.min(m, pointSegDist(q, A[j - 1], A[j]));
  return m;
}

// Proper crossings between two polylines, as points.
function segCross(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  // half-open [0, 1): a crossing exactly at a shared sample point counts once
  return t >= 0 && t < 1 && u >= 0 && u < 1 ? P(a.x + r.x * t, a.y + r.y * t) : null;
}
export function crossings(A, B, self = false) {
  const out = [];
  for (let i = 1; i < A.length; i++)
    for (let j = self ? i + 2 : 1; j < B.length; j++) {
      const x = segCross(A[i - 1], A[i], B[j - 1], B[j]);
      if (x) out.push(x);
    }
  return out;
}
