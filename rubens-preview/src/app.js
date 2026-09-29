// RUBENS · Brush Preview v0.1.3 — the page: state, input, panels, screen.
//
// Model: paint is squeezed onto the canvas beforehand, eight drops across the
// brush. The brush follows the path and drags each drop along its own lane.
// Neighbouring lanes mix at their border (Mix); towards the end of a stroke
// the paint runs out (dry brush).
//
// Units: the document is in pt, 1 pt = 25.4/72 mm, 1:1 with the canvas — like
// an Illustrator artboard set to the real size. The path is straight lines (L)
// and circular arcs (A) only. No Béziers.
//
// The pure parts (geometry, paint math, CNC plan, SVG) live in their own
// modules and take the state as arguments, so they can be tested in Node.

import { PT_MM, FORMATS, BRUSHES, WEIGHT_MIN, WEIGHT_MAX, WEIGHT_PRESETS, PAPER, K_LEV, N_VAR, HOLD_MS, DEFAULT_PALETTES } from './config.js';
import { clamp, P, sub, add, len, dist, rad, deg, TAU, mod, fmt } from './util.js';
import { isHex, normHex, luminance } from './color.js';
import { segStart, segEnd, segLen, segAt, segDirEnd, moveSeg, samplePath, tangentArc, anchorsOf, applyAnchorMove } from './geometry.js';
import { makeLine, snapArc, fitSegment, pushSeg } from './gesture.js';
import { traceMM, lengthMM, mlPerDrop, beadMM, blobMM } from './paint.js';
import { getStrips, renderPaint } from './render.js';
import { cncPlan, cncSvg } from './cnc.js';
import { jobSteps, PER_LANE } from './job.js';
import { drawingSvg, simplify } from './svg.js';
import { canvasReport, reach } from './machine.js';
import './ui.js';

// ---------- state ----------
const $ = s => document.querySelector(s);
const S = {
  format: 'p60x80',
  paths: [],
  palettes: JSON.parse(JSON.stringify(DEFAULT_PALETTES)),
  sel: null,
  selAnchors: [],          // indices of the selected anchors of the selected stroke
  tool: 'gesture',
  penArc: false,
  angleSnap: 15,
  defaults: { weight: 200, brush: 'round10', mix: 35, palette: 'L1', load: 'auto', ml: 1 },
  paint: { film: 0.3, retention: 25, nozzle: 6, maxDrop: 1, cornerR: 10, lift: true },   // lift: brush off after each pass
  view: { wires: false, drops: false, grid: false, snapGrid: false, cnc: false, reach: true, unit: 'mm' },   // unit: the Stroke panel's, mm or pt
  nextId: 1,
};
const docW = () => FORMATS[S.format].w / PT_MM;
const docH = () => FORMATS[S.format].h / PT_MM;
const pal = id => S.palettes.find(p => p.id === id) || S.palettes[0];
const selPath = () => S.paths.find(p => p.id === S.sel) || null;
const styleOf = () => (selPath() || { style: S.defaults }).style;
// The pure modules take the state as arguments; these pass the current one.
const colorsOf = p => pal(p.style.palette).colors;
const planOf = p => cncPlan(p, colorsOf(p), S.paint);
const lengthOf = p => lengthMM(p, S.paint);

function newPath() {
  const id = S.nextId++;
  return { id, segs: [], style: { ...S.defaults }, seed: (Math.random() * 1e9) | 0 };
}

