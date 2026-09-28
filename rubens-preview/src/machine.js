// The machine as the Calibration page sees it: axes, stops, walls, and the
// canvas measured on it. The numbers mirror the firmware
// (RAIL-drawing_machine, src/main.cpp): change them together. No DOM here.
//
// Machine coordinates are the carriage position in mm from each axis zero.
// X runs along the long side of the frame, from the bottom of the picture
// (minus) to the top (plus). Y runs across it, from the left stop (zero) to
// the right (plus), looking from the bottom of the picture. While the arm
// holds its pose the tip moves one to one with the carriage, so the canvas is
// measured in the same coordinates: bring the tip to a corner, record the
// carriage position.

export const STEPS_PER_MM = { x: 80, y: 3200 / 120 };   // X: 20-tooth pulley, Y: 60-tooth
export const LEVEL_MAX = { x: 20, y: 9 };               // pendant levels, 10 mm/s each

// Zero is where the walls are, and the reserve up to each stop is minus —
// like the reserve in a fuel tank (the owner's decision, 2026-09-27).
// Home is the bottom left corner: both axes to their stops on level 1,
// stopped at the first sound; there X is set to −9.45 mm and Y to −8.3 mm,
// where the stops were marked when zero was taken at the walls.
export const HOME_STEPS = { x: -756, y: -222 };

// In mm. null — not measured yet. Measured 2026-09-27: X travel on the
// left 870 mm, Y travel 586.9 mm (the right stop: ping 590.55 minus five
// knocks at the stop, 2.4 mm each).
export const STOPS = { x: { min: -9.45, max: 870 }, y: { min: -8.3, max: 578.55 } };
export const WALLS = {
  x: { min: 0, max: 69200 / 80, checked: { min: true, max: true } },    // top: 5 mm under the stop at 870
  y: { min: 0, max: 15160 / (3200 / 120), checked: { min: true, max: true } },
};

export const toMm = (axis, steps) => steps / STEPS_PER_MM[axis];

// "ok P X <steps>[ край] Y <steps>[ край]" → { x, y, edgeX, edgeY };
// x or y is null when that axis has no zero ("?"). null if not a ping reply.
export function parsePing(t) {
  const m = /^ok P X (\S+)( край)? Y (\S+)( край)?/.exec(t || '');
  if (!m) return null;
  const num = s => (s === '?' ? null : Number(s));
  const x = num(m[1]), y = num(m[3]);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return { x, y, edgeX: !!m[2], edgeY: !!m[4] };
}

// ---------- the canvas ----------
// Corners are named from the picture: tl, tr, br, bl. A record is where the
// tip stood (machine mm) plus an optional ruler offset for a corner the tip
// cannot reach: the corner is `up` mm above and `right` mm to the right of it.
export const CORNERS = ['tl', 'tr', 'br', 'bl'];
export function cornerAt(rec) {
  if (!rec) return null;
  return { x: rec.x + (+rec.up || 0), y: rec.y + (+rec.right || 0) };
}

// Where each corner sits on the artboard, in mm: u to the right, v down
// from the top left corner — the same way the Create tab draws.
export function artboardCorner(name, w, h) {
  return { tl: { u: 0, v: 0 }, tr: { u: w, v: 0 }, br: { u: w, v: h }, bl: { u: 0, v: h } }[name];
}

// Least-squares affine map artboard (u, v) → machine (x, y) from three or
// more point pairs: x = a·u + b·v + c, y = d·u + e·v + f. null if the points
// are too few or on one line.
export function fitAffine(pairs) {
  if (pairs.length < 3) return null;
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
  for (const { u, v, x, y } of pairs) {
    const r = [u, v, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j];
      bx[i] += r[i] * x; by[i] += r[i] * y;
    }
  }
  const px = solve3(M, bx), py = solve3(M, by);
  if (!px || !py) return null;
  const [a, b, c] = px, [d, e, f] = py;
  return { a, b, c, d, e, f, at: (u, v) => ({ x: a * u + b * v + c, y: d * u + e * v + f }) };
}
function solve3(M, b) {
  const A = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 4; j++) A[r][j] -= k * A[c][j];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

