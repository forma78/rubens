// Calibration page: the machine from above, live, and where the canvas lies
// on it (Rubens_v2.md, section 7). Talks to the machine only through
// rubens.py: /machine/ping, /machine/cmd, /machine/origin/x|y, and /arm for
// the arm jog (the owner, 2026-09-28: three handles as on the MELNICOMM
// pendant, after the brush was swung to 180°).

import { FORMATS } from './config.js';
import { fmt } from './util.js';
import { HOME_STEPS, STOPS, WALLS, CORNERS, EDGE_SIDES, toMm, parsePing, cornerAt, artboardCorner, canvasReport, canvasFromEdges, reach } from './machine.js';
import './ui.js';

const $ = s => document.querySelector(s);
const INK = '#24221F', MUTE = '#7D776D', ORANGE = '#EB7A25', PAPER = '#EEEAE2';

const S = {
  link: 'wait',                 // ok · lost (no board on USB) · server (no rubens.py)
  pos: { x: null, y: null },    // carriage, mm; null — that axis has no zero
  edge: { x: false, y: false },
  trail: [],
  cal: { format: 'p60x80', edges: {}, corners: {} },
};

// ---------- the machine ----------
async function machine(cmd, opts) {
  try {
    const r = await fetch('/machine' + cmd, { cache: 'no-store', ...opts });
    const board = r.headers.get('X-Board');
    S.link = r.status === 404 ? 'server' : board === 'lost' || !r.ok ? 'lost' : 'ok';
    return r.ok ? await r.text() : null;
  } catch {
    S.link = 'server';
    return null;
  }
}

// The watchdog on the board stops the axes after 1.5 s without news; the
// ping also brings the position. Five times a second, like the pendant.
let pinging = false;
async function ping() {
  if (pinging) return;
  pinging = true;
  const p = parsePing(await machine('/ping'));
  pinging = false;
  if (p) {
    S.pos = { x: p.x == null ? null : toMm('x', p.x), y: p.y == null ? null : toMm('y', p.y) };
    S.edge = { x: p.edgeX, y: p.edgeY };
    if (p.edgeX) atEdge('x');
    if (p.edgeY) atEdge('y');
    if (S.pos.x != null && S.pos.y != null) {
      const last = S.trail[S.trail.length - 1], now = performance.now();
      const d = last ? Math.hypot(last.x - S.pos.x, last.y - S.pos.y) : 0;
      // Faster than the carriage can go (200 mm/s, with room to spare):
      // the zero was changed, the old trail is in other numbers.
      if (last && d > 400 * (now - last.t) / 1000 + 5) S.trail = [];
      if (!S.trail.length || d > 0.3) {
        S.trail.push({ ...S.pos, t: now });
        if (S.trail.length > 5000) S.trail.shift();
      }
    }
  }
  showLink(); showPos(); draw();
}

function showLink() {
  const el = $('#linkState');
  const txt = { ok: '● MACHINE', lost: 'NO BOARD · USB and 12 V?', server: 'NO SERVER · start rubens.py', wait: '…' }[S.link];
  el.textContent = txt;
  el.className = 'link-state ' + (S.link === 'ok' ? 'ok' : 'bad');
}
function showPos() {
  for (const a of ['x', 'y']) {
    const el = $('#pos' + a.toUpperCase()), v = S.pos[a];
    el.className = 'pos' + (v == null ? ' none' : '');
    el.textContent = v == null ? 'NO ZERO' : (v < 0 && fmt(Math.abs(v)) !== '0.0' ? '−' : '') + fmt(Math.abs(v)) + ' mm' + (S.edge[a] ? ' · EDGE' : '');
  }
  const noZero = S.pos.x == null || S.pos.y == null;
  $('#posNote').innerHTML = S.link !== 'ok' ? '' : noZero
    ? '<span class="warn">No zero: after power-on the board does not know where the carriage is, and the walls are off. Level 1: X down to its stop, Y left to its stop, stop at the first sound — then Set home.</span>'
    : '';
  document.querySelectorAll('[data-act="rec"]').forEach(b => { b.disabled = noZero || S.link !== 'ok'; });
}