// ---------- screen ----------
const paintCv = $('#paint'), wireCv = $('#wire'), board = $('#board'), stage = $('#stage');
const pctx = paintCv.getContext('2d'), wctx = wireCv.getContext('2d');
let kCss = 1, dpr = 1;
function layout() {
  const r = stage.getBoundingClientRect(), m = 36;
  kCss = Math.min((r.width - 2 * m) / docW(), (r.height - 2 * m) / docH());
  dpr = window.devicePixelRatio || 1;
  const w = Math.round(docW() * kCss), h = Math.round(docH() * kCss);
  board.style.width = w + 'px'; board.style.height = h + 'px';
  for (const c of [paintCv, wireCv]) { c.style.width = w + 'px'; c.style.height = h + 'px'; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  invalidate();
}
let paintDirty = true, rafOn = false;
function invalidate() { paintDirty = true; kick(); }
function kick() { if (!rafOn) { rafOn = true; requestAnimationFrame(frame); } }
function frame() {
  rafOn = false;
  if (paintDirty) { paintDirty = false; renderPaint(pctx, kCss * dpr, paintCv.width, paintCv.height, S.paths, colorsOf, S.paint); save(); updatePanel(); }
  if (G) holdTick();
  drawWire();
  if (G) kick();
}

// ---------- wire layer: paths, anchors, hints ----------
function tracePath(ctx, segs, k) {
  let first = true;
  for (const g of segs) {
    const a = segStart(g);
    if (first) { ctx.moveTo(a.x * k, a.y * k); first = false; }
    if (g.t === 'L') ctx.lineTo(g.b.x * k, g.b.y * k);
    else ctx.arc(g.c.x * k, g.c.y * k, g.r * k, g.a0, g.a0 + g.s, g.s < 0);
  }
}
function drawWire() {
  const c = wctx, k = kCss;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, wireCv.width, wireCv.height);
  if (S.view.cnc) drawCnc(c, k);
  if (S.view.grid) drawGrid(c, k);
  if (S.view.reach) drawReach(c, k);
  for (const p of S.paths) {
    const selected = p.id === S.sel;
    if (!p.segs.length) continue;
    if (S.view.drops) drawDrops(c, p, k);
    if (!S.view.wires && !selected) continue;   // the selected path is always visible
    c.beginPath(); tracePath(c, p.segs, k);
    c.strokeStyle = selected ? '#3D6BFF' : 'rgba(61,107,255,.55)'; c.lineWidth = selected ? 1.4 : 1; c.stroke();
    if (selected) {
      // anchors
      c.fillStyle = '#fff'; c.strokeStyle = '#3D6BFF'; c.lineWidth = 1;
      const pts = [segStart(p.segs[0]), ...p.segs.map(segEnd)];
      pts.forEach((q, i) => {
        const on = S.selAnchors.includes(i), h = on ? 4 : 3;
        c.fillStyle = on ? '#3D6BFF' : '#fff';
        c.fillRect(q.x * k - h, q.y * k - h, 2 * h, 2 * h); c.strokeRect(q.x * k - h, q.y * k - h, 2 * h, 2 * h);
      });
      // at the start: lane order 1…8
      laneLabels(c, p, k);
    }
  }
  // the active gesture
  const act = G || PEN;
  if (act) {
    const a = act.anchor;
    c.fillStyle = '#EB7A25'; c.fillRect(a.x * k - 3.5, a.y * k - 3.5, 7, 7);
    const prov = G ? G.prov : PEN.prov;
    if (G && G.raw.length > 1) {
      c.beginPath(); G.raw.forEach((q, i) => i ? c.lineTo(q.x * k, q.y * k) : c.moveTo(q.x * k, q.y * k));
      c.strokeStyle = 'rgba(36,34,31,.35)'; c.lineWidth = 1; c.setLineDash([2, 3]); c.stroke(); c.setLineDash([]);
    }
    if (prov) {
      const w = styleOf().weight * k;
      c.beginPath(); tracePath(c, [prov], k);
      c.strokeStyle = 'rgba(235,122,37,.18)'; c.lineWidth = w; c.lineCap = 'butt'; c.stroke();
      c.beginPath(); tracePath(c, [prov], k);
      c.strokeStyle = '#EB7A25'; c.lineWidth = 1.6; c.setLineDash([6, 4]); c.stroke(); c.setLineDash([]);
      const e = segEnd(prov);
      c.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--mono');
      const label = segLabel(prov);
      const tw = c.measureText(label).width;
      c.fillStyle = 'rgba(36,34,31,.85)'; c.fillRect(e.x * k + 12, e.y * k + 10, tw + 12, 19);
      c.fillStyle = '#fff'; c.fillText(label, e.x * k + 18, e.y * k + 23);
    }
    if (G && G.cursor && G.holdFrac > 0) {
      const q = G.cursor; c.beginPath(); c.arc(q.x * k, q.y * k, 11, -Math.PI / 2, -Math.PI / 2 + TAU * G.holdFrac);
      c.strokeStyle = '#EB7A25'; c.lineWidth = 2.5; c.stroke();
    }
  }
}
function segLabel(g) {
  if (g.t === 'L') { const a = mod(-deg(Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x)), 360); return `Line ${fmt(a, 0)}° · ${fmt(segLen(g) * PT_MM / 10, 1)} cm`; }
  return `Arc ${fmt(Math.abs(deg(g.s)), 0)}° · r ${fmt(g.r * PT_MM / 10, 1)} cm`;
}
// ---------- the machine's reach on this canvas ----------
// The walls drawn over the artboard, as on the Calibration tab (the owner,
// 2026-09-30: "I draw blind, it is not clear where the edges are"): from the
// canvas recorded there, when it is this drawing's format. Hatched: where
// the machine does not reach (there the brush runs along the wall); dashed:
// the walls.
let CAL = null;
async function loadCal() {
  try { const r = await fetch('/calibration', { cache: 'no-store' }); CAL = r.ok ? await r.json() : null; } catch { CAL = null; }
  kick();
}
function reachOnBoard() {           // the walls' box on the artboard, pt; null without a canvas of this format
  if (!CAL || CAL.format !== S.format) return null;
  const F = FORMATS[S.format], fit = canvasReport(CAL.corners || {}, F.w, F.h).fit;
  if (!fit) return null;
  const det = fit.a * fit.e - fit.b * fit.d;
  const board = (X, Y) => { const x = X - fit.c, y = Y - fit.f; return P((fit.e * x - fit.b * y) / det / PT_MM, (-fit.d * x + fit.a * y) / det / PT_MM); };
  const R = reach();
  return [[R.x.min, R.y.min], [R.x.max, R.y.min], [R.x.max, R.y.max], [R.x.min, R.y.max]].map(([x, y]) => board(x, y));
}
function drawReach(c, k) {
  const box = reachOnBoard(); if (!box) return;
  const W = docW() * k, H = docH() * k;
  const outline = () => { c.beginPath(); box.forEach((q, i) => i ? c.lineTo(q.x * k, q.y * k) : c.moveTo(q.x * k, q.y * k)); c.closePath(); };
  c.save();
  c.beginPath(); c.rect(0, 0, W, H);
  box.forEach((q, i) => i ? c.lineTo(q.x * k, q.y * k) : c.moveTo(q.x * k, q.y * k)); c.closePath();
  c.clip('evenodd');                                     // the artboard less the reach
  c.strokeStyle = 'rgba(179,71,12,.3)'; c.lineWidth = 1;
  for (let d = -H; d < W; d += 7) { c.beginPath(); c.moveTo(d, H); c.lineTo(d + H, 0); c.stroke(); }
  c.restore();
  c.save(); outline(); c.strokeStyle = '#EB7A25'; c.lineWidth = 1.2; c.setLineDash([6, 4]); c.stroke(); c.restore();
}
addEventListener('focus', loadCal);   // back from the Calibration tab: the canvas may be another
loadCal();

function drawGrid(c, k) {
  const step = 10 / PT_MM; // 10 mm
  c.lineWidth = 1;
  for (let i = 0, x = 0; x <= docW(); i++, x += step) { c.strokeStyle = i % 10 ? 'rgba(61,107,255,.08)' : 'rgba(61,107,255,.22)'; c.beginPath(); c.moveTo(Math.round(x * k) + .5, 0); c.lineTo(Math.round(x * k) + .5, docH() * k); c.stroke(); }
  for (let i = 0, y = 0; y <= docH(); i++, y += step) { c.strokeStyle = i % 10 ? 'rgba(61,107,255,.08)' : 'rgba(61,107,255,.22)'; c.beginPath(); c.moveTo(0, Math.round(y * k) + .5); c.lineTo(docW() * k, Math.round(y * k) + .5); c.stroke(); }
}
function laneLabels(c, p, k) {
  const q = segAt(p.segs[0], 0), w = p.style.weight / 2, r = P(-q.dy, q.dx);
  c.font = '600 11px ' + getComputedStyle(document.body).getPropertyValue('--sans');
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const put = (sgn, t) => {
    const x = (q.x + r.x * sgn * (w + 9 / k) - q.dx * 6 / k) * k, y = (q.y + r.y * sgn * (w + 9 / k) - q.dy * 6 / k) * k;
    c.fillStyle = '#3D6BFF'; c.beginPath(); c.arc(x, y, 8, 0, TAU); c.fill(); c.fillStyle = '#fff'; c.fillText(t, x, y + .5);
  };
  put(-1, '1'); put(1, '8');
  c.textAlign = 'start'; c.textBaseline = 'alphabetic';
}
// Drop plan: eight beads of paint at the start of the stroke, at real size.
function drawDrops(c, p, k) {
  const q = segAt(p.segs[0], 0), r = P(-q.dy, q.dx), w = p.style.weight;
  const ml = mlPerDrop(p, S.paint), nozPt = S.paint.nozzle / PT_MM, bead = beadMM(ml, S.paint.nozzle) / PT_MM;
  const cols = pal(p.style.palette).colors;
  for (let i = 0; i < 8; i++) {
    const off = ((i + 0.5) / 8 - 0.5) * w;
    const cx = q.x + r.x * off, cy = q.y + r.y * off;
    const bx = cx + q.dx * (nozPt / 2 + bead / 2), by = cy + q.dy * (nozPt / 2 + bead / 2);
    c.save(); c.translate(bx * k, by * k); c.rotate(Math.atan2(q.dy, q.dx));
    const L = Math.max(bead * k, 1), H = Math.max(nozPt * k, 2);
    c.beginPath(); c.roundRect(-L / 2 - H / 2, -H / 2, L + H, H, H / 2);
    c.fillStyle = cols[i] || 'rgba(0,0,0,0)'; c.globalAlpha = 0.92; c.fill(); c.globalAlpha = 1;
    c.strokeStyle = cols[i] ? 'rgba(0,0,0,.45)' : 'rgba(0,0,0,.35)'; c.setLineDash(cols[i] ? [] : [3, 2]); c.lineWidth = 1; c.stroke(); c.setLineDash([]);
    c.restore();
  }
}

