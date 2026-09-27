// Job page: the drawing from the Paint tab as the machine will run it — every
// pass, travel and turn in order (job.js), played on a clock with the percent
// painted and the minutes left, like a 3D printer. On screen only: nothing
// here talks to the machine.

import { PT_MM, FORMATS, PAPER } from './config.js';
import { fmt, clamp } from './util.js';
import { luminance } from './color.js';
import { segLen } from './geometry.js';
import { jobSteps, jobLengths, jobTimeline, jobAt, jobFile, TIME_MODEL } from './job.js';
import { canvasReport, jobToMachine, CORNERS } from './machine.js';

const $ = s => document.querySelector(s);
const INK = '#24221F', ORANGE = '#EB7A25';

const S = { doc: null, steps: [], tl: null, t: 0, playing: false, speed: 10, model: { ...TIME_MODEL }, cal: null, onMachine: null };

// ---------- the drawing and the plan ----------
// The Paint tab keeps its drawing in this browser; read it from there.
function loadDoc() {
  try {
    const o = JSON.parse(localStorage.getItem('rubens.v01') || 'null');
    return o && FORMATS[o.format] && Array.isArray(o.paths) ? o : null;
  } catch { return null; }
}
function build() {
  const frac = S.tl && S.tl.total ? S.t / S.tl.total : 0;
  S.doc = loadDoc();
  const d = S.doc;
  if (!d) { S.steps = []; S.tl = null; S.t = 0; return; }
  const colorsOf = p => (d.palettes.find(q => q.id === p.style.palette) || d.palettes[0]).colors;
  S.steps = jobSteps(d.paths.filter(p => p.segs.length), colorsOf, d.paint);
  S.tl = jobTimeline(S.steps, S.model);
  S.t = frac * S.tl.total;
}

// Per-viewer settings: the time model and the playback speed.
function loadPrefs() {
  try {
    const o = JSON.parse(localStorage.getItem('rubens.job.v01') || 'null');
    if (o?.model) Object.assign(S.model, o.model);
    if (o?.speed) S.speed = o.speed;
  } catch { /* defaults */ }
}
function savePrefs() {
  try { localStorage.setItem('rubens.job.v01', JSON.stringify({ model: S.model, speed: S.speed })); } catch { /* not kept */ }
}