// ---------- jog ----------
// The slider stays where it is put, like a throttle (the pendant's rule).
const JOG = {
  x: { input: $('#jogX'), out: $('#jogXv'), level: 0 },
  y: { input: $('#jogY'), out: $('#jogYv'), level: 0 },
};
const label = v => v ? `${v > 0 ? '+' : '−'}${Math.abs(v)} · ${Math.abs(v) * 10} mm/s` : 'IDLE';
// Signed scales like the pendant: minus left, plus right. Y is labelled at
// every level; X at every fifth, with a tick at each level.
function ticks(el, max, every) {
  let h = '';
  for (let v = -max; v <= max; v++) {
    const left = `calc(9px + (100% - 18px) * ${(v + max) / (2 * max)})`;
    const lab = v % every === 0 ? `<span>${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</span>` : '';
    h += `<i class="${lab ? 'major' : ''}" style="left:${left}">${lab}</i>`;
  }
  el.innerHTML = h;
}
ticks($('#tickX'), 20, 5);
ticks($('#tickY'), 9, 1);
const setLive = (a, on) => $('#ax' + a.toUpperCase()).classList.toggle('live', on);
for (const [a, J] of Object.entries(JOG)) {
  J.input.addEventListener('input', () => {
    const v = +J.input.value;
    if (v === J.level) return;
    J.level = v;
    J.out.textContent = label(v);
    setLive(a, v !== 0);
    machine(`/cmd?a=${a.toUpperCase()}&n=${v}`).then(t => { if (t && /^край/.test(t)) atEdge(a); });
  });
}
// At a wall the board stops the axis itself; the screen must not say it moves.
function atEdge(a) {
  const J = JOG[a];
  if (J.level === 0) return;
  J.level = 0; J.input.value = 0; J.out.innerHTML = '<span class="warn">EDGE</span>'; setLive(a, false);
}
function idle() {
  for (const [a, J] of Object.entries(JOG)) { J.level = 0; J.input.value = 0; J.out.textContent = 'IDLE'; setLive(a, false); }
}
const moving = () => JOG.x.level !== 0 || JOG.y.level !== 0;
function stop() { idle(); machine('/cmd?a=S&n=0'); }
$('#btnStop').onclick = stop;
$('#btnKill').onclick = () => { idle(); machine('/cmd?a=K&n=0'); };
addEventListener('keydown', e => { if (e.key === 'Escape') stop(); });
// A hidden tab still pings once a second, enough for the watchdog, so the
// axes would keep going unseen: stop them.
document.addEventListener('visibilitychange', () => { if (document.hidden && moving()) stop(); });
addEventListener('pagehide', () => { if (moving()) fetch('/machine/cmd?a=S&n=0', { keepalive: true }); });