// ---------- input: common ----------
function evPt(e) { const r = wireCv.getBoundingClientRect(); return P((e.clientX - r.left) / kCss, (e.clientY - r.top) / kCss); }
const tol = () => 5 / kCss;
function snapGridPt(q) { if (!S.view.snapGrid) return q; const st = 10 / PT_MM; return P(Math.round(q.x / st) * st, Math.round(q.y / st) * st); }

// undo history
let undoStack = [], redoStack = [];
const snapshot = () => JSON.stringify({ paths: S.paths, sel: S.sel, palettes: S.palettes });
function undoPush() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
let lastSoftPush = 0;
function undoPushSoft() { const t = performance.now(); if (t - lastSoftPush > 700) undoPush(); lastSoftPush = t; }
function restore(js) { const o = JSON.parse(js); S.paths = o.paths; S.sel = o.sel; S.selAnchors = S.selAnchors.filter(i => { const p = S.paths.find(q => q.id === S.sel); return p && i <= p.segs.length; }); S.palettes = o.palettes; renderPalettes(); invalidate(); }
function undo() { finishAll(); if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }

// ---------- gesture: drag slowly, stop — it straightens ----------
let G = null;
function gDown(e, q) {
  undoPush();
  const a = snapGridPt(q), p = newPath();
  S.paths.push(p); S.sel = p.id; S.selAnchors = [];
  G = { path: p, anchor: a, tan: null, raw: [a], stillPt: q, stillAt: performance.now(), prov: null, cursor: q, holdFrac: 0, mode: null };
  kick();
}
function gMove(e, q) {
  G.mode = e.shiftKey ? 'line' : e.altKey ? 'arc' : null;
  G.cursor = q;
  const last = G.raw[G.raw.length - 1];
  if (dist(q, last) > 0.5 / kCss) G.raw.push(q);
  if (dist(q, G.stillPt) > 3 / kCss) { G.stillPt = q; G.stillAt = performance.now(); }
  G.prov = fitSegment(G.raw, G.anchor, G.tan, G.mode, tol(), S.angleSnap);
  kick();
}
function holdTick() {
  if (!G.prov) { G.holdFrac = 0; return; }
  const t = performance.now() - G.stillAt;
  G.holdFrac = clamp(t / HOLD_MS, 0, 1);
  if (t >= HOLD_MS) gCommit();
}
function gCommit() {
  const g = G.prov; if (!g) return;
  pushSeg(G.path, g);
  G.anchor = segEnd(g); G.tan = segDirEnd(g);
  G.raw = [G.anchor]; G.prov = null; G.holdFrac = 0; G.stillAt = Infinity;
  invalidate();
}
function gUp() {
  if (!G) return;
  if (G.prov) gCommit();
  if (!G.path.segs.length) { S.paths = S.paths.filter(p => p !== G.path); S.sel = null; undoStack.pop(); }
  G = null; invalidate();
}

// ---------- pen: click — a point, A/Alt — a tangent arc ----------
let PEN = null;
function penSeg(q, e) {
  const wantArc = (S.penArc !== !!e.altKey) && PEN.tan;
  if (wantArc) { const g = tangentArc(PEN.anchor, PEN.tan, q); if (g) return snapArc(g); }
  if (dist(q, PEN.anchor) < tol()) return null;
  return makeLine(PEN.anchor, q, PEN.tan, S.angleSnap);
}
function penDown(e, q) {
  if (!PEN) {
    undoPush();
    const a = snapGridPt(q), p = newPath(); S.paths.push(p); S.sel = p.id;
    PEN = { path: p, anchor: a, tan: null, prov: null };
    invalidate(); return;
  }
  const g = penSeg(q, e); if (!g) return;
  undoPush(); pushSeg(PEN.path, g); PEN.anchor = segEnd(g); PEN.tan = segDirEnd(g); PEN.prov = null;
  invalidate();
}
function penMove(e, q) { if (!PEN) return; PEN.prov = penSeg(q, e); kick(); }
function penFinish() {
  if (!PEN) return;
  if (!PEN.path.segs.length) { S.paths = S.paths.filter(p => p !== PEN.path); S.sel = null; }
  PEN = null; invalidate();
}
function finishAll() { gUp(); penFinish(); }

// ---------- selecting and moving ----------
let DRAG = null;
function hitTest(q) {
  for (let i = S.paths.length - 1; i >= 0; i--) {
    const p = S.paths[i], lim = p.style.weight / 2 + 4 / kCss;
    for (const s of samplePath(p, 4 / kCss)) if (!s.fan && Math.hypot(s.x - q.x, s.y - q.y) < lim) return p;
  }
  return null;
}
function selDown(e, q) {
  const p = hitTest(q); if ((p ? p.id : null) !== S.sel) S.selAnchors = []; S.sel = p ? p.id : null;
  if (p) { undoPush(); DRAG = { p, last: q, moved: false }; }
  invalidate();
}
function selMove(e, q) { if (!DRAG) return; const d = sub(q, DRAG.last); DRAG.last = q; DRAG.moved = true; DRAG.p.segs.forEach(g => moveSeg(g, d)); invalidate(); }
function selUp() { if (DRAG && !DRAG.moved) undoStack.pop(); DRAG = null; }

// ---------- anchor editing (the math is in geometry.js) ----------
function anchorHit(q) {
  const p = selPath(); if (!p) return null;
  const pts = anchorsOf(p), lim = 7 / kCss;
  let best = null, bd = lim;
  pts.forEach((a, i) => { const d = dist(a, q); if (d < bd) { bd = d; best = i; } });
  return best;
}
let AD = null;   // anchor drag
function anchorDown(e, i) {
  const p = selPath();
  if (e.shiftKey) {
    const k = S.selAnchors.indexOf(i);
    if (k >= 0) { S.selAnchors.splice(k, 1); kick(); return; }
    S.selAnchors.push(i);
  } else if (!S.selAnchors.includes(i)) S.selAnchors = [i];
  undoPush();
  AD = { p, orig: JSON.parse(JSON.stringify(p.segs)), start: anchorsOf(p)[i], from: null, moved: false, lead: i };
  kick();
}
function anchorMove(e, q) {
  if (!AD.from) AD.from = q;
  let target = add(AD.start, sub(q, AD.from));
  target = snapGridPt(target);
  const delta = sub(target, AD.start);
  if (!AD.moved && len(delta) * kCss < 1) return;
  AD.moved = true;
  applyAnchorMove(AD.p, AD.orig, S.selAnchors, delta);
  invalidate();
}
function anchorUp() { if (AD && !AD.moved) undoStack.pop(); AD = null; }
function nudgeAnchors(dx, dy) {
  const p = selPath(); if (!p || !S.selAnchors.length) return false;
  undoPushSoft();
  applyAnchorMove(p, JSON.parse(JSON.stringify(p.segs)), S.selAnchors, P(dx, dy));
  invalidate(); return true;
}

