// Job page: the drawing from the Create tab as the machine will run it — every
// pass, travel and turn in order (job.js), played on a clock with the percent
// painted and the minutes left, like a 3D printer. On screen only: nothing
// here talks to the machine.

import { PT_MM, FORMATS, PAPER } from './config.js';
import { fmt, clamp } from './util.js';
import { luminance } from './color.js';
import { segLen } from './geometry.js';
import { jobSteps, jobLengths, jobTimeline, jobAt, jobFile, timeAtPercent, MODES, PER_LANE, TIME_MODEL } from './job.js';
import { canvasReport, jobToMachine, arcSpeed, SPEED_MAX, CORNERS } from './machine.js';
import './ui.js';
import { segments, sticks } from './lcd.js';

const $ = s => document.querySelector(s);
const INK = '#24221F', ORANGE = '#EB7A25';

const S = { doc: null, steps: [], tl: null, t: 0, mode: 'pencil', perLane: 4, model: { ...TIME_MODEL }, cal: null, onMachine: null, fit: null, run: null };

// ---------- the drawing and the plan ----------
// The Create tab keeps its drawing in this browser; read it from there.
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
  S.steps = jobSteps(d.paths.filter(p => p.segs.length), colorsOf, d.paint, S.mode, S.perLane);
  S.tl = jobTimeline(S.steps, S.model);
  S.t = frac * S.tl.total;
}