// ---------- the arm ----------
// Three handles, as on the MELNICOMM pendant: shoulder and elbow ±45°, the
// wrist −90…+10° (a USB camera on the holder is in the way past +10°,
// 2026-09-30; rubens.py, REACH, refuses more), 5° a step. Plus is the brush
// to the right for the shoulder too, unlike the pendant (rubens.py, TURN).
// Degrees are RUBENS's own, from
// the working pose (rubens.py, class Arm): the servos say where they are, so
// a handle moves its joint from where it really is, whatever zero the board
// took at power-on. A joint moves when the handle is let go.
const ARM = [['shoulder', 'Shoulder', -45, 45], ['elbow', 'Elbow', -45, 45], ['wrist', 'Wrist', -90, 10]];
const armBusy = new Set();
function servoTicks(el, lo, hi) {
  const every = Math.max(-lo, hi) / 3;   // a label every 15° on ±45°, every 30° on the wrist, and at both ends
  let h = '';
  for (let v = lo; v <= hi; v += 5) {
    const left = `calc(9px + (100% - 18px) * ${(v - lo) / (hi - lo)})`;
    const lab = v % every === 0 || v === lo || v === hi ? `<span>${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</span>` : '';
    h += `<i class="${lab ? 'major' : ''}" style="left:${left}">${lab}</i>`;
  }
  el.innerHTML = h;
}
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v)) + '°';
async function armLook() {
  if (armBusy.size) return;
  let a = null;
  try { const r = await fetch('/arm', { cache: 'no-store' }); if (r.ok) a = (await r.json()).angles; } catch { /* no server */ }
  for (const [k, K, lo, hi] of ARM) {
    const v = a?.[k], input = $('#arm' + K);
    $('#pos' + K).textContent = v == null ? '—' : signed(v);
    $('#pos' + K).className = 'pos' + (v == null ? ' none' : '');
    // the handle shows where the joint is, unless it is being held
    if (v != null && document.activeElement !== input && !armBusy.has(k)) input.value = Math.max(lo, Math.min(hi, Math.round(v / 5) * 5));
    $('#arm' + K + 'V').textContent = v != null && (v < lo - 0.6 || v > hi + 0.6) ? 'OUT OF RANGE' : '';
  }
}
for (const [k, K, lo, hi] of ARM) {
  servoTicks($('#tick' + K), lo, hi);
  $('#arm' + K).addEventListener('change', async e => {
    const d = +e.target.value, ax = $('#ax' + K);
    armBusy.add(k); ax.classList.add('busy'); $('#arm' + K + 'V').textContent = `→ ${signed(d)}`;
    let msg = '';
    try {
      const r = await fetch(`/arm?j=${k}&d=${d}`, { method: 'POST' }), t = await r.text();
      let o; try { o = JSON.parse(t); } catch { o = { ok: false, message: t }; }
      if (!r.ok || !o.ok) msg = o.message || t;
    } catch { msg = 'start rubens.py'; }
    armBusy.delete(k); ax.classList.remove('busy'); e.target.blur();
    $('#arm' + K + 'V').innerHTML = msg ? `<span class="warn">${msg}</span>` : '';
    armLook();
  });
}
armLook();
setInterval(armLook, 1000);

// ---------- home ----------
let homeTimer = 0;
$('#btnHome').onclick = () => {
  $('#btnHomeYes').hidden = false;
  clearTimeout(homeTimer);
  homeTimer = setTimeout(() => { $('#btnHomeYes').hidden = true; }, 5000);
};
$('#btnHomeYes').onclick = async () => {
  $('#btnHomeYes').hidden = true;
  if (moving()) { $('#posNote').innerHTML = '<span class="warn">Stop the axes first.</span>'; return; }
  const a = await machine(`/origin/x?at=${HOME_STEPS.x}`), b = await machine(`/origin/y?at=${HOME_STEPS.y}`);
  S.trail = [];
  $('#hint').textContent = `Home set: ${a ?? '?'} · ${b ?? '?'}`;
  ping();
};

// ---------- the canvas: four edges ----------
// The canvas always lies parallel to the rails (the owner, 2026-09-30), so
// it is four edges, one number each: where the tip stood at the edge, and
// how far the canvas edge is past it (machine.js, canvasFromEdges). The
// corners the Job tab uses are made from them and saved along.
const fmtOf = () => FORMATS[S.cal.format] || FORMATS.p60x80;
const EDGES = {
  left:   { name: 'Left',   axis: 'y', past: 'further left' },
  right:  { name: 'Right',  axis: 'y', past: 'further right' },
  top:    { name: 'Top',    axis: 'x', past: 'further up' },
  bottom: { name: 'Bottom', axis: 'x', past: 'further down' },
};
function renderEdges() {
  $('#edges').innerHTML = EDGE_SIDES.map(k => {
    const E = EDGES[k], r = S.cal.edges[k];
    const at = r ? `${E.axis.toUpperCase()} ${fmt(r.at)}` : 'not recorded';
    return `<div class="corner" data-k="${k}">
      <span class="nm">${E.name}</span>
      <span class="xy${r ? ' set' : ''}">${at}</span>
      <span class="acts"><button class="btn" data-act="rec">Record</button>${r ? '<button class="link" data-act="clr" title="Forget this edge">clear</button>' : ''}</span>
      ${r ? `<span class="off">canvas edge <label><input type="number" step="0.5" min="0" data-past value="${r.past || 0}"></label> mm ${E.past}</span>` : ''}
    </div>`;
  }).join('');
  showPos();
}
// the corners from the edges, for the Job tab (calibration.json "corners")
function applyEdges() { S.cal.corners = canvasFromEdges(S.cal.edges) || {}; }
$('#edges').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const k = b.closest('.corner').dataset.k;
  if (b.dataset.act === 'rec') {
    const v = S.pos[EDGES[k].axis]; if (v == null) return;
    S.cal.edges[k] = { at: +v.toFixed(2), past: S.cal.edges[k]?.past || 0, when: new Date().toISOString() };
  } else delete S.cal.edges[k];
  applyEdges(); renderEdges(); report(); draw(); save();
});
$('#edges').addEventListener('change', e => {
  if (!e.target.matches('[data-past]')) return;
  const k = e.target.closest('.corner').dataset.k;
  S.cal.edges[k].past = Math.max(0, +e.target.value || 0);
  applyEdges(); report(); draw(); save();
});
const sel = $('#calFormat');
sel.innerHTML = Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
sel.onchange = () => { S.cal.format = sel.value; report(); draw(); save(); };

