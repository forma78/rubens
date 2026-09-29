// The job: every pass of every stroke in the order the machine runs them,
// with the moves in between (Rubens_v2.md, section 4.5). No DOM here.
//
// Steps:
//   { kind: 'paint',  stroke, lane, dir, color, segs, pass } — a pass, brush on the canvas
//   { kind: 'travel', stroke, segs } — brush off the canvas, a straight move to the next start
//   { kind: 'turn',   stroke, segs } — brush down to the next trip or lane: a semicircle in
//                                      the Pencil snake, a straight step across in Brush
//
// Strokes go in drawing order, passes 1 → 8 within a stroke. With paint.lift
// on, every pass is followed by the brush leaving the canvas and a travel
// move. With it off, the passes of one stroke are joined by semicircles with a
// diameter equal to the distance between the lanes (the pass pitch for
// neighbouring lanes); between strokes the brush still leaves the canvas.
// The first step is a paint step: getting to its start is the runner's job.
//
// mode 'brush' (the owner, 2026-09-28): the brush trace is narrower than a
// lane, so every lane is painted in `perLane` trips without leaving the
// canvas — up, down, up… — a lane / perLane apart, spread evenly about the
// lane's centre line. perLane is even, so a lane ends at the bottom, where
// the next one starts, as far away as the trips are from each other. 2 trips
// was the first canvas: 11 mm apart on a 500 pt stroke, and the round No. 4
// left canvas between them; 4 trips is the owner's answer. 8 trips (the
// owner, 2026-09-29, after a day of tests): the same lane, twice as dense —
// 2.75 mm apart on a 500 pt stroke.
//
// In Brush the brush never leaves the canvas within a stroke: all its trips,
// 16, 32 or 64, are one line, whatever paint.lift says (the owner,
// 2026-09-29: continuous trips look better, and every lift swept the wet
// brush across the canvas). A trip ends, a straight step across to the next
// one, and straight back — no semicircle: the tests showed that a round brush
// with long enough bristles needs none (the owner, 2026-09-29; the
// semicircles were designed before any paint). mode 'pencil' is one trip per
// lane, as before, and paint.lift decides between its passes.

import { PT_MM } from './config.js';
import { dist, clamp } from './util.js';
import { segStart, segEnd, segDirEnd, segLen, segAt, tangentArc } from './geometry.js';
import { cncPlan, reverseSegs } from './cnc.js';
import { offsetSegs } from './fillet.js';

export const MODES = ['pencil', 'brush'];
export const PER_LANE = [2, 4, 8];

export function jobSteps(paths, colorsOf, paint, mode = 'pencil', perLane = 2) {
  const lift = paint.lift ?? true, brush = mode === 'brush';
  const n = Math.max(2, 2 * Math.round(perLane / 2));   // trips per lane, even
  const steps = [];
  let at = null, heading = null, painting = null;   // painting: the stroke of the last paint step
  // From where the last step ended to `start`, with the brush down when `turn`
  // allows it — a straight step in Brush, a semicircle in Pencil — otherwise
  // the brush off and a travel move.
  const to = (stroke, start, turn) => {
    if (!at || dist(at, start) <= 1e-6) return;
    const line = [{ t: 'L', a: { ...at }, b: { ...start } }];
    if (turn && brush) { steps.push({ kind: 'turn', stroke, segs: line }); return; }
    const arc = turn ? tangentArc(at, heading, start) : null;
    if (arc) { delete arc.tangent; steps.push({ kind: 'turn', stroke, segs: [arc] }); }
    else steps.push({ kind: 'travel', stroke, segs: line });
  };
  // trip t of a lane: even trips go up the picture, odd ones come back down;
  // the drops are where a lane starts, at its first trip
  const paintStep = (p, ps, segs, t) => {
    const back = t % 2 === 1;
    steps.push({ kind: 'paint', stroke: p.id, lane: ps.lane, dir: back ? -ps.dir : ps.dir, color: ps.color, segs,
      pass: t > 0 ? { ...ps, drops: [] } : ps, trip: t, ...(back ? { back: true } : {}) });
    const last = segs[segs.length - 1];
    at = segEnd(last); heading = segDirEnd(last); painting = p.id;
  };
  for (const p of paths) {
    if (!p.segs.length) continue;
    // Brush: every lane goes up first, as with the brush off after each pass.
    const plan = cncPlan(p, colorsOf(p), brush ? { ...paint, lift: true } : paint);
    const W = p.style.weight, pitch = W / 8 / n;   // between trips (the lane is W / 8)
    plan.passes.forEach(ps => {
      if (!ps.segs.length) return;
      if (!brush) {
        to(p.id, segStart(ps.segs[0]), !lift && painting === p.id);
        paintStep(p, ps, ps.segs, 0);
        return;
      }
      const o = ((ps.lane - 0.5) / 8 - 0.5) * W;   // the lane's centre line, as in cncPlan
      const trips = Array.from({ length: n }, (_, t) => {
        const along = offsetSegs(plan.axis, o + (t - (n - 1) / 2) * pitch);
        return (t % 2 === 0) === (ps.dir > 0) ? along : reverseSegs(along);   // up, down, up…
      });
      if (trips.some(s => !s.length)) return;
      trips.forEach((segs, t) => {
        to(p.id, segStart(segs[0]), painting === p.id);   // off the canvas only between strokes
        paintStep(p, ps, segs, t);
      });
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
// it and back after it (J3, 54° at about 53°/s ≈ 1 s; 90° and 1.7 s until
// the camera, 2026-09-30).
export const TIME_MODEL = { paintMMs: 20, travelMMs: 100, swingS: 1.0 };

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

// The time on the clock at which `percent` of the painted length is done:
// where a running machine is in the plan, from the runner's percent.
export function timeAtPercent(tl, percent) {
  const want = clamp(percent, 0, 100) / 100 * tl.paintMM;
  for (const row of tl.rows) {
    if (row.step.kind !== 'paint') continue;
    if (want <= row.painted0 + row.Lmm) return row.t0 + (row.Lmm ? (want - row.painted0) / row.Lmm : 0) * row.dur;
  }
  return tl.total;
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
export function jobFile(steps, { formatKey, format, paint, mode = 'pencil', perLane }) {
  const mm = v => Math.round(v * PT_MM * 1000) / 1000;
  const pt = q => ({ x: mm(q.x), y: mm(q.y) });
  const seg = g => g.t === 'L'
    ? { t: 'L', a: pt(g.a), b: pt(g.b) }
    : { t: 'A', c: pt(g.c), r: mm(g.r), a0: g.a0, s: g.s };
  return {
    rubens: 'job', version: 1, units: 'mm',
    artboard: { format: formatKey, w: format.w, h: format.h, axes: 'x right, y down, from the top left corner' },
    lift: paint.lift ?? true, mode, ...(mode === 'brush' && perLane ? { perLane } : {}),
    steps: steps.map(st => {
      const o = { kind: st.kind, stroke: st.stroke, length: mm(lengthPt(st.segs)), segs: st.segs.map(seg) };
      if (st.kind === 'paint') Object.assign(o, {
        lane: st.lane, dir: st.dir > 0 ? 'with' : 'against', color: st.color, trip: st.trip ?? 0, ...(st.back ? { back: true } : {}),
        drops: st.pass.drops.map(d => ({ at: pt(d.at), ml: Math.round(st.pass.ml * 1000) / 1000 })),
      });
      return o;
    }),
  };
}
