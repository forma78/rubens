// Segment geometry. A path is a list of segments, straight lines and circular
// arcs only — no Béziers anywhere:
//   L: {t:'L', a, b}
//   A: {t:'A', c, r, a0, s} — centre, radius, start angle, sweep (signed).
// Angles grow clockwise on screen (y points down); that is sweep-flag = 1 in SVG.
// No DOM here.

import { P, sub, add, len, dot, cross, norm, dist, mod, TAU, wrapA } from './util.js';

export const segStart = g => g.t === 'L' ? g.a : P(g.c.x + g.r * Math.cos(g.a0), g.c.y + g.r * Math.sin(g.a0));
export const segEnd = g => g.t === 'L' ? g.b : P(g.c.x + g.r * Math.cos(g.a0 + g.s), g.c.y + g.r * Math.sin(g.a0 + g.s));
export const segLen = g => g.t === 'L' ? dist(g.a, g.b) : Math.abs(g.s) * g.r;
export const arcDir = (g, th) => { const k = Math.sign(g.s) || 1; return P(-Math.sin(th) * k, Math.cos(th) * k); };
export const segDirStart = g => g.t === 'L' ? norm(sub(g.b, g.a)) : arcDir(g, g.a0);
export const segDirEnd = g => g.t === 'L' ? norm(sub(g.b, g.a)) : arcDir(g, g.a0 + g.s);
export function segAt(g, d) {
  if (g.t === 'L') { const u = norm(sub(g.b, g.a)); return { x: g.a.x + u.x * d, y: g.a.y + u.y * d, dx: u.x, dy: u.y }; }
  const L = segLen(g) || 1, th = g.a0 + g.s * (d / L), t = arcDir(g, th);
  return { x: g.c.x + g.r * Math.cos(th), y: g.c.y + g.r * Math.sin(th), dx: t.x, dy: t.y };
}
export const pathLen = p => p.segs.reduce((a, g) => a + segLen(g), 0);
export function moveSeg(g, d) { if (g.t === 'L') { g.a = add(g.a, d); g.b = add(g.b, d); } else g.c = add(g.c, d); }

// Points along the path every h units. At a kink — a "fan": the brush turns on the spot.
export function samplePath(p, h) {
  const out = []; let s0 = 0, lastDir = null;
  for (const g of p.segs) {
    const L = segLen(g); if (L < 1e-6) continue;
    const d1 = segDirStart(g);
    if (lastDir) {
      const a0 = Math.atan2(lastDir.y, lastDir.x);
      const da = wrapA(Math.atan2(d1.y, d1.x) - a0);
      if (Math.abs(da) > 0.003) { const q = segStart(g); out.push({ fan: true, x: q.x, y: q.y, a0, da, s: s0 }); }
    }
    const n = Math.max(1, Math.ceil(L / h));
    for (let k = out.length ? 1 : 0; k <= n; k++) { const q = segAt(g, L * k / n); q.s = s0 + L * k / n; out.push(q); }
    s0 += L; lastDir = segDirEnd(g);
  }
  return out;
}

// Arc from point a with tangent tan, through point b. The circle is unique.
export function tangentArc(a, tan, b) {
  const d = sub(b, a), n = P(-tan.y, tan.x);
  const dn = dot(d, n); if (Math.abs(dn) < 1e-6) return null;
  const rs = dot(d, d) / (2 * dn);
  const c = P(a.x + n.x * rs, a.y + n.y * rs), r = Math.abs(rs);
  const a0 = Math.atan2(a.y - c.y, a.x - c.x), a1 = Math.atan2(b.y - c.y, b.x - c.x);
  const dirPos = cross(sub(a, c), tan) > 0;
  const s = dirPos ? mod(a1 - a0, TAU) : -mod(a0 - a1, TAU);
  return { t: 'A', c, r, a0, s, tangent: true };
}

// ---------- anchor editing ----------
// Anchor i: 0 is the start of the first segment, i is the end of segment i-1.
// A line simply follows its anchor. An arc keeps its sweep: a semicircle stays a
// semicircle, only its radius and rotation change. Tangency with the neighbours
// may break — that joint is drawn as the brush turning on the spot.
export const anchorsOf = p => p.segs.length ? [segStart(p.segs[0]), ...p.segs.map(segEnd)] : [];
export function rebuildArc(g, A, B, side) {
  const c = sub(B, A), L = len(c); if (L < 1e-6) return;
  const hs = Math.abs(g.s) / 2, r = L / 2 / Math.sin(hs);
  const n = P(-c.y / L, c.x / L), d = r * Math.cos(hs);   // cos < 0 for arcs over 180°: the centre crosses to the other side by itself
  const C = P((A.x + B.x) / 2 + n.x * d * side, (A.y + B.y) / 2 + n.y * d * side);
  g.c = C; g.r = r; g.a0 = Math.atan2(A.y - C.y, A.x - C.x);
}
// Move the selected anchors by delta from the original state (no accumulating error).
export function applyAnchorMove(p, orig, idx, delta) {
  const moved = new Set(idx);
  const origPts = anchorsOf({ segs: orig });
  p.segs = orig.map((g0, j) => {
    const g = JSON.parse(JSON.stringify(g0));
    const ma = moved.has(j), mb = moved.has(j + 1);
    if (!ma && !mb) return g;
    if (ma && mb) { moveSeg(g, delta); return g; }
    const A = ma ? add(origPts[j], delta) : origPts[j];
    const B = mb ? add(origPts[j + 1], delta) : origPts[j + 1];
    if (g.t === 'L') { g.a = A; g.b = B; return g; }
    const ch = sub(origPts[j + 1], origPts[j]);
    // which side of the chord the centre was on, counted as for a small arc
    const side = Math.sign(cross(ch, sub(g0.c, origPts[j]))) * (Math.abs(g0.s) > Math.PI ? -1 : 1) || 1;
    rebuildArc(g, A, B, side);
    return g;
  });
}

// ---------- segments → SVG path data ----------
export const r3 = v => Math.round(v * 1000) / 1000;
export function pathD(p) {
  let d = '', first = true;
  for (const g of p.segs) {
    const a = segStart(g);
    if (first) { d += `M${r3(a.x)} ${r3(a.y)}`; first = false; }
    if (g.t === 'L') d += ` L${r3(g.b.x)} ${r3(g.b.y)}`;
    else {
      // arcs over 180° are split in two — safer for any parser
      const parts = Math.abs(g.s) > Math.PI ? 2 : 1;
      for (let i = 1; i <= parts; i++) {
        const th = g.a0 + g.s * i / parts;
        d += ` A${r3(g.r)} ${r3(g.r)} 0 0 ${g.s > 0 ? 1 : 0} ${r3(g.c.x + g.r * Math.cos(th))} ${r3(g.c.y + g.r * Math.sin(th))}`;
      }
    }
  }
  return d;
}
