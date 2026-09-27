// Rounded corners: one centre line for the brush and for the CNC.
//
// A brush of width W cannot take a sharp kink: the inner passes would cross
// each other. So every kink of the centre line is rounded with an arc of radius
// W/2 + inner radius. All eight passes are then parallel copies of that line:
// lines stay lines, arcs become concentric, nothing crosses anywhere.
// The preview is drawn along the same rounded line — the screen does not lie.
// No DOM here.

import { PT_MM } from './config.js';
import { P, sub, norm, dist, rad, wrapA } from './util.js';
import { segLen, segStart, segEnd, segDirStart, segDirEnd, segAt, tangentArc } from './geometry.js';

const filletCache = new Map();

// p — a stroke {id, segs, style.weight}; cornerRmm — inner corner radius in mm.
// Returns { segs: the rounded centre line, warn: points where it does not fit }.
export function filleted(p, cornerRmm) {
  const W = p.style.weight, rIn = (cornerRmm ?? 10) / PT_MM;
  const key = JSON.stringify([p.segs, W, rIn]);
  const hit = filletCache.get(p.id); if (hit && hit.key === key) return hit.val;
  const src = JSON.parse(JSON.stringify(p.segs)).filter(g => segLen(g) > 1e-6);
  const n = src.length, want = W / 2 + rIn;
  const warn = [];
  // 1. the kink at every joint and the trim length it wants
  const J = [];
  for (let i = 0; i < n - 1; i++) {
    const d0 = segDirEnd(src[i]), d1 = segDirStart(src[i + 1]);
    const th = wrapA(Math.atan2(d1.y, d1.x) - Math.atan2(d0.y, d0.x));
    if (Math.abs(th) < rad(0.5)) { J.push(null); continue; }
    const tn = Math.tan(Math.min(Math.abs(th), rad(179)) / 2);
    J.push({ th, tn, t: want * tn });
  }
  // 2. a trim may not be longer than its segment: if both ends are trimmed, share it proportionally
  const trimA = new Array(n).fill(0), trimB = new Array(n).fill(0);
  J.forEach((j, i) => { if (j) { trimB[i] = j.t; trimA[i + 1] = j.t; } });
  const scale = src.map((g, i) => { const L = segLen(g), need = trimA[i] + trimB[i]; return need > L ? L / need : 1; });
  J.forEach((j, i) => {
    if (!j) return;
    j.t *= Math.min(scale[i], scale[i + 1]);
    j.R = j.t / j.tn;
    trimB[i] = j.t; trimA[i + 1] = j.t;
    if (j.R < W / 2 - 1e-3) warn.push(segEnd(src[i]));            // corner too tight for this width
  });
  // 3. trim the segments
  const cut = src.map((g, i) => {
    const a = trimA[i], b = trimB[i];
    if (g.t === 'L') { const u = norm(sub(g.b, g.a)); return { t: 'L', a: P(g.a.x + u.x * a, g.a.y + u.y * a), b: P(g.b.x - u.x * b, g.b.y - u.y * b) }; }
    const sg = Math.sign(g.s);
    return { t: 'A', c: g.c, r: g.r, a0: g.a0 + sg * a / g.r, s: g.s - sg * (a + b) / g.r };
  });
  // arcs of the drawing itself that are already smaller than W/2
  src.forEach(g => { if (g.t === 'A' && g.r < W / 2 - 1e-3) warn.push(segAt(g, segLen(g) / 2)); });
  // 4. assemble the centre line: segment, rounding, segment…
  const out = [];
  cut.forEach((g, i) => {
    if (segLen(g) > 1e-4) out.push(g);
    const j = J[i]; if (!j) return;
    const P0 = segEnd(g), P1 = segStart(cut[i + 1]);
    const f = tangentArc(P0, segDirEnd(src[i]), P1);
    if (f && isFinite(f.r) && f.r > 1e-3) { delete f.tangent; out.push(f); }
    else if (dist(P0, P1) > 1e-4) out.push({ t: 'L', a: P0, b: P1 });
  });
  const val = { segs: out, warn };
  filletCache.set(p.id, { key, val });
  return val;
}