async function save() {
  try {
    const r = await fetch('/calibration', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.cal, null, 2) });
    $('#saved').textContent = r.ok ? 'saved to calibration.json' : 'NOT SAVED';
  } catch { $('#saved').textContent = 'NOT SAVED · start rubens.py'; }
}
async function load() {
  try {
    const r = await fetch('/calibration', { cache: 'no-store' });
    if (r.ok) Object.assign(S.cal, await r.json());
  } catch { /* no server: start empty */ }
  S.cal.edges ||= {};
  S.cal.corners ||= {};
  if (Object.keys(S.cal.edges).length) applyEdges();
  sel.value = S.cal.format;
}

// ---------- result ----------
// Where the canvas corners are: all four from the fit when there is one,
// otherwise the recorded ones.
function canvasCorners(rep, F) {
  if (rep.fit) return Object.fromEntries(CORNERS.map(n => { const { u, v } = artboardCorner(n, F.w, F.h); return [n, rep.fit.at(u, v)]; }));
  return rep.corners;
}
function report() {
  const F = fmtOf(), el = $('#report');
  const n = EDGE_SIDES.filter(k => S.cal.edges[k]).length;
  if (n < 4) { el.innerHTML = `<p class="none">Record all four edges (${n} so far).</p>`; return; }
  const C = S.cal.corners, W = C.tr.y - C.tl.y, H = C.tl.x - C.bl.x;
  let h = `<table><tr><td></td><td class="r mono">measured</td><td class="r mono">format</td></tr>
    <tr><td>width</td><td class="r">${fmt(W)}</td><td class="r">${fmt(F.w)}</td></tr>
    <tr><td>height</td><td class="r">${fmt(H)}</td><td class="r">${fmt(F.h)}</td></tr></table>`;
  // Far off the format: most likely a ruler number is missing (the tip at a
  // wall taken for the canvas edge, 2026-09-30) — a job placed from it would
  // be stretched or squeezed, and the Job tab refuses it.
  const off = [['width', W, F.w], ['height', H, F.h]].filter(([, m, nom]) => Math.abs(m / nom - 1) > 0.015);
  if (off.length) h += `<p class="warn">${off.map(([k, m, nom]) => `${k} ${fmt(m)} mm against ${fmt(nom)}`).join(', ')}: more than 1.5 % off the format. A ruler number is missing or off, or the canvas is another format. The Job tab will not place a job.</p>`;
  else h += `<p>The canvas matches the format within ${fmt(Math.max(Math.abs(W / F.w - 1), Math.abs(H / F.h - 1)) * 100, 1)} %.</p>`;
  const R = reach(), out = [];
  const xs = n => C[n]?.x, ys = n => C[n]?.y;
  const top = Math.max(...['tl', 'tr'].map(xs).filter(v => v != null));
  const bottom = Math.min(...['bl', 'br'].map(xs).filter(v => v != null));
  const left = Math.min(...['tl', 'bl'].map(ys).filter(v => v != null));
  const right = Math.max(...['tr', 'br'].map(ys).filter(v => v != null));
  if (isFinite(top) && top > R.x.max) out.push(`top ${fmt(top - R.x.max)} mm`);
  if (isFinite(bottom) && bottom < R.x.min) out.push(`bottom ${fmt(R.x.min - bottom)} mm${WALLS.x.checked.min ? '' : ' (the lower X wall is not checked)'}`);
  if (isFinite(left) && left < R.y.min) out.push(`left ${fmt(R.y.min - left)} mm`);
  if (isFinite(right) && R.y.max != null && right > R.y.max) out.push(`right ${fmt(right - R.y.max)} mm`);
  if (isFinite(right) && R.y.max == null) out.push('right: not known yet — the right Y stop is not measured');
  if (out.length) h += `<p class="warn">Out of reach: ${out.join(' · ')}.</p>`;
  el.innerHTML = h;
}