// Per-viewer settings: the time model, Pencil or Brush.
function loadPrefs() {
  try {
    const o = JSON.parse(localStorage.getItem('rubens.job.v01') || 'null');
    if (o?.model) Object.assign(S.model, o.model);
    if (MODES.includes(o?.mode)) S.mode = o.mode;
    if (PER_LANE.includes(o?.perLane)) S.perLane = o.perLane;
  } catch { /* defaults */ }
}
function savePrefs() {
  try { localStorage.setItem('rubens.job.v01', JSON.stringify({ model: S.model, mode: S.mode, perLane: S.perLane })); } catch { /* not kept */ }
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
  if (!S.doc) { el.innerHTML = '<p class="none">No drawing yet. Draw on the Create tab, then come back.</p>'; return; }
  const d = S.doc, F = FORMATS[d.format], L = jobLengths(S.steps);
  const count = k => S.steps.filter(s => s.kind === k).length;
  const strokes = new Set(S.steps.map(s => s.stroke)).size;
  const lift = d.paint.lift ?? true;
  el.innerHTML = `<table>
    <tr><td>Format</td><td class="r">${F.label}</td></tr>
    <tr><td>Strokes</td><td class="r">${strokes}</td></tr>
    <tr><td>${S.mode === 'brush' ? 'Trips' : 'Passes'}</td><td class="r">${count('paint')}</td></tr>
    <tr><td>Painted</td><td class="r">${fmt(L.paint * PT_MM / 1000, 2)} m</td></tr>
    <tr><td>Travel, brush off</td><td class="r">${fmt(L.travel * PT_MM / 1000, 2)} m · ${count('travel')}×</td></tr>
    <tr><td>Turns, brush down</td><td class="r">${count('turn')}</td></tr>
    <tr><td>Between lanes</td><td class="r">${lift ? 'brush off' : S.mode === 'brush' ? 'one line' : 'snake'}</td></tr>
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
  S.onMachine = null; S.fit = null;
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
  const file = jobFile(S.steps, { formatKey: S.doc.format, format: F, paint: S.doc.paint, mode: S.mode, perLane: S.perLane });
  S.fit = rep.fit;
  S.onMachine = { ...jobToMachine(file, rep.fit, { paintMMs: S.model.paintMMs, travelMMs: S.model.travelMMs }), corners: n };
  const b = S.onMachine.blocks, cut = S.onMachine.skipped;
  const pieces = b.reduce((a, x) => a + (x.cmds ? x.cmds.length : 1), 0);
  el.innerHTML = `<table>
    <tr><td>Canvas from</td><td class="r">${n} corners</td></tr>
    <tr><td>Blocks</td><td class="r">${b.length} · ${pieces} commands</td></tr>
    <tr><td>Brush off / on</td><td class="r">${b.filter(x => x.kind === 'arm').length}×</td></tr>
  </table>` + (cut.length
    ? `<p>Past the walls the machine does not paint: ${fmt(S.onMachine.skippedMM / 1000, 2)} m of passes are left out (strokes ${strokeList(cut)}). The rest is painted.</p>`
    : '<p>Everything is inside the walls.</p>');
}

// Stroke numbers as on screen (1, 2, 3…) for a list of steps or cuts.
const strokeList = items => {
  const order = [...new Set(S.steps.map(s => s.stroke))];
  return [...new Set(items.map(o => order.indexOf(o.stroke) + 1))].sort((a, b) => a - b).join(', ');
};

// The progress is the machine's (the owner, 2026-09-28: the on-screen play
// was of no use, and its giant 0 % sat beside a running machine). Idle, it
// shows the plan and the estimated time. While a run is live the marker
// follows the runner's painted percent; the time left is measured from the
// start of the run once there is enough of it, otherwise the time model's.
function showProgress(at) {
  const total = S.tl ? S.tl.total : 0, live = runLive();
  const pct = live ? (S.run.percent || 0) : at?.percent;
  let left = at?.left;
  if (live && S.run.started && pct >= 3) left = (Date.now() / 1000 - S.run.started) * (100 - pct) / pct;
  let now = '—';
  if (at) {
    const st = S.steps[at.i], n = [...new Set(S.steps.map(s => s.stroke))].indexOf(st.stroke) + 1;
    now = st.kind === 'paint' ? `stroke ${n} · lane ${st.lane} · ${st.back ? 'down' : 'up'}`
      : st.kind === 'turn' ? `stroke ${n} · turn` : 'travel · brush off';
  }
  // The LCD (the owner's clock reference): what it shows, the percent in
  // seven segments, the time left and the total, the sticks, where it is.
  const state = !live ? (S.run && S.run.state !== 'idle' ? S.run.state : 'plan') : S.run.state === 'paused' ? 'paused' : 'live';
  const block = live && S.run.blocks ? `block ${S.run.block + 1}/${S.run.blocks}` : S.steps.length ? `${S.steps.filter(s => s.kind === 'paint').length} passes` : '';
  // fixed cells, as on an electronic clock: "07:42", " 51" — the hundreds
  // cell is there, unlit, until 100 %
  const hms = t => { const c = clock(Math.max(0, t || 0)); return c.length === 4 ? '0' + c : c; };
  const pct3 = v => { const n = Math.min(100, Math.max(0, Math.floor(v))); return n === 100 ? '100' : ' ' + String(n).padStart(2, '0'); };
  $('#lcd').innerHTML = `
    <div class="lcd-top"><span>${state === 'live' ? '▶ ' : state === 'paused' ? '❚❚ ' : ''}${state}</span><span>${block}</span></div>
    <div class="lcd-mid">
      <div class="lcd-big">${segments(at ? pct3(pct) : ' --', 46)}<span class="u">%</span></div>
      <div class="lcd-times">
        <span class="k">left</span>${segments(at ? hms(left) : '--:--', 17)}
        <span class="k">total</span>${segments(at ? hms(total) : '--:--', 17)}
      </div>
    </div>
    ${sticks(at ? pct / 100 : 0)}
    <div class="lcd-now">${now}</div>`;
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

  // The brush on the machine, from the runner's ping: machine mm back onto
  // the artboard through the canvas fit.
  const live = S.run && S.fit && S.run.x_mm != null && S.run.y_mm != null && S.run.state !== 'idle';
  if (live) {
    const f = S.fit, det = f.a * f.e - f.b * f.d, x = S.run.x_mm - f.c, y = S.run.y_mm - f.f;
    const u = (f.e * x - f.b * y) / det, v = (-f.d * x + f.a * y) / det;   // mm on the artboard
    const X = u / PT_MM * k, Y = v / PT_MM * k;
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X, Y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = S.run.brush_on ? INK : 'rgba(36,34,31,.25)'; ctx.beginPath(); ctx.arc(X, Y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '10px "SF Mono", ui-monospace, Menlo, monospace'; ctx.fillText('machine', X + 13, Y + 4);
  }
  if (at && !live) {
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

function render() {
  const at = S.tl ? jobAt(S.tl, S.t) : null;
  showProgress(at); draw(at);
}

// Pencil: one trip per lane. Brush: every lane there and back without
// leaving the canvas (job.js). Between lanes the Create tab's "Brush off after
// each pass" still decides.
// Pass speed, ×1 = 20 mm/s (the owner, 2026-09-28: faster, or the paint
// dries). It is the Paint field of the time model, which is what the machine
// gets. Tight arcs stay slower: jobToMachine, arcSpeed.
const SPEED_1X = 20;
function syncSpeedX() {
  const v = S.model.paintMMs, live = runLive();
  document.querySelectorAll('#speedX button').forEach(b => {
    b.classList.toggle('on', SPEED_1X * +b.dataset.x === v);
    b.disabled = live;
  });
  const turn = arcSpeed(v, 5.5);
  $('#speedNote').innerHTML = `Passes at <b>${fmt(Math.min(v, SPEED_MAX), 0)} mm/s</b>`
    + (turn < v ? `; tight arcs slower — the 5.5 mm turns of Brush at ${turn} mm/s.` : '.')
    + (v > 100 ? ' <span class="warn">Faster than any run so far (travel is 100 mm/s): try it with a pencil first.</span>' : '');
}
$('#speedX').onclick = e => {
  const b = e.target.closest('button');
  if (!b || runLive()) return;
  S.model.paintMMs = SPEED_1X * +b.dataset.x; $('#mPaint').value = S.model.paintMMs;
  savePrefs(); build(); summary(); machine(); render(); syncSpeedX();
};

function syncMode() {
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode));
  document.querySelectorAll('#perLaneSeg button').forEach(b => b.classList.toggle('on', +b.dataset.n === S.perLane));
  $('#perLaneSeg').hidden = S.mode !== 'brush';
  const W = S.doc ? Math.max(...S.doc.paths.filter(p => p.segs.length).map(p => p.style.weight), 0) * PT_MM : 0;
  const apart = W ? ` — ${fmt(W / 8 / S.perLane, 1)} mm apart on the widest stroke` : '';
  $('#modeNote').textContent = S.mode === 'brush'
    ? `Every lane in ${S.perLane} trips on the canvas: up, a semicircle, down${S.perLane > 2 ? ', and again' : ''}, a lane / ${S.perLane} apart${apart}. The brush stays down in the lane.`
    : 'One trip per lane, bottom to top.';
}
$('#perLaneSeg').onclick = e => {
  const b = e.target.closest('button');
  if (!b || +b.dataset.n === S.perLane || runLive()) return;
  S.perLane = +b.dataset.n; savePrefs(); syncMode(); build(); summary(); machine(); render();
};
$('#modeSeg').onclick = e => {
  const b = e.target.closest('button');
  if (!b || b.dataset.m === S.mode || runLive()) return;   // the plan on screen must stay the running one
  S.mode = b.dataset.m; savePrefs(); syncMode(); build(); summary(); machine(); render();
};

for (const [id, key] of [['#mPaint', 'paintMMs'], ['#mTravel', 'travelMMs'], ['#mSwing', 'swingS']]) {
  const el = $(id);
  el.value = S.model[key];
  el.addEventListener('change', () => {
    const v = +el.value;
    if (!(v > 0 || (key === 'swingS' && v === 0))) { el.value = S.model[key]; return; }
    S.model[key] = v; savePrefs(); build(); summary(); machine(); render(); syncSpeedX();
  });
}

// The drawing changed on the Create tab (another tab of this browser).
addEventListener('storage', e => { if (e.key === 'rubens.v01') { build(); syncMode(); summary(); machine(); render(); } });
// Back from the Calibration tab: the corners may have changed.
addEventListener('focus', async () => { await loadCalibration(); machine(); });
addEventListener('resize', () => render());

async function saveJob() {
  if (!S.doc) return false;
  const F = FORMATS[S.doc.format];
  const file = jobFile(S.steps, { formatKey: S.doc.format, format: F, paint: S.doc.paint, mode: S.mode, perLane: S.perLane });
  if (S.onMachine) file.machine = { paintMMs: S.model.paintMMs, travelMMs: S.model.travelMMs, ...S.onMachine };
  const body = JSON.stringify(file, null, 1);
  try {
    const r = await fetch('/job', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    $('#saved').textContent = !r.ok ? 'NOT SAVED' : `job.json saved · ${S.steps.length} steps` + (S.onMachine ? ` · ${S.onMachine.blocks.length} machine blocks` : ' · artboard only, the canvas is not placed on the machine');
    return r.ok;
  } catch { $('#saved').textContent = 'NOT SAVED · start rubens.py'; return false; }
}
$('#btnSaveJob').onclick = saveJob;

// ---------- ⚡️ Do Job: the run on the machine ----------
// rubens.py runs the job; the page only starts it and asks how it goes. The
// run does not depend on this tab: closing it does not stop the machine.
const runLive = () => !!S.run && ['running', 'stopping', 'pausing', 'paused'].includes(S.run.state);
$('#btnDoJob').onclick = async e => {
  e.currentTarget.blur();
  if (!S.doc) return;
  if (runLive()) { alert('The machine is already running this job.'); return; }
  if (!S.onMachine) { alert('The canvas is not placed on the machine: see the Machine section.'); return; }
  const cut = S.onMachine.skipped;
  const note = cut.length ? `Past the walls nothing is painted: ${fmt(S.onMachine.skippedMM / 1000, 2)} m of passes left out (strokes ${strokeList(cut)}).\n\n` : '';
  if (!confirm('The machine will move now: the brush swings off and on, the carriage travels and paints the whole job.\n\n' + note
    + 'Is the canvas clamped? Is the pencil or brush in the holder? Is home set?\n\n'
    + 'STOP or Esc brakes along the path; HARD STOP stops at once.')) return;
  if (!(await saveJob())) return;
  const r = await fetch('/run', { method: 'POST' }).catch(() => null);
  const msg = r ? await r.text() : 'start rubens.py';
  if (!r || !r.ok) { S.run = { state: 'error', message: msg, percent: 0, block: 0, blocks: 0 }; showRun(); return; }
  pollRun();
};
let runTimer = 0;
async function pollRun() {
  clearTimeout(runTimer);
  try { S.run = await (await fetch('/run', { cache: 'no-store' })).json(); } catch { /* keep the last */ }
  showRun();
  if (runLive()) runTimer = setTimeout(pollRun, 300);
}
function showRun() {
  const st = S.run, live = runLive();
  // While it runs the progress above is the machine's; this line is for how
  // the run ended: done, stopped, or an error and where it stopped.
  const over = !!st && !live && st.state !== 'idle';
  $('#runState').hidden = !over;
  if (over) {
    const blocks = st.state !== 'done' && st.blocks ? ` · at block ${st.block + 1} of ${st.blocks}` : '';
    $('#runState').innerHTML = `<b>Machine: ${st.state}</b> · ${fmt(st.percent || 0, 1)} % painted${blocks}`
      + (st.message ? `<br><span class="warn">${st.message}</span>` : '');
  }
  const hint = $('#progHint'), paused = live && st.state === 'paused';
  hint.textContent = !live ? 'the plan, by painted length' : paused ? 'the machine, paused' : 'the machine, live';
  hint.classList.toggle('live', live);
  // One button: Pause while it runs, Continue once it waits. Only when the
  // label changes: Safari drops a click on a button whose text is replaced
  // between mouse down and up.
  const pb = $('#btnRunPause'), label = paused ? '▶ Continue' : st?.state === 'pausing' ? 'Pausing…' : '❚❚ Pause';
  if (pb.textContent !== label) pb.textContent = label;
  pb.disabled = !live || !['running', 'paused'].includes(st.state);
  pb.classList.toggle('go', paused);   // dark, not orange: STOP next to it is the orange one
  document.querySelectorAll('#modeSeg button, #perLaneSeg button').forEach(b => { b.disabled = live; });
  syncSpeedX();
  if (live && S.tl) S.t = timeAtPercent(S.tl, st.percent || 0);
  if (!live && st?.state === 'done' && S.tl) S.t = S.tl.total;
  render();
}
async function pauseOrContinue() {
  const st = S.run?.state;
  if (st !== 'running' && st !== 'paused') return;
  await fetch(st === 'paused' ? '/run/continue' : '/run/pause', { method: 'POST' }).catch(() => {});
  pollRun();
}
$('#btnRunPause').onclick = e => { e.currentTarget.blur(); pauseOrContinue(); };
// Space pauses a running machine; it never continues one: the hands may be
// at the holder.
addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat) return;
  const tag = document.activeElement?.tagName || '';
  if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(tag)) return;
  e.preventDefault();
  if (S.run?.state === 'running') pauseOrContinue();
});
// The brush by hand: the wrist to +90° (off the canvas) or 0° (on it).
async function brush(where) {
  const r = await fetch('/brush/' + where, { method: 'POST' }).catch(() => null);
  const msg = r ? await r.text() : 'start rubens.py';
  $('#brushState').innerHTML = r && r.ok && msg.startsWith('ok J')
    ? `Brush ${where === 'off' ? 'off the canvas · +90°' : 'on the canvas · 0°'}`
    : `<span class="warn">${msg}</span>`;
}
$('#btnBrushOff').onclick = e => { e.currentTarget.blur(); brush('off'); };
$('#btnBrushOn').onclick = e => { e.currentTarget.blur(); brush('on'); };

// STOP and HARD STOP never depend on the state: each one goes to the runner
// (so the job ends) and straight to the motors (so they stop even if the
// runner or the page are wrong). 2026-09-27: they once did nothing.
function machineStop(hard) {
  const a = hard ? 'K' : 'S';
  fetch('/machine/cmd?a=' + a + '&n=0').catch(() => {});
  fetch(hard ? '/run/kill' : '/run/stop', { method: 'POST' }).catch(() => {}).then(pollRun);
}
$('#btnRunStop').onclick = e => { e.currentTarget.blur(); machineStop(false); };
$('#btnRunKill').onclick = e => { e.currentTarget.blur(); machineStop(true); };
addEventListener('keydown', e => { if (e.key === 'Escape') machineStop(false); });

// ---------- start ----------
loadPrefs();
for (const [id, key] of [['#mPaint', 'paintMMs'], ['#mTravel', 'travelMMs'], ['#mSwing', 'swingS']]) $(id).value = S.model[key];
build(); syncMode(); syncSpeedX();
summary(); render();
await loadCalibration(); machine();
pollRun();   // a run may already be going: show it