wireCv.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  wireCv.setPointerCapture(e.pointerId);
  const q = evPt(e);
  if (!G && !PEN) { const i = anchorHit(q); if (i !== null) { anchorDown(e, i); return; } }
  if (S.selAnchors.length) { S.selAnchors = []; kick(); }
  if (S.tool === 'gesture') gDown(e, q);
  else if (S.tool === 'pen') penDown(e, q);
  else selDown(e, q);
});
wireCv.addEventListener('pointermove', e => {
  const q = evPt(e);
  $('#coords').textContent = `${fmt(q.x * PT_MM / 10, 1)} × ${fmt(q.y * PT_MM / 10, 1)} cm`;
  if (AD) { anchorMove(e, q); return; }
  wireCv.style.cursor = (!G && !PEN && anchorHit(q) !== null) ? 'move' : '';
  if (S.tool === 'gesture' && G) gMove(e, q);
  else if (S.tool === 'pen') penMove(e, q);
  else if (S.tool === 'select') selMove(e, q);
});
wireCv.addEventListener('pointerup', () => { if (AD) { anchorUp(); return; } if (S.tool === 'gesture') gUp(); if (S.tool === 'select') selUp(); });
wireCv.addEventListener('dblclick', () => { if (S.tool === 'pen') penFinish(); });
wireCv.addEventListener('pointerleave', () => { $('#coords').textContent = ''; });

// ---------- keyboard ----------
window.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  const mod_ = e.metaKey || e.ctrlKey;
  if (mod_ && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod_) return;
  const k = e.key.toLowerCase();
  if (k === 'g') setTool('gesture');
  else if (k === 'p') setTool('pen');
  else if (k === 'v') setTool('select');
  else if (k === 'a') { S.penArc = !S.penArc; syncTools(); if (PEN) kick(); }
  else if (k === 'h') toggleView('wires');
  else if (k === 'd') toggleView('drops');
  else if (k === 'c') toggleView('cnc');
  else if (e.key.startsWith('Arrow') && S.selAnchors.length) {
    e.preventDefault();
    const st = (e.shiftKey ? 10 : 1) / PT_MM, v = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    nudgeAnchors(v[0] * st, v[1] * st);
  }
  else if (e.key === 'Escape' && S.selAnchors.length) { S.selAnchors = []; kick(); }
  else if (e.key === 'Enter' || e.key === 'Escape') { penFinish(); if (e.key === 'Escape') { S.sel = null; invalidate(); } }
  else if ((e.key === 'Backspace' || e.key === 'Delete') && S.sel && !G && !PEN) { undoPush(); S.paths = S.paths.filter(p => p.id !== S.sel); S.sel = null; invalidate(); }
});

