// Gesture fitting: a raw mouse trail becomes one clean segment, a straight
// line or a circular arc. A hand shakes, so the gesture gets straightened.
// No DOM here.

import { P, sub, len, norm, dist, cross, rad, wrapA, mod, TAU } from './util.js';
import { tangentArc } from './geometry.js';

// Snap an angle to a step in degrees (0 = no snapping).
export function snapAngle(ang, stepDeg) {
  if (!stepDeg) return ang;
  const st = rad(stepDeg);
  return Math.round(ang / st) * st;
}
export function makeLine(a, b, tan, stepDeg) {
  const v = sub(b, a), L = len(v);
  let ang = Math.atan2(v.y, v.x);
  if (tan && Math.abs(wrapA(ang - Math.atan2(tan.y, tan.x))) < rad(8)) ang = Math.atan2(tan.y, tan.x); // tangent continuation
  else ang = snapAngle(ang, stepDeg);
  return { t: 'L', a: { ...a }, b: P(a.x + Math.cos(ang) * L, a.y + Math.sin(ang) * L) };
}
// Arc through three points.
export function arc3(A, M, B) {
  const bx = M.x - A.x, by = M.y - A.y, cx = B.x - A.x, cy = B.y - A.y;
  const d = 2 * (bx * cy - by * cx); if (Math.abs(d) < 1e-6) return null;
  const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
  const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
  const c = P(A.x + ux, A.y + uy), r = Math.hypot(ux, uy);
  const a0 = Math.atan2(A.y - c.y, A.x - c.x), am = Math.atan2(M.y - c.y, M.x - c.x), a1 = Math.atan2(B.y - c.y, B.x - c.x);
  const d1 = mod(a1 - a0, TAU), dm = mod(am - a0, TAU);
  return { t: 'A', c, r, a0, s: dm < d1 ? d1 : d1 - TAU };
}
// Snap the arc sweep to the nearest 45° (90° and 180° become clean arcs).
export function snapArc(g) {
  const s = Math.abs(g.s), q = Math.PI / 4, tgt = Math.round(s / q) * q;
  if (tgt > 0 && Math.abs(s - tgt) < rad(14)) g.s = Math.sign(g.s) * tgt;
  g.s = Math.sign(g.s) * Math.min(Math.abs(g.s), TAU - 0.02);
  return g;
}
export function arcError(g, raw) { let e = 0; for (const q of raw) e += Math.abs(dist(q, g.c) - g.r); return e / raw.length; }
export function halfPoint(raw) {
  let tot = 0; for (let i = 1; i < raw.length; i++) tot += dist(raw[i], raw[i - 1]);
  let acc = 0; for (let i = 1; i < raw.length; i++) { acc += dist(raw[i], raw[i - 1]); if (acc >= tot / 2) return raw[i]; }
  return raw[raw.length >> 1];
}
// The main one: raw mouse trail → one clean segment (line or arc).
// mode: 'line', 'arc' or null (decide by shape); stepDeg: angle snap for lines.
export function fitSegment(raw, anchor, tan, mode, tol, stepDeg) {
  if (raw.length < 2) return null;
  const end = raw[raw.length - 1], ch = sub(end, anchor), L = len(ch);
  if (L < tol * 2) return null;
  const u = norm(ch); let dev = 0;
  for (const q of raw) dev = Math.max(dev, Math.abs(cross(u, sub(q, anchor))));
  const line = mode === 'line' || (mode !== 'arc' && dev < Math.max(tol, 0.085 * L));
  if (line) return makeLine(anchor, end, tan, stepDeg);
  let g = null;
  if (tan) { g = tangentArc(anchor, tan, end); if (g && arcError(g, raw) > 0.16 * g.r + tol) g = null; }
  if (!g) g = arc3(anchor, halfPoint(raw), end);
  if (!g || g.r > 25 * L) return makeLine(anchor, end, tan, stepDeg);
  return snapArc(g);
}
// Append a segment; a line that continues a line is merged into it.
export function pushSeg(path, g) {
  const prev = path.segs[path.segs.length - 1];
  if (prev && prev.t === 'L' && g.t === 'L') {
    const a = Math.atan2(prev.b.y - prev.a.y, prev.b.x - prev.a.x), b = Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x);
    if (Math.abs(wrapA(a - b)) < rad(0.5)) { prev.b = { ...g.b }; return; }
  }
  delete g.tangent;
  path.segs.push(g);
}