// What the recorded corners say about the canvas, edge by edge.
// For every edge with both corners recorded: its length on the machine, the
// nominal length, and the drift — how far the far corner is off the axis the
// edge should run along (mm, and as an angle). Positive drift: towards +Y for
// the side edges, towards +X (up) for the top and bottom edges.
const EDGES = [
  { name: 'left', a: 'bl', b: 'tl', along: 'x' },
  { name: 'right', a: 'br', b: 'tr', along: 'x' },
  { name: 'bottom', a: 'bl', b: 'br', along: 'y' },
  { name: 'top', a: 'tl', b: 'tr', along: 'y' },
];
export function canvasReport(recs, w, h) {
  const at = Object.fromEntries(CORNERS.map(n => [n, cornerAt(recs[n])]));
  const edges = [];
  for (const E of EDGES) {
    const A = at[E.a], B = at[E.b];
    if (!A || !B) continue;
    const dx = B.x - A.x, dy = B.y - A.y;
    const length = Math.hypot(dx, dy), nominal = E.along === 'x' ? h : w;
    const drift = E.along === 'x' ? dy : dx;
    const run = E.along === 'x' ? dx : dy;
    edges.push({ name: E.name, length, nominal, drift, deg: Math.atan2(drift, run) * 180 / Math.PI });
  }
  const pairs = CORNERS.filter(n => at[n]).map(n => ({ ...artboardCorner(n, w, h), ...at[n] }));
  const fit = fitAffine(pairs);
  let residual = null;
  if (fit && pairs.length > 3) {
    residual = Math.max(...pairs.map(p => { const q = fit.at(p.u, p.v); return Math.hypot(q.x - p.x, q.y - p.y); }));
  }
  const diag = at.tl && at.br && at.tr && at.bl
    ? { tlbr: Math.hypot(at.br.x - at.tl.x, at.br.y - at.tl.y), trbl: Math.hypot(at.bl.x - at.tr.x, at.bl.y - at.tr.y), nominal: Math.hypot(w, h) }
    : null;
  return { corners: at, edges, fit, residual, diag };
}

// The part of the travel the carriage may use: between the walls, and where
// a wall is not known, up to the stop. null — open on that side.
export function reach() {
  const lim = (ax, side) => WALLS[ax][side] ?? STOPS[ax][side];
  return { x: { min: lim('x', 'min'), max: lim('x', 'max') }, y: { min: lim('y', 'min'), max: lim('y', 'max') } };
}

// ---------- the job on the machine ----------
// The job file (job.js, jobFile: artboard mm, x right, y down) turned into
// what the board runs, through the canvas fit (canvasReport(...).fit, which
// maps the artboard (u, v) to the machine (x, y)). The result is a list of
// blocks in order; the runner sends one block, waits for it, sends the next:
//   { kind: 'arm',  cmd: 'J 3 90', off: true }   the brush swings off (J3)
//   { kind: 'move', cmds: [...], lengthMM, paintMM }   pieces + G
// A move block is one travel (T, M, G), or a run: what is painted without
// the brush leaving the canvas (F, L/A…, G) — a pass, or in a snake the
// passes and turns of a stroke. Before every run: brush off, travel to its
// start, brush on.
//
// Past the walls the machine cannot go, so there it does not paint (the
// owner's decision, 2026-09-27: a brush running off is fine, the machine does
// not stumble on it). Every piece is cut at the walls; a run that leaves the
// reach ends at the wall, and where the stroke comes back a new run starts.
// What was cut is reported in `skipped`, for the record — it does not stop a
// job. The edge of the canvas is not a limit: inside the walls the brush
// paints past it.
//
// Arcs keep their centre and end point; the sweep turns the same way on the
// machine when the map keeps orientation, the other way when it mirrors. The
// firmware draws circles, so a skewed map (axes not square) bends arcs
// slightly; lines are exact. Which side J3 swings to is not decided yet
// (Rubens_v2.md, section 4.5).
export const SWING_DEG = 90;
const EDGE_IN = 0.1;   // mm inside the walls: rounding to 0.01 mm must not land a point past one

const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
const TAU = Math.PI * 2;

