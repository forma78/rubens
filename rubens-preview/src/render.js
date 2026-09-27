// Paint rendering on a canvas. A stamp strip is a cross-section of the brush:
// one row of pixels across the trace, for every paint level and dry-brush
// variant. Strips are stamped along the rounded centre line (fillet.js), so the
// preview follows the same line as the CNC. Needs a canvas (browser only).

import { BRUSHES, PAPER, K_LEV, N_VAR, P_MAX, PT_MM } from './config.js';
import { clamp, smooth, rng, TAU } from './util.js';
import { toSrgb, linOf, pigmentMix } from './color.js';
import { samplePath } from './geometry.js';
import { filleted } from './fillet.js';
import { cleanReachMM } from './paint.js';

// ---------- stamp strips ----------
// One row of pixels across the trace width, for every paint level (K_LEV)
// and dry-brush variant (N_VAR).
const stripCache = new Map();
function smoothNoise(N, count, R) {
  const m = Math.max(3, Math.round(count)); const ctrl = Array.from({ length: m + 2 }, R);
  const out = new Float32Array(N);
  for (let j = 0; j < N; j++) {
    const x = j / N * m, i = Math.floor(x), f = x - i, w = (1 - Math.cos(f * Math.PI)) / 2;
    out[j] = (ctrl[i] * (1 - w) + ctrl[i + 1] * w) * 0.7 + R() * 0.3;
  }
  return out;
}
export function getStrips(colors, mix, bk, N, seed) {
  const key = colors.join(',') + '|' + mix + '|' + bk + '|' + N + '|' + seed;
  if (stripCache.has(key)) return stripCache.get(key);
  if (stripCache.size > 80) stripCache.clear();
  const br = BRUSHES[bk], R = rng(seed), lin = colors.map(linOf), m = mix / 100;
  const bristle = smoothNoise(N, br.streaks, R);
  const thresh = smoothNoise(N, br.streaks * 1.7, R);
  const hil = Array.from({ length: N }, () => R() < br.hiChance ? 0.2 + 0.35 * R() : 0);
  const levels = [];
  for (let l = 0; l < K_LEV; l++) {
    const p = (l + 0.5) / K_LEV * P_MAX;
    const mixE = m + (1 - m) * 0.3 * Math.min(1, p);      // lanes smear more towards the end of the stroke
    const dry = smooth(0.95, P_MAX, p);
    const vars = [];
    for (let v = 0; v < N_VAR; v++) {
      const cv = document.createElement('canvas'); cv.width = N; cv.height = 3;
      const cx = cv.getContext('2d'), img = cx.createImageData(N, 3), D = img.data;
      for (let j = 0; j < N; j++) {
        const u = (j + 0.5) / N, lp = u * 8 - 0.5; let i0 = Math.floor(lp); const fr = lp - i0;
        let c0, c1, w = 0;
        if (i0 < 0) { c0 = c1 = lin[0]; } else if (i0 >= 7) { c0 = c1 = lin[7]; }
        else { c0 = lin[i0]; c1 = lin[i0 + 1]; const h = 0.03 + 0.5 * mixE; w = smooth(0.5 - h, 0.5 + h, fr); }
        let col, a;
        if (!c0 && !c1) { col = [1, 1, 1]; a = 0; }             // empty slot — no paint
        else if (!c0) { col = c1; a = w; }
        else if (!c1) { col = c0; a = 1 - w; }
        else { col = pigmentMix(c0, c1, w); a = 1; }
        // small gaps between drops: on a wide brush the lanes do not always meet
        if (i0 >= 0 && i0 < 7) { const gg = Math.exp(-Math.pow((fr - 0.5) / br.gap, 2)); a *= 1 - br.gapDepth * (1 - mixE * 0.85) * gg * (0.5 + 0.5 * bristle[j]); }
        // bristles: streaks along the stroke
        const sh = 1 + br.streakAmp * (bristle[j] - 0.5) * 2;
        col = col.map(c => clamp(c * sh, 0, 1));
        if (hil[j]) col = col.map(c => c + (0.8 - c) * hil[j]);
        // the edge: paint gathers at the edge, the edge is ragged
        const e = Math.min(u, 1 - u);
        if (e < 0.05) col = col.map(c => c * (0.84 + 0.16 * smooth(0.008, 0.05, e)));
        a *= smooth(0, 0.01 + 0.012 * bristle[j], e);
        // dry brush
        if (dry > 0) { const vt = thresh[j] * 0.7 + R() * 0.3; a *= smooth(dry - 0.12, dry + 0.12, vt); a *= 1 - 0.3 * dry; }
        const r = Math.round(toSrgb(col[0]) * 255), gch = Math.round(toSrgb(col[1]) * 255), b = Math.round(toSrgb(col[2]) * 255), al = Math.round(clamp(a, 0, 1) * 255);
        for (let y = 0; y < 3; y++) { const o = (y * N + j) * 4; D[o] = r; D[o + 1] = gch; D[o + 2] = b; D[o + 3] = al; }
      }
      cx.putImageData(img, 0, 0); vars.push(cv);
    }
    levels.push(vars);
  }
  stripCache.set(key, levels);
  return levels;
}

