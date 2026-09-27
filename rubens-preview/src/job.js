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

import { dist } from './util.js';
import { segStart, segEnd, segDirEnd, segLen, tangentArc } from './geometry.js';
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