// A parallel copy of the centre line at distance off (plus = to the right of travel).
//
// Where the copy of a corner does not fit — the arc collapses on the inner side
// of a corner too tight for the width, or a kink under 0.5° was not rounded —
// the neighbouring pieces overlap. They are cut where they cross, so the pass
// comes to a sharp point, like an offset path in Illustrator. A straight
// bridge there would run backwards and cross the other passes. Only a real gap
// (the outer side of an unrounded kink) is bridged with a straight line.
export function offsetSegs(segs, off) {
  const out = [];
  for (const g of segs) {
    let h;
    if (g.t === 'L') { const u = norm(sub(g.b, g.a)); h = { t: 'L', a: P(g.a.x - u.y * off, g.a.y + u.x * off), b: P(g.b.x - u.y * off, g.b.y + u.x * off) }; }
    else {
      const r = g.r - Math.sign(g.s) * off;          // right turn (s > 0): the centre is on the right, the radius shrinks
      if (r < 0.5) continue;                          // the arc collapsed — its neighbours meet below
      h = { t: 'A', c: g.c, r, a0: g.a0, s: g.s };
    }
    const prev = out[out.length - 1];
    if (prev && dist(segEnd(prev), segStart(h)) > 0.05) {
      const x = meetPoint(prev, h);
      if (x) { trimEnd(prev, x); trimStart(h, x); }
      else out.push({ t: 'L', a: segEnd(prev), b: segStart(h) });
    }
    out.push(h);
  }
  return out;
}

// ---------- where two pieces of a pass cross ----------
// Position of point q along a piece: 0 at its start, 1 at its end.
function along(g, q) {
  if (g.t === 'L') { const d = sub(g.b, g.a), L2 = d.x * d.x + d.y * d.y || 1; return ((q.x - g.a.x) * d.x + (q.y - g.a.y) * d.y) / L2; }
  const sg = Math.sign(g.s) || 1, ang = Math.atan2(q.y - g.c.y, q.x - g.c.x);
  let d = sg * (ang - g.a0); d -= Math.floor(d / (2 * Math.PI)) * 2 * Math.PI;   // 0 … 2π along the sweep
  if (d > Math.abs(g.s) + 1e-9 && d > Math.PI + Math.abs(g.s) / 2) d -= 2 * Math.PI; // just before the start
  return d / Math.abs(g.s);
}
// Points where the full lines / circles of two pieces cross.
function crossPoints(a, b) {
  if (a.t === 'L' && b.t === 'L') {
    const r = sub(a.b, a.a), s = sub(b.b, b.a), den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-12) return [];
    const t = ((b.a.x - a.a.x) * s.y - (b.a.y - a.a.y) * s.x) / den;
    return [P(a.a.x + r.x * t, a.a.y + r.y * t)];
  }
  if (a.t === 'A' && b.t === 'L') return crossPoints(b, a);
  if (a.t === 'L') {                                   // line and circle
    const d = sub(a.b, a.a), f = sub(a.a, b.c);
    const A = d.x * d.x + d.y * d.y, B = 2 * (f.x * d.x + f.y * d.y), C = f.x * f.x + f.y * f.y - b.r * b.r;
    const disc = B * B - 4 * A * C; if (disc < 0 || !A) return [];
    return [-1, 1].map(k => (-B + k * Math.sqrt(disc)) / (2 * A)).map(t => P(a.a.x + d.x * t, a.a.y + d.y * t));
  }
  const d = dist(a.c, b.c);                           // two circles
  if (d < 1e-9 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return [];
  const m = (d * d + a.r * a.r - b.r * b.r) / (2 * d), hh = Math.sqrt(Math.max(0, a.r * a.r - m * m));
  const u = P((b.c.x - a.c.x) / d, (b.c.y - a.c.y) / d), mid = P(a.c.x + u.x * m, a.c.y + u.y * m);
  return [P(mid.x - u.y * hh, mid.y + u.x * hh), P(mid.x + u.y * hh, mid.y - u.x * hh)];
}
// The crossing of prev and next nearest to where one ends and the other starts.
function meetPoint(prev, next) {
  let best = null, bestCost = Infinity;
  for (const q of crossPoints(prev, next)) {
    const tp = along(prev, q), tn = along(next, q);
    if (tp < -1e-9 || tp > 1 + 1e-9 || tn < -1e-9 || tn > 1 + 1e-9) continue;
    const cost = (1 - tp) * segLen(prev) + tn * segLen(next);
    if (cost < bestCost) { bestCost = cost; best = q; }
  }
  return best;
}
function trimEnd(g, q) {
  if (g.t === 'L') { g.b = q; return; }
  g.s = Math.sign(g.s) * Math.max(0, along(g, q)) * Math.abs(g.s);
}
function trimStart(g, q) {
  if (g.t === 'L') { g.a = q; return; }
  const t = Math.max(0, along(g, q)), a1 = g.a0 + g.s;
  g.a0 += g.s * t; g.s = a1 - g.a0;
}