// ---------- painting ----------
let paperTile = null;
function paperPattern(ctx) {
  if (!paperTile) {
    paperTile = document.createElement('canvas'); paperTile.width = paperTile.height = 256;
    const c = paperTile.getContext('2d'), im = c.createImageData(256, 256), R = rng(7);
    for (let i = 0; i < im.data.length; i += 4) { const v = R(); im.data[i] = im.data[i + 1] = im.data[i + 2] = v > 0.5 ? 255 : 0; im.data[i + 3] = Math.round(Math.abs(v - 0.5) * 22); }
    c.putImageData(im, 0, 0);
  }
  return ctx.createPattern(paperTile, 'repeat');
}
// k — pixels per pt in this context; colorsOf(p) — the eight drops of a stroke.
export function renderPaint(ctx, k, W, H, paths, colorsOf, paint) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = paperPattern(ctx); ctx.fillRect(0, 0, W, H);
  for (const p of paths) renderPath(ctx, p, k, colorsOf(p), paint);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
export function renderPath(ctx, p, k, colors, paint) {
  if (!p.segs.length) return;
  const st = p.style, wpx = st.weight * k;
  const N = clamp(Math.round(wpx), 6, 1400);
  const strips = getStrips(colors, st.mix, st.brush, N, p.seed);
  const step = 0.6 / k, hpx = 1.7;
  const reach = cleanReachMM(p, paint) / PT_MM;  // in pt
  const samples = samplePath({ segs: filleted(p, paint.cornerR).segs }, step);
  const R = rng(p.seed ^ 0x5bd1);
  let n = 0, variant = 0;
  ctx.imageSmoothingEnabled = true;
  // uneven pressure along the stroke: two slow waves with a random phase
  const ph1 = R() * TAU, ph2 = R() * TAU, per = Math.max(st.weight * 2.2, 40);
  const press = s => 0.9 + 0.06 * Math.sin(s / per * TAU + ph1) + 0.04 * Math.sin(s / (per * 0.37) * TAU + ph2);
  const stamp = (x, y, dx, dy, s) => {
    const pr = s / reach; if (pr >= P_MAX) return;
    const lev = Math.min(K_LEV - 1, Math.floor(pr / P_MAX * K_LEV));
    if ((n++ % 7) === 0) variant = (R() * N_VAR) | 0;
    // stamp x axis runs across the travel, left to right; y axis runs along it
    ctx.globalAlpha = press(s);
    ctx.setTransform(-dy, dx, dx, dy, x * k, y * k);
    ctx.drawImage(strips[lev][variant], 0, 1, N, 1, -wpx / 2, -hpx / 2, wpx, hpx);
  };
  for (const q of samples) {
    if (q.fan) {
      const steps = Math.ceil(Math.abs(q.da) * wpx / 2 / 0.6);
      for (let j = 1; j < steps; j++) { const a = q.a0 + q.da * j / steps; stamp(q.x, q.y, Math.cos(a), Math.sin(a), q.s); }
    } else stamp(q.x, q.y, q.dx, q.dy, q.s);
  }
  ctx.globalAlpha = 1;
}
