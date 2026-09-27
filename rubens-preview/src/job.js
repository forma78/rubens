// The job: every pass of every stroke in the order the machine runs them,
// with the moves in between (Rubens_v2.md, section 4.5). No DOM here.
//
// Steps:
//   { kind: 'paint',  stroke, lane, dir, color, segs, pass } — a pass, brush on the canvas
//   { kind: 'travel', stroke, segs } — brush off the canvas, a straight move to the next start
//   { kind: 'turn',   stroke, segs } — snake only: a semicircle to the next lane, brush down
//
// Strokes go in drawing order, passes 1 → 8 within a stroke. With paint.lift
// on, every pass is followed by the brush leaving the canvas and a travel
// move. With it off, the passes of one stroke are joined by semicircles with a
// diameter equal to the distance between the lanes (the pass pitch for
// neighbouring lanes); between strokes the brush still leaves the canvas.
// The first step is a paint step: getting to its start is the runner's job.

import { PT_MM } from './config.js';
import { dist, clamp } from './util.js';
import { segStart, segEnd, segDirEnd, segLen, segAt, tangentArc } from './geometry.js';
import { cncPlan } from './cnc.js';

export function jobSteps(paths, colorsOf, paint) {
  const lift = paint.lift ?? true;
  const steps = [];
  let at = null, heading = null;
  for (const p of paths) {
    if (!p.segs.length) continue;
    const plan = cncPlan(p, colorsOf(p), paint);
    plan.passes.forEach((ps, k) => {
      if (!ps.segs.length) return;
      const start = segStart(ps.segs[0]);
      if (at && dist(at, start) > 1e-6) {
        const arc = !lift && k > 0 ? tangentArc(at, heading, start) : null;
        if (arc) { delete arc.tangent; steps.push({ kind: 'turn', stroke: p.id, segs: [arc] }); }
        else steps.push({ kind: 'travel', stroke: p.id, segs: [{ t: 'L', a: { ...at }, b: { ...start } }] });
      }
      steps.push({ kind: 'paint', stroke: p.id, lane: ps.lane, dir: ps.dir, color: ps.color, segs: ps.segs, pass: ps });
      const last = ps.segs[ps.segs.length - 1];
      at = segEnd(last); heading = segDirEnd(last);
    });
  }
  return steps;
}

// Lengths in the document units (pt): what is painted, what is travelled.
export function jobLengths(steps) {
  let paint = 0, travel = 0;
  for (const st of steps) {
    const L = st.segs.reduce((a, g) => a + segLen(g), 0);
    if (st.kind === 'travel') travel += L; else paint += L;
  }
  return { paint, travel };
}

// ---------- the job on a clock ----------
// A time model in mm/s and s. The numbers are estimates until the first run
// (Rubens_v2.md, section 8): paint and turns at the pass speed; a travel move
// at the travel speed, plus the wrist swinging the brush off the canvas before
// it and back after it (J3, 90° at about 53°/s ≈ 1.7 s).
export const TIME_MODEL = { paintMMs: 20, travelMMs: 100, swingS: 1.7 };

const lengthPt = segs => segs.reduce((a, g) => a + segLen(g), 0);

// Every step with its length (mm), how long it takes (s) and when it starts,
// and the painted length before it — the percent is by painted length.
export function jobTimeline(steps, model = TIME_MODEL) {
  let t = 0, painted = 0;
  const rows = steps.map(st => {
    const Lmm = lengthPt(st.segs) * PT_MM;
    const dur = st.kind === 'travel' ? Lmm / model.travelMMs + 2 * model.swingS : Lmm / model.paintMMs;
    const row = { step: st, Lmm, t0: t, dur, painted0: painted };
    t += dur;
    if (st.kind === 'paint') painted += Lmm;
    return row;
  });
  return { rows, total: t, paintMM: painted, model };
}

// A point `d` document units along a chain of segments.
export function pointAlong(segs, d) {
  for (const g of segs) {
    const L = segLen(g);
    if (d <= L) return segAt(g, Math.max(0, d));
    d -= L;
  }
  const g = segs[segs.length - 1];
  return segAt(g, segLen(g));
}

// Where the job is at time t (s): the step, how far along it (0…1), the brush
// point (document units), whether the brush is off the canvas, the percent
// painted and the seconds left. On a travel move the brush swings off first,
// moves, and swings back at the end.
export function jobAt(tl, t) {
  if (!tl.rows.length) return null;
  t = clamp(t, 0, tl.total);
  let lo = 0, hi = tl.rows.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tl.rows[m].t0 <= t) lo = m; else hi = m - 1; }
  const row = tl.rows[lo], st = row.step, local = t - row.t0;
  let frac;
  if (st.kind === 'travel') {
    const move = row.dur - 2 * tl.model.swingS;
    frac = move > 0 ? clamp((local - tl.model.swingS) / move, 0, 1) : 1;
  } else frac = row.dur > 0 ? clamp(local / row.dur, 0, 1) : 1;
  const q = pointAlong(st.segs, frac * lengthPt(st.segs));
  const painted = row.painted0 + (st.kind === 'paint' ? frac * row.Lmm : 0);
  return {
    i: lo, frac, x: q.x, y: q.y, kind: st.kind, off: st.kind === 'travel',
    percent: tl.paintMM ? painted / tl.paintMM * 100 : 100, left: tl.total - t,
  };
}

// The job for the machine (Rubens_v2.md, section 5): mm, every step in the
// order it runs. Coordinates are on the artboard — x to the right, y down from
// its top left corner; where the artboard lies on the machine comes from the
// calibration at run time, not from this file.
export function jobFile(steps, { formatKey, format, paint }) {
  const mm = v => Math.round(v * PT_MM * 1000) / 1000;
  const pt = q => ({ x: mm(q.x), y: mm(q.y) });
  const seg = g => g.t === 'L'
    ? { t: 'L', a: pt(g.a), b: pt(g.b) }
    : { t: 'A', c: pt(g.c), r: mm(g.r), a0: g.a0, s: g.s };
  return {
    rubens: 'job', version: 1, units: 'mm',
    artboard: { format: formatKey, w: format.w, h: format.h, axes: 'x right, y down, from the top left corner' },
    lift: paint.lift ?? true,
    steps: steps.map(st => {
      const o = { kind: st.kind, stroke: st.stroke, length: mm(lengthPt(st.segs)), segs: st.segs.map(seg) };
      if (st.kind === 'paint') Object.assign(o, {
        lane: st.lane, dir: st.dir > 0 ? 'with' : 'against', color: st.color,
        drops: st.pass.drops.map(d => ({ at: pt(d.at), ml: Math.round(st.pass.ml * 1000) / 1000 })),
      });
      return o;
    }),
  };
}