// ---------- numbers ----------
const clock = s => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};
const minutes = s => {
  const m = Math.ceil(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

function summary() {
  const el = $('#summary');
  if (!S.doc) { el.innerHTML = '<p class="none">No drawing yet. Draw on the Paint tab, then come back.</p>'; return; }
  const d = S.doc, F = FORMATS[d.format], L = jobLengths(S.steps);
  const count = k => S.steps.filter(s => s.kind === k).length;
  const strokes = new Set(S.steps.map(s => s.stroke)).size;
  const lift = d.paint.lift ?? true;
  el.innerHTML = `<table>
    <tr><td>Format</td><td class="r">${F.label}</td></tr>
    <tr><td>Strokes</td><td class="r">${strokes}</td></tr>
    <tr><td>Passes</td><td class="r">${count('paint')}</td></tr>
    <tr><td>Painted</td><td class="r">${fmt(L.paint * PT_MM / 1000, 2)} m</td></tr>
    <tr><td>Travel, brush off</td><td class="r">${fmt(L.travel * PT_MM / 1000, 2)} m · ${count('travel')}×</td></tr>
    <tr><td>Snake turns</td><td class="r">${count('turn')}</td></tr>
    <tr><td>Mode</td><td class="r">${lift ? 'brush off after each pass' : 'snake'}</td></tr>
    <tr><td>Estimated time</td><td class="r"><b>${minutes(S.tl.total)}</b></td></tr>
  </table>`;
}

// Where the canvas lies on the machine: the corners recorded on the
// Calibration tab (calibration.json through rubens.py). With three corners or
// more the job can be turned into what the board runs.
async function loadCalibration() {
  try {
    const r = await fetch('/calibration', { cache: 'no-store' });
    S.cal = r.ok ? await r.json() : null;
  } catch { S.cal = null; }
}
function machine() {
  const el = $('#machine');
  S.onMachine = null;
  if (!S.doc) { el.innerHTML = ''; return; }
  const corners = S.cal?.corners || {}, n = CORNERS.filter(k => corners[k]).length;
  if (!S.cal) { el.innerHTML = '<p class="none">No calibration: start rubens.py.</p>'; return; }
  if (n < 3) { el.innerHTML = `<p class="none">Record at least three canvas corners on the Calibration tab (${n} so far). Until then the job stays on the artboard.</p>`; return; }
  if (S.cal.format !== S.doc.format) {
    el.innerHTML = `<p class="warn">The corners were recorded for ${FORMATS[S.cal.format]?.label || S.cal.format}, the drawing is ${FORMATS[S.doc.format].label}.</p>`;
    return;
  }
  const F = FORMATS[S.doc.format], rep = canvasReport(corners, F.w, F.h);
  // Corners that do not match the format would stretch the drawing: most
  // likely the tip went to the walls, not to the canvas. Do not place the job.
  const off = rep.edges.filter(e => Math.abs(e.length / e.nominal - 1) > 0.015);
  if (off.length) {
    el.innerHTML = `<p class="warn">The canvas corners give ${off.map(e => `${e.name} ${fmt(e.length)} mm`).join(', ')} against the format's ${fmt(F.w)} × ${fmt(F.h)} mm — the job would be stretched. Record the corners of the canvas itself on the Calibration tab.</p>`;
    return;
  }
  const file = jobFile(S.steps, { formatKey: S.doc.format, format: F, paint: S.doc.paint });
  S.onMachine = { ...jobToMachine(file, rep.fit, { paintMMs: S.model.paintMMs, travelMMs: S.model.travelMMs }), corners: n };
  const b = S.onMachine.blocks, out = S.onMachine.outside;
  const pieces = b.reduce((a, x) => a + (x.cmds ? x.cmds.length : 1), 0);
  el.innerHTML = `<table>
    <tr><td>Canvas from</td><td class="r">${n} corners</td></tr>
    <tr><td>Blocks</td><td class="r">${b.length} · ${pieces} commands</td></tr>
    <tr><td>Brush off / on</td><td class="r">${b.filter(x => x.kind === 'arm').length}×</td></tr>
  </table>` + (out.length
    ? `<p class="warn">${out.length} points past the walls, first at X ${fmt(out[0].x)} · Y ${fmt(out[0].y)} (stroke ${[...new Set(S.steps.map(s => s.stroke))].indexOf(out[0].stroke) + 1}).</p>`
    : '<p>Everything is inside the walls.</p>');
}

function showProgress(at) {
  const total = S.tl ? S.tl.total : 0;
  $('#pct').textContent = at ? `${Math.floor(at.percent)} %` : '—';
  $('#left').textContent = !at ? '—' : at.left <= 0 ? 'done' : `${minutes(at.left)} left`;
  $('#bar').style.width = at ? `${at.percent}%` : '0';
  $('#elapsed').textContent = clock(S.t);
  $('#total').textContent = clock(total);
  $('#scrub').value = total ? Math.round(S.t / total * 1000) : 0;
  let now = '—';
  if (at) {
    const st = S.steps[at.i], n = [...new Set(S.steps.map(s => s.stroke))].indexOf(st.stroke) + 1;
    now = st.kind === 'paint' ? `stroke ${n} · lane ${st.lane} · ${st.dir > 0 ? 'with' : 'against'} the drawing`
      : st.kind === 'turn' ? `stroke ${n} · turn to the next lane` : `travel · brush off the canvas`;
  }
  $('#now').textContent = now;
  // Only when it changes: Safari drops a click on a button whose text is
  // replaced between mouse down and up, and this runs every frame.
  const btn = $('#btnPlay'), label = S.playing ? '❚❚ Pause' : '▶ Play';
  if (btn.textContent !== label) btn.textContent = label;
}

// ---------- the view ----------
const cv = $('#jobView'), ctx = cv.getContext('2d');
function pathOf(segs, upTo, k) {
  // the segments as a canvas path, only the first `upTo` units of them
  let left = upTo, first = true;
  ctx.beginPath();
  for (const g of segs) {
    if (left <= 0) break;
    const L = segLen(g), part = Math.min(1, left / (L || 1));
    if (g.t === 'L') {
      if (first) ctx.moveTo(g.a.x * k, g.a.y * k);
      ctx.lineTo((g.a.x + (g.b.x - g.a.x) * part) * k, (g.a.y + (g.b.y - g.a.y) * part) * k);
    } else {
      const a1 = g.a0 + g.s * part;
      if (first) ctx.moveTo((g.c.x + g.r * Math.cos(g.a0)) * k, (g.c.y + g.r * Math.sin(g.a0)) * k);
      ctx.arc(g.c.x * k, g.c.y * k, g.r * k, g.a0, a1, g.s < 0);
    }
    first = false; left -= L;
  }
}
const inkOf = c => (c && luminance(c) < 0.8 ? c : '#B9B1A2');   // a white pass still shows on paper

function draw(at) {
  const st = $('#stage'), dpr = devicePixelRatio || 1, W = st.clientWidth, H = st.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!S.doc) return;
  const F = FORMATS[S.doc.format], dw = F.w / PT_MM, dh = F.h / PT_MM, pad = 36;
  const k = Math.min((W - 2 * pad) / dw, (H - 2 * pad) / dh);
  const ox = (W - dw * k) / 2, oy = (H - dh * k) / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(40,30,20,.16)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.fillStyle = PAPER; ctx.fillRect(ox, oy, dw * k, dh * k);
  ctx.restore();
  ctx.save(); ctx.translate(ox, oy);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  S.steps.forEach((s, i) => {
    const full = S.steps[i].segs.reduce((a, g) => a + segLen(g), 0);
    const done = !at ? 0 : i < at.i ? full : i === at.i ? at.frac * full : 0;
    const style = (isDone) => {
      ctx.setLineDash(s.kind === 'travel' ? [2, 5] : []);
      if (s.kind === 'paint') { ctx.strokeStyle = inkOf(s.color); ctx.globalAlpha = isDone ? 0.95 : 0.2; ctx.lineWidth = isDone ? 2.2 : 1; }
      else if (s.kind === 'turn') { ctx.strokeStyle = INK; ctx.globalAlpha = isDone ? 0.7 : 0.2; ctx.lineWidth = 1.2; }
      else { ctx.strokeStyle = INK; ctx.globalAlpha = isDone ? 0.45 : 0.15; ctx.lineWidth = 1; }
    };
    style(false); pathOf(s.segs, full, k); ctx.stroke();
    if (done > 0) { style(true); pathOf(s.segs, done, k); ctx.stroke(); }
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;

  if (at) {
    const X = at.x * k, Y = at.y * k;
    ctx.strokeStyle = 'rgba(235,122,37,.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X, -oy); ctx.lineTo(X, H - oy); ctx.moveTo(-ox, Y); ctx.lineTo(W - ox, Y); ctx.stroke();
    if (at.off) {
      ctx.strokeStyle = ORANGE; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, 7, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = ORANGE; ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// ---------- play ----------
let last = 0;
function tick(now) {
  if (!S.playing) return;
  const dt = last ? (now - last) / 1000 : 0; last = now;
  S.t = Math.min(S.tl.total, S.t + dt * S.speed);
  if (S.t >= S.tl.total) S.playing = false;
  render();
  if (S.playing) requestAnimationFrame(tick);
}
function play(on) {
  if (!S.tl || !S.tl.total) return;
  if (on && S.t >= S.tl.total) S.t = 0;
  S.playing = on; last = 0;
  render();
  if (on) requestAnimationFrame(tick);
}
function render() {
  const at = S.tl ? jobAt(S.tl, S.t) : null;
  showProgress(at); draw(at);
}

// A clicked button drops the focus, so Space is not taken by it as well.
$('#btnPlay').onclick = e => { e.currentTarget.blur(); play(!S.playing); };
$('#btnRestart').onclick = () => { S.t = 0; render(); };
$('#scrub').addEventListener('input', e => { if (S.tl) { S.t = e.target.value / 1000 * S.tl.total; render(); } });
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat) return;
  const tag = document.activeElement?.tagName || '';
  if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
  if (tag === 'BUTTON') document.activeElement.blur();   // or the button would click on key up as well
  e.preventDefault();
  play(!S.playing);
});
function syncSpeed() { document.querySelectorAll('#speedSeg button').forEach(b => b.classList.toggle('on', +b.dataset.k === S.speed)); }
$('#speedSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.speed = +b.dataset.k; syncSpeed(); savePrefs(); };

for (const [id, key] of [['#mPaint', 'paintMMs'], ['#mTravel', 'travelMMs'], ['#mSwing', 'swingS']]) {
  const el = $(id);
  el.value = S.model[key];
  el.addEventListener('change', () => {
    const v = +el.value;
    if (!(v > 0 || (key === 'swingS' && v === 0))) { el.value = S.model[key]; return; }
    S.model[key] = v; savePrefs(); build(); summary(); machine(); render();
  });
}

// The drawing changed on the Paint tab (another tab of this browser).
addEventListener('storage', e => { if (e.key === 'rubens.v01') { build(); summary(); machine(); render(); } });
// Back from the Calibration tab: the corners may have changed.
addEventListener('focus', async () => { await loadCalibration(); machine(); });
addEventListener('resize', () => render());

$('#btnSaveJob').onclick = async () => {
  if (!S.doc) return;
  const F = FORMATS[S.doc.format];
  const file = jobFile(S.steps, { formatKey: S.doc.format, format: F, paint: S.doc.paint });
  if (S.onMachine) file.machine = { paintMMs: S.model.paintMMs, travelMMs: S.model.travelMMs, ...S.onMachine };
  const body = JSON.stringify(file, null, 1);
  try {
    const r = await fetch('/job', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    $('#saved').textContent = !r.ok ? 'NOT SAVED' : `job.json saved · ${S.steps.length} steps` + (S.onMachine ? ` · ${S.onMachine.blocks.length} machine blocks` : ' · artboard only, the canvas is not placed on the machine');
  } catch { $('#saved').textContent = 'NOT SAVED · start rubens.py'; }
};

// ---------- start ----------
loadPrefs();
for (const [id, key] of [['#mPaint', 'paintMMs'], ['#mTravel', 'travelMMs'], ['#mSwing', 'swingS']]) $(id).value = S.model[key];
syncSpeed();
build(); summary(); render();
await loadCalibration(); machine();