// ---------- tools and view ----------
const HINTS = {
  gesture: 'Gesture — press and drag slowly. Hold still ~0.35 s and the segment snaps to a straight line or a clean arc. Keep going: arcs continue tangent. Release to finish. Shift = line only, Alt = arc only.',
  pen: 'Pen — click to place points (straight segments). Alt-click or press A for a tangent arc. Double-click or Enter to finish.',
  cnc: '',
  select: 'Select — click a stroke to edit its settings, drag to move it. Click a square to move one point, Shift-click to add more. Arrows nudge 1 mm (Shift 10 mm). ⌫ deletes the stroke.',
};
function setTool(t) { finishAll(); S.tool = t; syncTools(); }
function syncTools() {
  document.querySelectorAll('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
  $('#btnArc').classList.toggle('armed', S.penArc);
  stage.className = 'stage t-' + S.tool;
  $('#hint').textContent = HINTS[S.tool];
}
function toggleView(k) { S.view[k] = !S.view[k]; syncView(); if (k === 'cnc') invalidate(); else kick(); save(); }
function syncView() { document.querySelectorAll('.tog').forEach(b => b.classList.toggle('on', !!S.view[b.dataset.view])); }
document.querySelectorAll('.tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
document.querySelectorAll('.tog').forEach(b => b.onclick = () => toggleView(b.dataset.view));
$('#btnArc').onclick = () => { S.penArc = !S.penArc; syncTools(); };
$('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo;
$('#btnDel').onclick = () => { if (!S.sel) return; undoPush(); S.paths = S.paths.filter(p => p.id !== S.sel); S.sel = null; invalidate(); };
$('#btnClear').onclick = () => { if (!S.paths.length) return; undoPush(); finishAll(); S.paths = []; S.sel = null; invalidate(); };

// ---------- panel ----------
// Trips per lane as chosen on the Job tab (its settings in this browser):
// 1 for Pencil, 2, 4 or 8 for Brush.
function jobTrips() {
  try {
    const o = JSON.parse(localStorage.getItem('rubens.job.v01') || 'null');
    return o?.mode === 'brush' ? (PER_LANE.includes(o.perLane) ? o.perLane : 4) : 1;
  } catch { return 1; }
}
addEventListener('storage', e => { if (e.key === 'rubens.job.v01') updatePanel(); });   // switched on the Job tab

function setStyle(key, val, soft) {
  soft ? undoPushSoft() : undoPush();
  S.defaults[key] = val;                          // the last choice becomes the default for new strokes
  const p = selPath(); if (p) p.style[key] = val;
  invalidate();
}
// Stroke width. The document keeps the whole trace in pt; the panel shows it
// as whole mm of one lane (the owner, 2026-09-29: "20 mm each lane, 25, 30",
// no fractions) — the default — or in pt, as before.
const inMM = () => S.view.unit !== 'pt';
const laneOf = w => w * PT_MM / 8;                                  // mm
const LANE_MAX = Math.floor(laneOf(WEIGHT_MAX));                    // 35 mm: 280 mm of the 800 pt limit
const LANE_PRESETS = [1, 2, 3, 5, 8, 10, 12, 15, 20, 22, 25, 30, 35].filter(v => v <= LANE_MAX);
// whole mm for the panel; ≈ for a stroke not set in whole mm of a lane
const mmWhole = v => v < 0.5 ? 'under 1' : (Math.abs(v - Math.round(v)) > 0.05 ? '≈ ' : '') + Math.round(v);
// logarithmic slider in pt: 1…800 pt; in mm a lane: 1…35 mm, one step a mm
const wToSlider = w => Math.round(Math.log(w / WEIGHT_MIN) / Math.log(WEIGHT_MAX / WEIGHT_MIN) * 1000);
const sliderToW = v => { const w = WEIGHT_MIN * Math.pow(WEIGHT_MAX / WEIGHT_MIN, v / 1000); return w < 10 ? Math.round(w * 2) / 2 : Math.round(w); };
function setWeight(w, soft) { w = clamp(+w || 1, WEIGHT_MIN, WEIGHT_MAX); setStyle('weight', w, soft); }
function setLane(mm, soft) { setWeight(clamp(Math.round(+mm || 1), 1, LANE_MAX) * 8 / PT_MM, soft); }
$('#wSlider').oninput = e => inMM() ? setLane(+e.target.value, true) : setWeight(sliderToW(+e.target.value), true);
$('#wNum').onchange = e => inMM() ? setLane(+e.target.value) : setWeight(+e.target.value);
$('#wMinus').onclick = () => { const w = styleOf().weight; inMM() ? setLane(Math.round(laneOf(w)) - 1) : setWeight(w > 10 ? w - 5 : w - 1); };
$('#wPlus').onclick = () => { const w = styleOf().weight; inMM() ? setLane(Math.round(laneOf(w)) + 1) : setWeight(w >= 10 ? w + 5 : w + 1); };
$('#wPreset').onchange = e => { if (e.target.value) inMM() ? setLane(+e.target.value) : setWeight(+e.target.value); e.target.value = ''; };
function syncUnits() {
  const mm = inMM(), sl = $('#wSlider'), n = $('#wNum');
  document.querySelectorAll('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.u === (mm ? 'mm' : 'pt')));
  $('#wWhat').hidden = !mm;
  $('#wUnit').textContent = mm ? 'mm' : 'pt';
  Object.assign(sl, mm ? { min: 1, max: LANE_MAX, step: 1 } : { min: 0, max: 1000, step: 1 });
  Object.assign(n, mm ? { min: 1, max: LANE_MAX } : { min: WEIGHT_MIN, max: WEIGHT_MAX });
  const marks = mm ? [0, 1, 2, 3].map(i => Math.round(1 + (LANE_MAX - 1) * i / 3)) : [1, 10, 100, WEIGHT_MAX];
  $('#wScale').innerHTML = marks.map((v, i) => `<span>${v}${i === 3 ? (mm ? ' mm' : ' pt') : ''}</span>`).join('');
  $('#wPreset').innerHTML = '<option value="">…</option>' + (mm ? LANE_PRESETS : WEIGHT_PRESETS).map(v => `<option value="${v}">${v} ${mm ? 'mm' : 'pt'}</option>`).join('');
  updatePanel();
}
document.querySelectorAll('#unitSeg button').forEach(b => b.onclick = () => { S.view.unit = b.dataset.u; syncUnits(); save(); });
$('#mix').oninput = e => setStyle('mix', +e.target.value, true);

$('#brushSeg').innerHTML = Object.entries(BRUSHES).map(([k, b]) => {
  // a flat brush: a row of even bristles; a round one: a dome
  const n = b.round ? 9 : b.mm, h = i => b.round ? 6 + 12 * Math.sqrt(1 - ((i + 0.5) / n * 2 - 1) ** 2) : 14 + Math.random() * 4;
  const bars = Array.from({ length: n }, (_, i) => `<i style="width:2px;height:${h(i).toFixed(1)}px"></i>`).join('');
  return `<button data-brush="${k}"><span class="bico">${bars}</span>${b.label}</button>`;
}).join('');
document.querySelectorAll('#brushSeg button').forEach(b => b.onclick = () => setStyle('brush', b.dataset.brush));

$('#film').onchange = e => { S.paint.film = Math.max(0.05, +e.target.value || 0.3); invalidate(); };
$('#ret').onchange = e => { S.paint.retention = Math.max(0, +e.target.value || 0); invalidate(); };
$('#nozzle').onchange = e => { S.paint.nozzle = Math.max(0.3, +e.target.value || 6); invalidate(); };
$('#cornerR').onchange = e => { S.paint.cornerR = Math.max(0, +e.target.value || 0); invalidate(); };
$('#maxdrop').onchange = e => { S.paint.maxDrop = Math.max(0.05, +e.target.value || 1); invalidate(); };
$('#lift').onchange = e => { S.paint.lift = e.target.checked; invalidate(); };
document.querySelectorAll('input[name=load]').forEach(r => r.onchange = () => setStyle('load', r.value));
$('#ml').onchange = e => { setStyle('ml', Math.max(0.01, +e.target.value || 0.1)); setStyle('load', 'manual'); };

$('#format').innerHTML = Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
$('#format').onchange = e => { S.format = e.target.value; layout(); save(); };
$('#anglesnap').onchange = e => { S.angleSnap = +e.target.value; save(); };

// palettes
function renderPalettes() {
  const cur = styleOf().palette;
  $('#palettes').innerHTML = S.palettes.map((p, pi) => `
    <div class="pal ${p.id === cur ? 'on' : ''}" data-pal="${p.id}">
      <div class="pal-head"><span class="no">LOAD ${pi + 1}</span><span class="nm">${p.name}</span>
        <button class="copy" data-copy="${p.id}" title="Copy the 8 HEX codes">Copy HEX</button></div>
      <div class="drops">${p.colors.map((c, i) => `
        <div class="drop"><label class="sw ${c ? '' : 'empty'}" style="${c ? 'background:' + c : ''}" title="Drop ${i + 1}${c ? ' · ' + c : ' · empty'} — right-click to empty">
          <input type="color" value="${c || '#888888'}" data-pal="${p.id}" data-i="${i}"></label><span class="ix">${i + 1}</span></div>`).join('')}
      </div>
      <div class="hexes">${p.colors.map((c, i) => `<label>${i + 1}<input value="${c || ''}" placeholder="#——————" data-hex="${p.id}" data-i="${i}" maxlength="7" spellcheck="false"></label>`).join('')}</div>
    </div>`).join('');
  document.querySelectorAll('.pal-head').forEach(h => h.onclick = e => { if (e.target.closest('.copy')) return; setStyle('palette', h.parentElement.dataset.pal); renderPalettes(); });
  document.querySelectorAll('.drop input[type=color]').forEach(inp => {
    inp.oninput = () => setDrop(inp.dataset.pal, +inp.dataset.i, inp.value.toUpperCase(), true);
    inp.onchange = () => renderPalettes();
    inp.parentElement.oncontextmenu = ev => { ev.preventDefault(); setDrop(inp.dataset.pal, +inp.dataset.i, null); renderPalettes(); };
  });
  document.querySelectorAll('.hexes input').forEach(inp => {
    inp.oninput = () => { const v = inp.value; inp.classList.toggle('bad', !!v && !isHex(v)); };
    inp.onchange = () => { const v = inp.value.trim(); if (!v) setDrop(inp.dataset.hex, +inp.dataset.i, null); else if (isHex(v)) setDrop(inp.dataset.hex, +inp.dataset.i, normHex(v)); renderPalettes(); };
  });
  document.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    const p = pal(b.dataset.copy);
    const txt = `${p.name}: [${p.colors.map(c => c ? `"${c}"` : 'null').join(', ')}]`;
    navigator.clipboard?.writeText(txt).then(() => { b.textContent = 'Copied'; setTimeout(() => b.textContent = 'Copy HEX', 1200); }, () => prompt('Copy:', txt));
  });
}
function setDrop(pid, i, hex, soft) {
  soft ? undoPushSoft() : undoPush();
  pal(pid).colors[i] = hex;
  const sw = document.querySelector(`.drop input[data-pal="${pid}"][data-i="${i}"]`);
  if (sw && hex) { sw.parentElement.style.background = hex; sw.parentElement.classList.remove('empty'); }
  invalidate();
}

// brush cross-section in the panel
function drawXsec() {
  const cv = $('#xsec'), w = cv.clientWidth, h = 44, d = window.devicePixelRatio || 1;
  cv.width = w * d; cv.height = h * d;
  const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = PAPER; c.fillRect(0, 0, cv.width, cv.height);
  const st = styleOf(), N = Math.round(w * d);
  const strips = getStrips(pal(st.palette).colors, st.mix, st.brush, N, 12345);
  c.imageSmoothingEnabled = false;
  for (let y = 0; y < cv.height; y++) {
    const lev = Math.min(K_LEV - 1, Math.floor((1 - y / cv.height) * 0.55 * K_LEV)); // fresh paint at the top, nearer the end at the bottom
    c.drawImage(strips[lev][y % N_VAR], 0, 1, N, 1, 0, y, N, 1);
  }
}

function updatePanel() {
  const p = selPath(), st = styleOf();
  const lane = laneOf(st.weight);
  if (document.activeElement !== $('#wNum')) $('#wNum').value = inMM() ? Math.round(lane) : Math.round(st.weight * 10) / 10;   // set in mm, the pt are not whole
  $('#wSlider').value = inMM() ? Math.round(lane) : wToSlider(st.weight);
  $('#wRead').innerHTML = inMM()
    ? `Each lane <b>${mmWhole(lane)} mm</b> · trace ${mmWhole(8 * lane)} mm wide`
    : `Trace <b>${fmt(st.weight * PT_MM, 1)} mm</b> wide · each lane ${fmt(lane, 1)} mm`;
  document.querySelectorAll('#brushSeg button').forEach(b => b.classList.toggle('on', b.dataset.brush === st.brush));
  // CNC: eight lanes of this brush, lane = stroke / 8. In the Job tab's Brush
  // mode every lane is perLane trips, so the trips lie stroke / (8 × perLane) apart.
  const B = BRUSHES[st.brush], perLane = jobTrips(), trips = 8 * perLane;
  const pitch = st.weight * PT_MM / trips, fullPt = B.mm * trips / PT_MM, gap = pitch - B.mm;
  let note = '';
  if (gap > 0.5) note = ` <span class="warn">Gaps of ${fmt(gap, 1)} mm between passes.</span>`;
  else if (gap < -0.5) note = ` <span class="warn">Passes overlap by ${fmt(-gap, 1)} mm.</span>`;
  const how = perLane > 1 ? `<b>8 lanes × ${perLane} trips</b> (Brush on the Job tab): ${trips} trips` : '<b>8 passes</b>';
  // the stroke that closes the gaps, only if it is within the limit
  const match = Math.abs(gap) > 0.5 && fullPt <= WEIGHT_MAX + 1e-9;
  $('#bRead').innerHTML = `CNC runs ${how} of the ${B.mm} mm brush, ${fmt(pitch, 1)} mm apart.${note}` +
    (match ? ` <button class="link" id="matchBrush">${inMM() ? `Each lane ${perLane * B.mm} mm` : `Stroke = ${trips} × ${B.mm} mm (${fmt(fullPt, 0)} pt)`}</button>` : '') +
    (B.guess ? ` <span class="hint">${B.mm} mm and the texture are a guess until the first paint photos.</span>` : '');
  const mb = $('#matchBrush'); if (mb) mb.onclick = () => inMM() ? setLane(perLane * B.mm) : setWeight(Math.round(fullPt));
  $('#mix').value = st.mix; $('#mixVal').textContent = st.mix + '%';
  document.querySelectorAll('input[name=load]').forEach(r => r.checked = r.value === st.load);
  if (document.activeElement !== $('#ml')) $('#ml').value = st.ml;
  // Brush on the Job tab never leaves the canvas within a stroke; the option is Pencil's
  $('#lift').checked = S.paint.lift ?? true; $('#lift').disabled = perLane > 1;
  $('#lift').parentElement.classList.toggle('off', perLane > 1);
  for (const [id, v] of [['film', S.paint.film], ['ret', S.paint.retention], ['nozzle', S.paint.nozzle], ['maxdrop', S.paint.maxDrop ?? 1], ['cornerR', S.paint.cornerR ?? 10]]) if (document.activeElement !== $('#' + id)) $('#' + id).value = v;
  document.querySelectorAll('.pal').forEach(el => el.classList.toggle('on', el.dataset.pal === st.palette));
  drawXsec();
  updateMath(p);
  const tot = S.paths.reduce((a, q) => a + lengthOf(q), 0);
  let nPass = 0, cncL = 0;
  if (S.view.cnc) for (const q of S.paths) if (q.segs.length) for (const ps of planOf(q).passes) { nPass++; cncL += ps.Lmm; }
  $('#stats').textContent = `${S.paths.filter(q => q.segs.length).length} strokes · ${fmt(tot / 10, 0)} cm of path` + (S.view.cnc ? ` · CNC ${nPass} passes, ${fmt(cncL / 1000, 2)} m` : '');
}

function updateMath(p) {
  const m = $('#math');
  if (!p || !p.segs.length) { m.innerHTML = '<p class="none">Select a stroke to see how much paint each drop needs.</p>'; }
  else {
    const plan = planOf(p), ps = plan.passes, L = lengthOf(p), lane = plan.pitchMM;
    const total = ps.reduce((a, q) => a + q.n * q.ml, 0), nd = ps.reduce((a, q) => a + q.n, 0);
    const big = ps.reduce((a, q) => Math.max(a, q.ml), 0), bead = beadMM(big, S.paint.nozzle), blob = blobMM(big);
    const refill = ps.filter(q => q.n > 1).length;
    let warn = '';
    if (S.paint.nozzle > lane) warn += `<p class="warn">Nozzle ${fmt(S.paint.nozzle, 1)} mm is wider than the pass pitch (${fmt(lane, 1)} mm): beads of neighbouring passes will touch.</p>`;
    if (plan.warn.length) warn += `<p class="warn">${plan.warn.length} spot${plan.warn.length > 1 ? 's are' : ' is'} too tight for a ${fmt(traceMM(p), 0)} mm trace — the inner passes meet in a sharp point there (marked ! in CNC Trace).</p>`;
    if (refill) warn += `<p class="warn">${refill} pass${refill > 1 ? 'es need' : ' needs'} paint added along the way — see CNC Trace.</p>`;
    m.innerHTML = `<table>
      <tr><td>Centre line</td><td class="r">${fmt(L / 10, 1)} cm</td></tr>
      <tr><td>Pass pitch</td><td class="r">${fmt(lane, 1)} mm</td></tr>
      <tr><td>Paint for the stroke</td><td class="r"><b>${fmt(total, 2)} ml</b></td></tr>
      <tr><td>Drops in total</td><td class="r">${nd}</td></tr>
      <tr><td>Largest drop</td><td class="r"><b>${fmt(big, 2)} ml</b></td></tr>
      <tr><td>= bead from ${fmt(S.paint.nozzle, 1)} mm nozzle</td><td class="r"><b>${fmt(bead, 0)} mm</b> long</td></tr>
      <tr><td>= round blob</td><td class="r">Ø ${fmt(blob, 1)} mm</td></tr>
    </table>${warn}`;
  }
  // passes of the selected stroke
  const pe = $('#passes');
  if (!p || !p.segs.length) pe.innerHTML = '<p class="none">Select a stroke.</p>';
  else {
    const plan = planOf(p);
    pe.innerHTML = plan.passes.length ? '<table class="lanes">' + plan.passes.map(ps =>
      `<tr><td class="n">${ps.lane}</td><td><span class="chip" style="background:${ps.color}"></span><span class="mono">${ps.color}</span></td><td class="r">${fmt(ps.Lmm / 10, 1)} cm</td><td class="r">${ps.n} × ${fmt(ps.ml, 2)} ml</td></tr>`).join('') + '</table>'
      : '<p class="none">This load is empty — no passes.</p>';
  }
  // summary over all strokes: how much of each colour to squeeze (from the CNC plan, refills included)
  const agg = new Map();
  for (const q of S.paths) {
    if (!q.segs.length) continue;
    for (const ps of planOf(q).passes) { const a = agg.get(ps.color) || { n: 0, ml: 0 }; a.n += ps.n; a.ml += ps.n * ps.ml; agg.set(ps.color, a); }
  }
  $('#squeeze').innerHTML = agg.size ? '<table>' + [...agg.entries()].sort((a, b) => b[1].ml - a[1].ml).map(([c, a]) =>
    `<tr><td><span class="chip" style="background:${c}"></span><span class="mono">${c}</span></td><td class="r">${a.n} drop${a.n > 1 ? 's' : ''}</td><td class="r">${fmt(a.ml, 2)} ml</td></tr>`).join('') + '</table>'
    : '<p class="none">Nothing drawn yet.</p>';
}

// ---------- CNC Trace on screen ----------
function drawCnc(c, k) {
  c.fillStyle = 'rgba(238,234,226,.72)'; c.fillRect(0, 0, docW() * k, docH() * k);   // dim the paint
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.font = '600 10px ' + getComputedStyle(document.body).getPropertyValue('--sans');
  c.textAlign = 'center'; c.textBaseline = 'middle';
  // the moves between passes: travel with the brush off (dotted), snake turns (solid)
  for (const st of jobSteps(S.paths, colorsOf, S.paint)) {
    if (st.kind === 'paint') continue;
    c.globalAlpha = S.sel && st.stroke !== S.sel ? 0.45 : 1;
    c.beginPath(); tracePath(c, st.segs, k);
    if (st.kind === 'travel') { c.setLineDash([2, 5]); c.strokeStyle = 'rgba(36,34,31,.45)'; c.lineWidth = 1; }
    else { c.strokeStyle = 'rgba(36,34,31,.75)'; c.lineWidth = 1.6; }
    c.stroke(); c.setLineDash([]);
  }
  for (const p of S.paths) {
    if (!p.segs.length) continue;
    const plan = planOf(p), dim = S.sel && p.id !== S.sel;
    c.globalAlpha = dim ? 0.45 : 1;
    // the centre line — the motors' path; it paints nothing (no ninth drop)
    c.beginPath(); tracePath(c, plan.axis, k); c.setLineDash([7, 5]);
    c.strokeStyle = 'rgba(36,34,31,.6)'; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
    for (const ps of plan.passes) {
      c.beginPath(); tracePath(c, ps.segs, k);
      c.strokeStyle = 'rgba(36,34,31,.55)'; c.lineWidth = 3; c.stroke();         // "pencil"
      c.beginPath(); tracePath(c, ps.segs, k);
      c.strokeStyle = ps.color; c.lineWidth = 1.6; c.stroke();
      chevron(c, ps.segs, k);                                                   // painting direction
      ps.drops.forEach((d, j) => {
        const x = d.at.x * k, y = d.at.y * k;
        c.beginPath(); c.arc(x, y, j ? 5 : 7, 0, TAU);
        c.fillStyle = ps.color; c.fill(); c.strokeStyle = '#24221F'; c.lineWidth = 1.2; c.stroke();
        if (!j) { c.fillStyle = luminance(ps.color) > 0.5 ? '#24221F' : '#fff'; c.fillText(ps.lane, x, y + .5); }
      });
    }
  }
  c.globalAlpha = 1;
  // tight spots: the inner passes do not fit here
  for (const p of S.paths) {
    if (!p.segs.length) continue;
    for (const q of planOf(p).warn) {
      c.beginPath(); c.arc(q.x * k, q.y * k, 13, 0, TAU); c.strokeStyle = '#D9481C'; c.lineWidth = 2; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#D9481C'; c.fillText('!', q.x * k, q.y * k);
    }
  }
  c.textAlign = 'start'; c.textBaseline = 'alphabetic'; c.lineCap = 'butt';
}

// A small arrowhead halfway along a pass, pointing the way it is painted.
function chevron(c, segs, k) {
  let d = segs.reduce((a, g) => a + segLen(g), 0) / 2;
  for (const g of segs) {
    const L = segLen(g);
    if (d > L) { d -= L; continue; }
    const q = segAt(g, d), x = q.x * k, y = q.y * k, nx = -q.dy, ny = q.dx;
    c.beginPath(); c.moveTo(x - q.dx * 6 + nx * 4, y - q.dy * 6 + ny * 4); c.lineTo(x, y); c.lineTo(x - q.dx * 6 - nx * 4, y - q.dy * 6 - ny * 4);
    c.strokeStyle = '#24221F'; c.lineWidth = 1.6; c.stroke();
    return;
  }
}

// ---------- export ----------
function exportCNC() {
  finishAll();
  const s = cncSvg({ format: FORMATS[S.format], paths: S.paths, colorsOf, paletteNameOf: p => pal(p.style.palette).name, paint: S.paint });
  download(new Blob([s], { type: 'image/svg+xml' }), `rubens-cnc-${stamp()}.svg`);
}
// The drawing with its whole state (svg.js): Export SVG, and the Library.
const drawingText = () => drawingSvg({ formatKey: S.format, format: FORMATS[S.format], paths: S.paths, palettes: S.palettes, paint: S.paint, paletteOf: p => pal(p.style.palette) });
// The painted picture on a canvas, `long` px on its long side.
function paintedCanvas(long) {
  const k = long / Math.max(docW(), docH());
  const cv = document.createElement('canvas'); cv.width = Math.round(docW() * k); cv.height = Math.round(docH() * k);
  renderPaint(cv.getContext('2d'), k, cv.width, cv.height, S.paths, colorsOf, S.paint);
  return cv;
}
function exportSVG() {
  finishAll();
  download(new Blob([drawingText()], { type: 'image/svg+xml' }), `rubens-${stamp()}.svg`);
}
function stamp() { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`; }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function exportPNG() {
  finishAll();
  paintedCanvas(4000).toBlob(b => download(b, `rubens-${stamp()}.png`), 'image/png');
}

// ---------- 💾 SAVE: the drawing into the Library ----------
// Every save is a new drawing named by the date and time — "2026-09-30
// 01:15", "(2)" for a second one in the same minute; an older drawing stays
// as it was (the owner, 2026-09-30). rubens.py keeps them on this Mac only
// (rubens-preview/library/, not in git): the drawing with its whole state,
// and its painted preview, 800 px on the long side.
const libraryName = file => file.slice(0, 13) + ':' + file.slice(14);   // '2026-09-30 01-15' → '… 01:15'
async function saveToLibrary() {
  finishAll();
  const st = $('#saveState'), b = $('#btnSave');
  if (!S.paths.some(p => p.segs.length)) { st.textContent = 'nothing drawn yet'; return; }
  b.disabled = true; st.textContent = 'saving…';
  try {
    const r = await fetch('/library', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ svg: drawingText(), png: paintedCanvas(800).toDataURL('image/png') }),
    });
    const o = await r.json();
    st.textContent = o.ok ? `saved · ${o.name}` : `not saved · ${o.message}`;
  } catch { st.textContent = 'not saved · start rubens.py'; }
  b.disabled = false;
}
$('#btnSave').onclick = saveToLibrary;

// Opened from the Library (library.html → index.html?open=<file>): the
// drawing takes the place of the one on the canvas; ⌘Z brings that one back.
async function openFromLibrary(file) {
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch('library/' + encodeURIComponent(file) + '.svg', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    importSVG(await r.text());
    saveNow();
    $('#saveState').textContent = `opened · ${libraryName(file)}`;
  } catch { $('#saveState').textContent = 'could not open it from the Library'; }
}
$('#btnSvg').onclick = exportSVG;
$('#btnPng').onclick = exportPNG;
$('#btnCnc').onclick = exportCNC;
// 🖨 Open Job: the Job tab reads the drawing from this browser, so save it first.
$('#btnJob').onclick = () => { finishAll(); saveNow(); location.href = 'job.html'; };

// ---------- import ----------
$('#btnImport').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = async e => { const f = e.target.files[0]; if (!f) return; importSVG(await f.text()); e.target.value = ''; };
function importSVG(text) {
  finishAll();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const meta = doc.querySelector('metadata#rubens-state');
  undoPush();
  if (meta) {                          // our own file — restore it exactly
    try {
      const st = JSON.parse(meta.textContent.replace(/- -/g, '--'));
      if (FORMATS[st.format]) S.format = st.format;
      if (st.palettes) S.palettes = st.palettes;
      if (st.paint) S.paint = st.paint;
      const base = S.nextId;
      S.paths = st.paths.map((p, i) => ({ ...p, id: base + i }));
      S.nextId = base + st.paths.length; S.sel = null;
      $('#format').value = S.format; renderPalettes(); layout(); return;
    } catch (err) { console.warn('rubens metadata', err); }
  }
  importGeneric(doc);
}
// A foreign SVG (Illustrator): any curves are broken into short straight lines.
function importGeneric(doc) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden';
  const svg = document.importNode(doc.documentElement, true);
  holder.appendChild(svg); document.body.appendChild(holder);
  let vb = svg.viewBox && svg.viewBox.baseVal, vx = 0, vy = 0, vw, vh;
  if (vb && vb.width) { vx = vb.x; vy = vb.y; vw = vb.width; vh = vb.height; }
  else { const bb = svg.getBBox(); vx = bb.x; vy = bb.y; vw = bb.width || 1; vh = bb.height || 1; svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`); }
  svg.setAttribute('width', vw); svg.setAttribute('height', vh);
  const sc = Math.min(docW() / vw, docH() / vh), ox = (docW() - vw * sc) / 2, oy = (docH() - vh * sc) / 2;
  const added = [];
  svg.querySelectorAll('path,line,polyline,polygon,rect,circle,ellipse').forEach(el => {
    if (el.closest('defs,clipPath,mask,symbol,marker')) return;
    let L = 0; try { L = el.getTotalLength(); } catch (e) { return; }
    if (!L) return;
    const m = el.getCTM(); const step = Math.max(L / 4000, 0.5);
    const cs = getComputedStyle(el); const sw = parseFloat(cs.strokeWidth) || 0;
    let run = [], prev = null;
    const flush = () => { if (run.length > 1) added.push({ pts: simplify(run, 0.3), sw: sw * sc }); run = []; };
    for (let d = 0; d <= L + 1e-6; d += step) {
      const pt = el.getPointAtLength(Math.min(d, L)).matrixTransform(m);
      const q = P(pt.x * sc + ox, pt.y * sc + oy);
      if (prev && dist(q, prev) > step * sc * 4) flush();   // a gap between subpaths
      run.push(q); prev = q;
    }
    flush();
  });
  holder.remove();
  for (const a of added) {
    const p = newPath();
    if (a.sw >= 1) p.style.weight = clamp(Math.round(a.sw), WEIGHT_MIN, WEIGHT_MAX);
    for (let i = 1; i < a.pts.length; i++) if (dist(a.pts[i], a.pts[i - 1]) > 1e-3) p.segs.push({ t: 'L', a: a.pts[i - 1], b: a.pts[i] });
    if (p.segs.length) S.paths.push(p);
  }
  S.sel = null; invalidate();
}

