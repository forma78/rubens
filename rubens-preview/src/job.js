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
//
// mode 'brush' (the owner, 2026-09-28): the brush trace is narrower than a
// lane, so every lane is painted there and back without leaving the canvas —
// up a quarter of the lane to one side of its centre line, a semicircle at
// the top, and down a quarter to the other side; the two trips split the lane
// between them. The return lies on the side of the next lane, so the step to
// it is as wide as the step between the trips. Between lanes, paint.lift still
// decides: the brush leaves the canvas, or turns into the next lane (one line
// for the whole stroke). mode 'pencil' is one trip per lane, as before.

import { PT_MM } from './config.js';
import { dist, clamp } from './util.js';
import { segStart, segEnd, segDirEnd, segLen, segAt, tangentArc } from './geometry.js';
import { cncPlan, reverseSegs } from './cnc.js';
import { offsetSegs } from './fillet.js';

export const MODES = ['pencil', 'brush'];

export function jobSteps(paths, colorsOf, paint, mode = 'pencil') {
  const lift = paint.lift ?? true, brush = mode === 'brush';
  const steps = [];
  let at = null, heading = null;
  // From where the last step ended to `start`: a semicircle with the brush
  // down when `turn` allows it, otherwise the brush off and a travel move.
  const to = (stroke, start, turn) => {
    if (!at || dist(at, start) <= 1e-6) return;
    const arc = turn ? tangentArc(at, heading, start) : null;
    if (arc) { delete arc.tangent; steps.push({ kind: 'turn', stroke, segs: [arc] }); }
    else steps.push({ kind: 'travel', stroke, segs: [{ t: 'L', a: { ...at }, b: { ...start } }] });
  };
  const paintStep = (p, ps, segs, back) => {
    steps.push({ kind: 'paint', stroke: p.id, lane: ps.lane, dir: back ? -ps.dir : ps.dir, color: ps.color, segs,
      pass: back ? { ...ps, drops: [] } : ps, ...(back ? { back: true } : {}) });
    const last = segs[segs.length - 1];
    at = segEnd(last); heading = segDirEnd(last);
  };
  for (const p of paths) {
    if (!p.segs.length) continue;
    // Brush: every lane goes up first, as with the brush off after each pass.
    const plan = cncPlan(p, colorsOf(p), brush ? { ...paint, lift: true } : paint);
    const W = p.style.weight, q = W / 32;          // a quarter of the lane (the lane is W / 8)
    plan.passes.forEach((ps, k) => {
      if (!ps.segs.length) return;
      if (!brush) {
        to(p.id, segStart(ps.segs[0]), !lift && k > 0);
        paintStep(p, ps, ps.segs, false);
        return;
      }
      const o = ((ps.lane - 0.5) / 8 - 0.5) * W;   // the lane's centre line, as in cncPlan
      const up = offsetSegs(plan.axis, o - q), down = offsetSegs(plan.axis, o + q);
      const there = ps.dir > 0 ? up : reverseSegs(up);
      const back = ps.dir > 0 ? reverseSegs(down) : down;
      if (!there.length || !back.length) return;
      to(p.id, segStart(there[0]), !lift && k > 0);
      paintStep(p, ps, there, false);
      to(p.id, segStart(back[0]), true);
      paintStep(p, ps, back, true);
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
export function jobFile(steps, { formatKey, format, paint, mode = 'pencil' }) {
  const mm = v => Math.round(v * PT_MM * 1000) / 1000;
  const pt = q => ({ x: mm(q.x), y: mm(q.y) });
  const seg = g => g.t === 'L'
    ? { t: 'L', a: pt(g.a), b: pt(g.b) }
    : { t: 'A', c: pt(g.c), r: mm(g.r), a0: g.a0, s: g.s };
  return {
    rubens: 'job', version: 1, units: 'mm',
    artboard: { format: formatKey, w: format.w, h: format.h, axes: 'x right, y down, from the top left corner' },
    lift: paint.lift ?? true, mode,
    steps: steps.map(st => {
      const o = { kind: st.kind, stroke: st.stroke, length: mm(lengthPt(st.segs)), segs: st.segs.map(seg) };
      if (st.kind === 'paint') Object.assign(o, {
        lane: st.lane, dir: st.dir > 0 ? 'with' : 'against', color: st.color, ...(st.back ? { back: true } : {}),
        drops: st.pass.drops.map(d => ({ at: pt(d.at), ml: Math.round(st.pass.ml * 1000) / 1000 })),
      });
      return o;
    }),
  };
}
