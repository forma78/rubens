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
export function offsetSegs(segs, off) {
  const out = [];
  for (const g of segs) {
    let h;
    if (g.t === 'L') { const u = norm(sub(g.b, g.a)); h = { t: 'L', a: P(g.a.x - u.y * off, g.a.y + u.x * off), b: P(g.b.x - u.y * off, g.b.y + u.x * off) }; }
    else {
      const r = g.r - Math.sign(g.s) * off;          // right turn (s > 0): the centre is on the right, the radius shrinks
      if (r < 0.5) continue;                          // the arc collapsed — the bridge below joins the neighbours
      h = { t: 'A', c: g.c, r, a0: g.a0, s: g.s };
    }
    const prev = out[out.length - 1];
    if (prev && dist(segEnd(prev), segStart(h)) > 0.05) out.push({ t: 'L', a: segEnd(prev), b: segStart(h) });
    out.push(h);
  }
  return out;
}