// The part of a line inside the box, as fractions [t0, t1] of it, or null.
function clipLine(p, q, B) {
  let t0 = 0, t1 = 1;
  const d = { x: q.x - p.x, y: q.y - p.y };
  for (const [k, lo, hi] of [['x', B.x0, B.x1], ['y', B.y0, B.y1]]) {
    if (Math.abs(d[k]) < 1e-12) { if (p[k] < lo || p[k] > hi) return null; continue; }
    let a = (lo - p[k]) / d[k], b = (hi - p[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t1 - t0 > 1e-9 ? [t0, t1] : null;
}
// The parts of an arc (centre c, radius r, from angle a0 through sweep s)
// inside the box, as fraction intervals of the sweep.
function clipArc(c, r, a0, s, B) {
  const cuts = [0, 1];
  for (const [k, v] of [['x', B.x0], ['x', B.x1], ['y', B.y0], ['y', B.y1]]) {
    const d = (v - c[k]) / r;
    if (Math.abs(d) > 1) continue;
    const base = k === 'x' ? Math.acos(d) : Math.asin(d);
    for (const th of k === 'x' ? [base, -base] : [base, Math.PI - base]) {
      let t = ((th - a0) % TAU + TAU) % TAU;         // angle from the start, 0…2π, in +s terms
      if (s < 0) t = (TAU - t) % TAU;
      t /= Math.abs(s);
      if (t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const t0 = cuts[i], t1 = cuts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    const m = a0 + s * (t0 + t1) / 2, x = c.x + r * Math.cos(m), y = c.y + r * Math.sin(m);
    if (x >= B.x0 && x <= B.x1 && y >= B.y0 && y <= B.y1) {
      if (out.length && Math.abs(out[out.length - 1][1] - t0) < 1e-9) out[out.length - 1][1] = t1;
      else out.push([t0, t1]);
    }
  }
  return out;
}

export function jobToMachine(job, fit, { paintMMs = 20, travelMMs = 100 } = {}) {
  const det = fit.a * fit.e - fit.b * fit.d, sign = det > 0 ? 1 : -1;
  const at = q => fit.at(q.x, q.y);
  const R = reach();
  const B = {
    x0: (R.x.min ?? -Infinity) + EDGE_IN, x1: (R.x.max ?? Infinity) - EDGE_IN,
    y0: (R.y.min ?? -Infinity) + EDGE_IN, y1: (R.y.max ?? Infinity) - EDGE_IN,
  };
  const blocks = [], skipped = [];
  let run = null, off = null, end = null;          // off: null — unknown at the start; end: where the run has got to
  const arm = o => { if (o !== off) { blocks.push({ kind: 'arm', cmd: `J 3 ${o ? SWING_DEG : 0}`, off: o }); off = o; } };
  const close = () => { if (run) { run.cmds.push('G'); blocks.push(run); run = null; } };
  const near = (p, q) => p && q && Math.hypot(p.x - q.x, p.y - q.y) < 0.01;
  // A piece that starts where the run is continues it; anything else starts
  // a new run: brush off, travel, brush on.
  const piece = (from, to, cmd, len, painted) => {
    if (!run || !near(from, end)) {
      close(); arm(true);
      blocks.push({ kind: 'move', cmds: [`T ${travelMMs}`, `M ${f2(from.x)} ${f2(from.y)}`, 'G'], lengthMM: null, paintMM: 0 });
      arm(false);
      run = { kind: 'move', cmds: [`F ${paintMMs}`], lengthMM: 0, paintMM: 0 };
    }
    run.cmds.push(cmd); run.lengthMM += len; if (painted) run.paintMM += len;
    end = to;
  };

  job.steps.forEach((st, i) => {
    if (st.kind === 'travel') { close(); return; }
    const painted = st.kind === 'paint';
    let cut = 0;
    for (const g of st.segs) {
      if (g.t === 'L') {
        const p = at(g.a), q = at(g.b), L = Math.hypot(q.x - p.x, q.y - p.y);
        const t = clipLine(p, q, B);
        if (!t) { cut += L; continue; }
        const a = { x: p.x + (q.x - p.x) * t[0], y: p.y + (q.y - p.y) * t[0] };
        const b = { x: p.x + (q.x - p.x) * t[1], y: p.y + (q.y - p.y) * t[1] };
        cut += L * (1 - (t[1] - t[0]));
        piece(a, b, `L ${f2(b.x)} ${f2(b.y)}`, L * (t[1] - t[0]), painted);
      } else {
        const c = at(g.c);
        const p = at({ x: g.c.x + g.r * Math.cos(g.a0), y: g.c.y + g.r * Math.sin(g.a0) });
        const q = at({ x: g.c.x + g.r * Math.cos(g.a0 + g.s), y: g.c.y + g.r * Math.sin(g.a0 + g.s) });
        const r = Math.hypot(p.x - c.x, p.y - c.y), a0 = Math.atan2(p.y - c.y, p.x - c.x);
        const s = Math.sign(g.s) * sign * Math.abs(g.s), L = Math.abs(s) * r;
        let kept = 0;
        for (const [t0, t1] of clipArc(c, r, a0, s, B)) {
          const u = { x: c.x + r * Math.cos(a0 + s * t0), y: c.y + r * Math.sin(a0 + s * t0) };
          const w = t1 >= 1 - 1e-9 ? q : { x: c.x + r * Math.cos(a0 + s * t1), y: c.y + r * Math.sin(a0 + s * t1) };
          piece(u, w, `A ${f2(c.x)} ${f2(c.y)} ${f2(w.x)} ${f2(w.y)} ${s > 0 ? 1 : -1}`, L * (t1 - t0), painted);
          kept += t1 - t0;
        }
        cut += L * (1 - kept);
      }
    }
    if (cut > 0.05) skipped.push({ step: i, stroke: st.stroke, lane: st.lane, mm: cut });
  });
  close(); arm(true);
  // Like a 3D printer, the job ends at home (the owner, 2026-09-28), not over
  // the middle of the canvas: the bottom left corner inside the walls, the
  // brush off. Home itself lies past the walls, at the stops, where no path goes.
  if (Number.isFinite(B.x0) && Number.isFinite(B.y0))
    blocks.push({ kind: 'move', cmds: [`T ${travelMMs}`, `M ${f2(B.x0)} ${f2(B.y0)}`, 'G'], lengthMM: null, paintMM: 0, home: true });
  return { blocks, skipped, skippedMM: skipped.reduce((a, x) => a + x.mm, 0) };
}
