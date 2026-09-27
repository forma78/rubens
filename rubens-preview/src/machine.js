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
export const STOPS = { x: { min: -9.45, max: 860.55 }, y: { min: -8.3, max: 578.55 } };
export const WALLS = {
  x: { min: 0, max: 68800 / 80, checked: { min: true, max: false } },   // top: the owner's choice, see CALIBRATION.md
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
// from the top left corner — the same way the Paint tab draws.
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
