// CNC Trace: the eight brush passes of a stroke, and the SVG for the machine.
//
// The line on screen is eight CNC passes of one brush. Pass i runs parallel to
// the centre line at ((i + 0.5)/8 − 0.5) × trace width; the pitch between
// passes is stroke / 8 (96 mm = 272 pt for a 12 mm brush). Pass 1 is the left
// edge looking along the drawing direction, as in the preview. Passes are
// parallel copies of the rounded centre line (fillet.js), so they never cross;
// where a corner is too tight for the rounding, the inner passes meet in a point.
// No DOM here.

import { PT_MM } from './config.js';
import { P, dist, fmt } from './util.js';
import { samplePath, pathD, r3 } from './geometry.js';
import { filleted, offsetSegs } from './fillet.js';

export function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i], pts[i - 1]); return L; }
export function polyAt(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i], pts[i - 1]);
    if (acc + d >= s) { const t = d ? (s - acc) / d : 0; return P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t); }
    acc += d;
  }
  return pts[pts.length - 1];
}

// The plan for one stroke: passes, their length, how many drops and where to
// squeeze them. colors — the eight drops (null = empty slot, no pass);
// paint — see paint.js.
const cncCache = new Map();
export function cncPlan(p, colors, paint) {
  const cols = colors;
  const key = JSON.stringify([p.segs, p.style, cols, paint]);
  const hit = cncCache.get(p.id); if (hit && hit.key === key) return hit.plan;
  const W = p.style.weight, pitchMM = W * PT_MM / 8, k = paint;
  const perMM = pitchMM * k.film * (1 + k.retention / 100) / 1000;   // ml per mm of pass
  const F = filleted(p, paint.cornerR), axis = F.segs;
  const passes = [];
  for (let i = 0; i < 8; i++) {
    if (!cols[i]) continue;                                            // empty slot — no pass
    const segs = offsetSegs(axis, ((i + 0.5) / 8 - 0.5) * W);
    const pts = samplePath({ segs }, 1 / PT_MM).filter(q => !q.fan).map(q => P(q.x, q.y));
    const Lmm = polyLen(pts) * PT_MM, need = Lmm * perMM;
    let n, ml;
    if (p.style.load === 'manual') { ml = Math.max(0.001, +p.style.ml || 0); n = Math.max(1, Math.ceil(need / ml)); }
    else { n = Math.max(1, Math.ceil(need / Math.max(0.01, k.maxDrop))); ml = need / n; }
    const spacing = polyLen(pts) / n;
    const drops = Array.from({ length: n }, (_, j) => ({ at: polyAt(pts, j * spacing), s: j * spacing }));
    passes.push({ lane: i + 1, color: cols[i], segs, pts, Lmm, need, n, ml, drops });
  }
  const plan = { passes, pitchMM, axis, warn: F.warn };
  cncCache.set(p.id, { key, plan });
  return plan;
}

// The SVG for the machine: passes in order plus drop marks for a pencil.
// A machine line is just a path: black, 1 mm, like a pencil trace. The pass
// colour stays only as a reference in data-color.
// format — a FORMATS entry; colorsOf(p) and paletteNameOf(p) come from the page.
const PEN_PT = Math.round(1000 / PT_MM) / 1000;   // 1 mm in pt
export function cncSvg({ format, paths, colorsOf, paletteNameOf, paint }) {
  const W = format.w / PT_MM, H = format.h / PT_MM;
  const drawn = paths.filter(p => p.segs.length);
  const circ = (q, r) => `M${r3(q.x - r)} ${r3(q.y)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(q.x + r)} ${r3(q.y)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(q.x - r)} ${r3(q.y)}`;
  let body = '', marks = '', nPass = 0, total = 0;
  drawn.forEach((p, si) => {
    const plan = cncPlan(p, colorsOf(p), paint), sid = `stroke-${String(si + 1).padStart(2, '0')}`;
    body += `<g id="${sid}" data-palette="${paletteNameOf(p)}" data-brush="${p.style.brush}" data-pitch-mm="${fmt(plan.pitchMM, 2)}">\n`;
    for (const ps of plan.passes) {
      nPass++; total += ps.Lmm;
      body += `  <path id="${sid}-pass-${ps.lane}" data-lane="${ps.lane}" data-color="${ps.color}" data-length-mm="${fmt(ps.Lmm, 1)}" data-drops="${ps.n}" data-drop-ml="${fmt(ps.ml, 3)}" d="${pathD({ segs: ps.segs })}" fill="none" stroke="#000000" stroke-width="${PEN_PT}" stroke-linecap="round" stroke-linejoin="round"/>\n`;
      ps.drops.forEach((d, j) => {
        marks += `  <path id="${sid}-pass-${ps.lane}-drop-${j + 1}" data-lane="${ps.lane}" data-color="${ps.color}" data-ml="${fmt(ps.ml, 3)}" data-at-mm="${fmt(d.s * PT_MM, 1)}" d="${circ(d.at, 3 / PT_MM)}" fill="none" stroke="#000000" stroke-width="${PEN_PT}"/>\n`;
      });
    }
    body += `</g>\n`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${format.w}mm" height="${format.h}mm" viewBox="0 0 ${r3(W)} ${r3(H)}">
<!-- RUBENS CNC Trace v0.1 · ${format.label}
     1 user unit = 1 pt = ${PT_MM.toFixed(5)} mm.
     group "passes": ${nPass} brush passes, ${fmt(total / 1000, 2)} m in total. Each stroke = up to 8 passes,
       lane 1 → 8, all in the drawing direction. Pass i is offset from the centre line by
       ((i + 0.5) / 8 − 0.5) × stroke width. Empty palette slots have no pass.
     group "drop-marks": Ø 6 mm circles where paint is squeezed before the brush pass
       (data-ml = how much). Run "drop-marks" with a pencil first, or the passes too as a pencil guide.
     All lines are black, 1 mm wide (pencil); colour is only in data-color, for reference.
     Geometry: M, L and A only. Passes are exact parallel copies of the centre line;
       every corner of the drawing is rounded (inner radius ${fmt(paint.cornerR ?? 10, 0)} mm) so passes never cross. -->
<g id="passes">
${body}</g>
<g id="drop-marks">
${marks}</g>
</svg>
`;
}