// ---------- the view from above ----------
// Bottom of the picture at the bottom of the screen: X grows up, Y to the right.
const cv = $('#top'), ctx = cv.getContext('2d');
function draw() {
  const st = $('#stage'), dpr = devicePixelRatio || 1;
  const W = st.clientWidth, H = st.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const F = fmtOf(), rep = canvasReport(S.cal.corners, F.w, F.h), C = canvasCorners(rep, F), R = reach();
  const pts = [...Object.values(C).filter(Boolean), ...S.trail, ...(S.pos.x != null && S.pos.y != null ? [S.pos] : [])];
  const x0 = Math.min(STOPS.x.min ?? R.x.min ?? 0, ...pts.map(p => p.x)) - 25, x1 = Math.max(STOPS.x.max ?? R.x.max ?? 600, ...pts.map(p => p.x)) + 25;
  const y0 = Math.min(STOPS.y.min ?? 0, ...pts.map(p => p.y)) - 25, y1 = Math.max(R.y.max ?? 0, 620, ...pts.map(p => p.y)) + 25;
  const pad = 44, k = Math.min((W - 2 * pad) / (y1 - y0), (H - 2 * pad) / (x1 - x0));
  const ox = (W - (y1 - y0) * k) / 2, oy = (H - (x1 - x0) * k) / 2;
  const sx = y => ox + (y - y0) * k, sy = x => oy + (x1 - x) * k;
  ctx.font = '10px "SF Mono", ui-monospace, Menlo, monospace';

  // grid every 100 mm
  ctx.strokeStyle = 'rgba(36,34,31,.07)'; ctx.lineWidth = 1; ctx.fillStyle = MUTE;
  for (let x = Math.ceil(x0 / 100) * 100; x <= x1; x += 100) {
    ctx.beginPath(); ctx.moveTo(sx(y0), sy(x)); ctx.lineTo(sx(y1), sy(x)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(`X ${x}`, sx(y0) - 4, sy(x) + 3);
  }
  for (let y = Math.ceil(y0 / 100) * 100; y <= y1; y += 100) {
    ctx.beginPath(); ctx.moveTo(sx(y), sy(x0)); ctx.lineTo(sx(y), sy(x1)); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(`Y ${y}`, sx(y), sy(x0) + 14);
  }

  // travel between the walls (or up to the stops where there is no wall)
  const rx0 = R.x.min ?? x0, rx1 = R.x.max ?? x1, ry0 = R.y.min ?? y0, ry1 = R.y.max ?? y1;
  ctx.fillStyle = 'rgba(255,255,255,.35)';
  ctx.fillRect(sx(ry0), sy(rx1), (ry1 - ry0) * k, (rx1 - rx0) * k);

  // the canvas
  const poly = CORNERS.map(n => C[n]);
  if (poly.every(Boolean)) {
    ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(p.y), sy(p.x))); ctx.closePath();
    ctx.fillStyle = PAPER; ctx.fill();
    // out of reach: hatched
    ctx.save(); ctx.clip();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(sx(ry0), sy(rx1), (ry1 - ry0) * k, (rx1 - rx0) * k);
    ctx.clip('evenodd');
    ctx.strokeStyle = 'rgba(179,71,12,.35)';
    for (let d = -H; d < W; d += 7) { ctx.beginPath(); ctx.moveTo(d, H); ctx.lineTo(d + H, 0); ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(p.y), sy(p.x))); ctx.closePath();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
  } else {
    // only some corners: draw the edges between neighbours
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      const a = poly[i], b = poly[(i + 1) % 4];
      if (a && b) { ctx.beginPath(); ctx.moveTo(sx(a.y), sy(a.x)); ctx.lineTo(sx(b.y), sy(b.x)); ctx.stroke(); }
    }
  }
  for (const n of CORNERS) {
    const r = S.cal.corners[n]; if (!r) continue;
    const c = cornerAt(r), X = sx(c.y), Y = sy(c.x);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X - 6, Y); ctx.lineTo(X + 6, Y); ctx.moveTo(X, Y - 6); ctx.lineTo(X, Y + 6); ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = n[1] === 'l' ? 'left' : 'right';
    ctx.fillText(n.toUpperCase(), X + (n[1] === 'l' ? 8 : -8), Y + (n[0] === 't' ? 14 : -8));
  }

  // The walls: where the board stops the carriage. The stops themselves, a
  // few mm past them, are not drawn (the owner, 2026-09-30: with the canvas
  // wider than the rails their thick lines cut through it like a frame).
  const wall = (x, y, xx, yy, ok, text, tx, ty, align) => {
    ctx.save(); ctx.strokeStyle = ORANGE; ctx.globalAlpha = ok ? 1 : 0.5; ctx.lineWidth = 1.2; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(sx(y), sy(x)); ctx.lineTo(sx(yy), sy(xx)); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = ORANGE; ctx.textAlign = align; ctx.fillText(text, tx, ty); ctx.restore();
  };
  const W_ = WALLS;
  wall(W_.x.max, y0, W_.x.max, y1, true, `wall X +${fmt(W_.x.max)}`, sx(y1) - 4, sy(W_.x.max) + 13, 'right');
  wall(W_.x.min, y0, W_.x.min, y1, W_.x.checked.min, `wall X +${fmt(W_.x.min)}${W_.x.checked.min ? '' : ' · not checked'}`, sx(y1) - 4, sy(W_.x.min) - 5, 'right');
  wall(x0, W_.y.min, x1, W_.y.min, true, `wall Y +${fmt(W_.y.min)}`, sx(W_.y.min) + 4, sy(x0) - 6, 'left');
  if (W_.y.max == null) { ctx.fillStyle = MUTE; ctx.textAlign = 'right'; ctx.fillText('right Y stop: not measured, no wall', sx(y1) - 4, sy(x0) - 6); }

  // the trail and the tip
  if (S.trail.length > 1) {
    ctx.strokeStyle = 'rgba(36,34,31,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); S.trail.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, sx(p.y), sy(p.x))); ctx.stroke();
  }
  if (S.pos.x != null && S.pos.y != null) {
    const X = sx(S.pos.y), Y = sy(S.pos.x);
    ctx.strokeStyle = 'rgba(235,122,37,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, H); ctx.moveTo(0, Y); ctx.lineTo(W, Y); ctx.stroke();
    ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(X, Y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X, Y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = 'left';
    ctx.fillText(`X ${fmt(S.pos.x)} · Y ${fmt(S.pos.y)}`, X + 14, Y - 12);
  }

  // which way is which
  ctx.fillStyle = MUTE; ctx.textAlign = 'left';
  ctx.fillText('↑ top of the picture · X+', 10, 16);
  ctx.fillText('↓ bottom · the beam, where you stand', 10, H - 10);
  ctx.textAlign = 'right'; ctx.fillText('Y+ →', W - 10, 16);
}
addEventListener('resize', draw);

// ---------- start ----------
await load();
renderEdges(); report(); draw();
ping();
setInterval(ping, 200);