// ---------- saving in the browser ----------
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 300);
}
function saveNow() {
  clearTimeout(saveT);
  try { localStorage.setItem('rubens.v01', JSON.stringify({ format: S.format, paths: S.paths.filter(p => p.segs.length), palettes: S.palettes, defaults: S.defaults, paint: S.paint, view: S.view, angleSnap: S.angleSnap, nextId: S.nextId })); } catch (e) { }
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem('rubens.v01') || 'null'); if (!o) return false;
    Object.assign(S, { format: o.format, paths: o.paths, palettes: o.palettes, defaults: o.defaults, paint: o.paint, view: o.view, angleSnap: o.angleSnap, nextId: o.nextId });
    if (!FORMATS[S.format]) S.format = 'p60x80';
    if (S.view && S.view.reach === undefined) S.view.reach = true;   // saved before the Reach toggle
    return true;
  } catch (e) { return false; }
}

// ---------- demo composition on first start ----------
// A path from commands: ['L', length] — straight; ['R'|'T', radius, degrees] — an arc turning right / left.
function build(start, dirDeg, ops, style) {
  const p = newPath(); Object.assign(p.style, style);
  let pos = { ...start }, d = P(Math.cos(rad(dirDeg)), Math.sin(rad(dirDeg)));
  for (const [op, a, b] of ops) {
    let g;
    if (op === 'L') g = { t: 'L', a: { ...pos }, b: P(pos.x + d.x * a, pos.y + d.y * a) };
    else {
      const right = op === 'R', n = right ? P(-d.y, d.x) : P(d.y, -d.x), c = P(pos.x + n.x * a, pos.y + n.y * a);
      g = { t: 'A', c, r: a, a0: Math.atan2(pos.y - c.y, pos.x - c.x), s: (right ? 1 : -1) * rad(b) };
    }
    p.segs.push(g); pos = segEnd(g); d = segDirEnd(g);
  }
  return p;
}
function demo() {
  S.format = 'p60x80';
  S.paths = [
    build(P(-60, 330), 0, [['L', 1130], ['R', 190, 180], ['L', 420], ['T', 170, 135], ['L', 1500]], { weight: 230, brush: 'flat12', mix: 35, palette: 'L1' }),
    build(P(1780, 1330), 180, [['L', 520], ['R', 200, 90], ['L', 160], ['R', 160, 180], ['L', 380], ['T', 150, 90], ['L', 900]], { weight: 200, brush: 'flat8', mix: 45, palette: 'L2' }),
    build(P(-60, 2060), 0, [['L', 700], ['T', 190, 90], ['L', 120]], { weight: 170, brush: 'flat12', mix: 25, palette: 'L3' }),
  ];
  S.sel = null;
}

// ---------- start ----------
async function loadDefault() {
  // default.svg next to index.html is the drawing that opens on a fresh start.
  // To make it yours: Export SVG → save as rubens-preview/default.svg.
  try {
    const r = await fetch('default.svg', { cache: 'no-store' });
    if (r.ok) { importSVG(await r.text()); undoStack = []; return true; }
  } catch (e) { }
  return false;
}
const fresh = !load();
if (fresh) demo();
$('#format').value = S.format;
$('#anglesnap').value = String(S.angleSnap);
renderPalettes(); syncTools(); syncView(); syncUnits();
new ResizeObserver(layout).observe(stage);
layout();
const opening = new URLSearchParams(location.search).get('open');   // from the Library tab
if (opening) openFromLibrary(opening);
else if (fresh) loadDefault();
$('#btnDefault').onclick = () => { finishAll(); loadDefault().then(ok => { if (!ok) { undoPush(); demo(); invalidate(); } }); };
