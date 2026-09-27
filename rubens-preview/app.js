'use strict';
/* =====================================================================
   RUBENS · Brush Preview v0.1 — прототип превью мазков кистью.

   Модель: краска выдавлена на холст заранее, восемь капель поперёк
   кисти. Кисть едет по траектории и тянет каждую каплю своей дорожкой.
   Соседние дорожки смешиваются на границе (Mix), к концу мазка краска
   кончается (сухая кисть).

   Единицы: документ в pt, 1 pt = 25.4/72 мм, масштаб 1:1 с холстом —
   как артборд в Иллюстраторе, выставленный в натуральный размер.
   Траектория: только прямые (L) и дуги окружности (A). Никаких Безье.

   Интерфейс английский (инстаграм), комментарии русские — как в проекте.
   ===================================================================== */

// ---------- константы ----------
const PT_MM = 25.4 / 72;                  // 0.35278 мм в пункте
const FORMATS = {
  p60x80:   { label: 'Paper 60 × 80 cm',   w: 600,  h: 800 },
  p80x60:   { label: 'Paper 80 × 60 cm',   w: 800,  h: 600 },
  c70x100:  { label: 'Canvas 70 × 100 cm', w: 700,  h: 1000 },
  c100x70:  { label: 'Canvas 100 × 70 cm', w: 1000, h: 700 },
  c100x100: { label: 'Canvas 100 × 100 cm', w: 1000, h: 1000 },
};
// Профиль кисти = фактура в превью. Ширину следа задаёт Stroke.
const BRUSHES = {
  flat8:  { label: 'Flat 8 mm',  mm: 8,  streaks: 90, streakAmp: 0.13, gap: 0.10, gapDepth: 0.10, hiChance: 0.035 },
  flat12: { label: 'Flat 12 mm', mm: 12, streaks: 55, streakAmp: 0.22, gap: 0.14, gapDepth: 0.60, hiChance: 0.07 },
};
const WEIGHT_MIN = 1, WEIGHT_MAX = 500;
const WEIGHT_PRESETS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500];
const PAPER = '#EEEAE2';
const K_LEV = 32, N_VAR = 3, P_MAX = 1.35;   // уровни расхода краски в полосках-штампах
const HOLD_MS = 350;                          // сколько держать мышь неподвижно, чтобы сегмент выровнялся
const LANE_ORDER_NOTE = 'Lanes 1–8 run from the left edge to the right edge of the brush, looking along the travel direction.';

const DEFAULT_PALETTES = [
  { id: 'L1', name: 'Ember',   colors: ['#D63A22', '#EC7422', '#5A2B2B', '#5A2B2B', '#5A2B2B', '#EC7422', '#F2C12E', '#FAF8F3'] },
  { id: 'L2', name: 'Indigo',  colors: ['#E3245A', '#7A3A9E', '#1E2C84', '#1E2C84', '#1E2C84', '#1E2C84', '#7A3A9E', '#161616'] },
  { id: 'L3', name: 'Sherbet', colors: ['#EF2F66', '#EF2F66', '#F6CF2F', '#FAF8F3', '#FAF8F3', '#F6CF2F', '#F6CF2F', '#EF2F66'] },
  { id: 'L4', name: 'Custom',  colors: [null, null, null, null, null, null, null, null] },
];

// ---------- утилиты ----------
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const P = (x, y) => ({ x, y });
const sub = (a, b) => P(a.x - b.x, a.y - b.y);
const add = (a, b) => P(a.x + b.x, a.y + b.y);
const len = a => Math.hypot(a.x, a.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const norm = a => { const l = len(a) || 1; return P(a.x / l, a.y / l); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const TAU = Math.PI * 2;
const wrapA = a => { while (a > Math.PI) a -= TAU; while (a <= -Math.PI) a += TAU; return a; };
const mod = (a, m) => ((a % m) + m) % m;
const fmt = (v, d = 1) => Number(v).toFixed(d);
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- цвет ----------
const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const hexRgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255); };
const linOf = hex => hex ? hexRgb(hex).map(toLin) : null;
const isHex = s => /^#?[0-9a-f]{6}$/i.test((s || '').trim());
const normHex = s => { s = s.trim().toUpperCase(); return s.startsWith('#') ? s : '#' + s; };
// Пигментное смешивание: геометрическое среднее в линейном RGB.
// Грубо, но жёлтый с синим даёт зеленоватый, а не серый, как дал бы RGB.
function pigmentMix(a, b, t) { return [0, 1, 2].map(i => Math.exp(Math.log(Math.max(a[i], 0.003)) * (1 - t) + Math.log(Math.max(b[i], 0.003)) * t)); }

// ---------- состояние ----------
const S = {
  format: 'p60x80',
  paths: [],
  palettes: JSON.parse(JSON.stringify(DEFAULT_PALETTES)),
  sel: null,
  selAnchors: [],          // индексы выделенных якорей выбранного мазка
  tool: 'gesture',
  penArc: false,
  angleSnap: 15,
  defaults: { weight: 200, brush: 'flat12', mix: 35, palette: 'L1', load: 'auto', ml: 1 },
  paint: { film: 0.3, retention: 25, nozzle: 6, maxDrop: 1, cornerR: 10 },
  view: { wires: false, drops: false, grid: false, snapGrid: false, cnc: false },
  nextId: 1,
};
const docW = () => FORMATS[S.format].w / PT_MM;
const docH = () => FORMATS[S.format].h / PT_MM;
const pal = id => S.palettes.find(p => p.id === id) || S.palettes[0];
const selPath = () => S.paths.find(p => p.id === S.sel) || null;
const styleOf = () => (selPath() || { style: S.defaults }).style;

function newPath() {
  const id = S.nextId++;
  return { id, segs: [], style: { ...S.defaults }, seed: (Math.random() * 1e9) | 0 };
}

// ---------- геометрия сегментов ----------
// L: {t:'L', a, b}.  A: {t:'A', c, r, a0, s} — центр, радиус, начальный угол, развёртка (со знаком).
// Угол растёт по часовой на экране (ось y вниз), это же sweep-flag=1 в SVG.
const segStart = g => g.t === 'L' ? g.a : P(g.c.x + g.r * Math.cos(g.a0), g.c.y + g.r * Math.sin(g.a0));
const segEnd = g => g.t === 'L' ? g.b : P(g.c.x + g.r * Math.cos(g.a0 + g.s), g.c.y + g.r * Math.sin(g.a0 + g.s));
const segLen = g => g.t === 'L' ? dist(g.a, g.b) : Math.abs(g.s) * g.r;
const arcDir = (g, th) => { const k = Math.sign(g.s) || 1; return P(-Math.sin(th) * k, Math.cos(th) * k); };
const segDirStart = g => g.t === 'L' ? norm(sub(g.b, g.a)) : arcDir(g, g.a0);
const segDirEnd = g => g.t === 'L' ? norm(sub(g.b, g.a)) : arcDir(g, g.a0 + g.s);
function segAt(g, d) {
  if (g.t === 'L') { const u = norm(sub(g.b, g.a)); return { x: g.a.x + u.x * d, y: g.a.y + u.y * d, dx: u.x, dy: u.y }; }
  const L = segLen(g) || 1, th = g.a0 + g.s * (d / L), t = arcDir(g, th);
  return { x: g.c.x + g.r * Math.cos(th), y: g.c.y + g.r * Math.sin(th), dx: t.x, dy: t.y };
}
const pathLen = p => p.segs.reduce((a, g) => a + segLen(g), 0);
function moveSeg(g, d) { if (g.t === 'L') { g.a = add(g.a, d); g.b = add(g.b, d); } else g.c = add(g.c, d); }

// Точки вдоль пути с шагом h. На изломе — «веер»: кисть поворачивается на месте.
function samplePath(p, h) {
  const out = []; let s0 = 0, lastDir = null;
  for (const g of p.segs) {
    const L = segLen(g); if (L < 1e-6) continue;
    const d1 = segDirStart(g);
    if (lastDir) {
      const a0 = Math.atan2(lastDir.y, lastDir.x);
      const da = wrapA(Math.atan2(d1.y, d1.x) - a0);
      if (Math.abs(da) > 0.003) { const q = segStart(g); out.push({ fan: true, x: q.x, y: q.y, a0, da, s: s0 }); }
    }
    const n = Math.max(1, Math.ceil(L / h));
    for (let k = out.length ? 1 : 0; k <= n; k++) { const q = segAt(g, L * k / n); q.s = s0 + L * k / n; out.push(q); }
    s0 += L; lastDir = segDirEnd(g);
  }
  return out;
}

// ---------- выравнивание жеста ----------
function snapAngle(ang) {
  if (!S.angleSnap) return ang;
  const st = rad(S.angleSnap);
  return Math.round(ang / st) * st;
}
function makeLine(a, b, tan) {
  const v = sub(b, a), L = len(v);
  let ang = Math.atan2(v.y, v.x);
  if (tan && Math.abs(wrapA(ang - Math.atan2(tan.y, tan.x))) < rad(8)) ang = Math.atan2(tan.y, tan.x); // продолжение по касательной
  else ang = snapAngle(ang);
  return { t: 'L', a: { ...a }, b: P(a.x + Math.cos(ang) * L, a.y + Math.sin(ang) * L) };
}
// Дуга из точки a, касательная tan, через точку b. Единственная окружность.
function tangentArc(a, tan, b) {
  const d = sub(b, a), n = P(-tan.y, tan.x);
  const dn = dot(d, n); if (Math.abs(dn) < 1e-6) return null;
  const rs = dot(d, d) / (2 * dn);
  const c = P(a.x + n.x * rs, a.y + n.y * rs), r = Math.abs(rs);
  const a0 = Math.atan2(a.y - c.y, a.x - c.x), a1 = Math.atan2(b.y - c.y, b.x - c.x);
  const dirPos = cross(sub(a, c), tan) > 0;
  const s = dirPos ? mod(a1 - a0, TAU) : -mod(a0 - a1, TAU);
  return { t: 'A', c, r, a0, s, tangent: true };
}
// Дуга через три точки.
function arc3(A, M, B) {
  const bx = M.x - A.x, by = M.y - A.y, cx = B.x - A.x, cy = B.y - A.y;
  const d = 2 * (bx * cy - by * cx); if (Math.abs(d) < 1e-6) return null;
  const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
  const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
  const c = P(A.x + ux, A.y + uy), r = Math.hypot(ux, uy);
  const a0 = Math.atan2(A.y - c.y, A.x - c.x), am = Math.atan2(M.y - c.y, M.x - c.x), a1 = Math.atan2(B.y - c.y, B.x - c.x);
  const d1 = mod(a1 - a0, TAU), dm = mod(am - a0, TAU);
  return { t: 'A', c, r, a0, s: dm < d1 ? d1 : d1 - TAU };
}
// Развёртку дуги — к ближайшим 45° (90°, 180° — ровные полукруги).
function snapArc(g) {
  const s = Math.abs(g.s), q = Math.PI / 4, tgt = Math.round(s / q) * q;
  if (tgt > 0 && Math.abs(s - tgt) < rad(14)) g.s = Math.sign(g.s) * tgt;
  g.s = Math.sign(g.s) * Math.min(Math.abs(g.s), TAU - 0.02);
  return g;
}
function arcError(g, raw) { let e = 0; for (const q of raw) e += Math.abs(dist(q, g.c) - g.r); return e / raw.length; }
function halfPoint(raw) {
  let tot = 0; for (let i = 1; i < raw.length; i++) tot += dist(raw[i], raw[i - 1]);
  let acc = 0; for (let i = 1; i < raw.length; i++) { acc += dist(raw[i], raw[i - 1]); if (acc >= tot / 2) return raw[i]; }
  return raw[raw.length >> 1];
}
// Главное: сырой след мыши → один ровный сегment (прямая или дуга).
function fitSegment(raw, anchor, tan, mode, tol) {
  if (raw.length < 2) return null;
  const end = raw[raw.length - 1], ch = sub(end, anchor), L = len(ch);
  if (L < tol * 2) return null;
  const u = norm(ch); let dev = 0;
  for (const q of raw) dev = Math.max(dev, Math.abs(cross(u, sub(q, anchor))));
  const line = mode === 'line' || (mode !== 'arc' && dev < Math.max(tol, 0.085 * L));
  if (line) return makeLine(anchor, end, tan);
  let g = null;
  if (tan) { g = tangentArc(anchor, tan, end); if (g && arcError(g, raw) > 0.16 * g.r + tol) g = null; }
  if (!g) g = arc3(anchor, halfPoint(raw), end);
  if (!g || g.r > 25 * L) return makeLine(anchor, end, tan);
  return snapArc(g);
}
// Добавить сегмент; прямая, продолжающая прямую, склеивается с ней.
function pushSeg(path, g) {
  const prev = path.segs[path.segs.length - 1];
  if (prev && prev.t === 'L' && g.t === 'L') {
    const a = Math.atan2(prev.b.y - prev.a.y, prev.b.x - prev.a.x), b = Math.atan2(g.b.y - g.a.y, g.b.x - g.a.x);
    if (Math.abs(wrapA(a - b)) < rad(0.5)) { prev.b = { ...g.b }; return; }
  }
  delete g.tangent;
  path.segs.push(g);
}


// ---------- скругление углов: одна ось для кисти и для CNC ----------
// Острый излом кисть шириной W пройти не может: внутренние проходы
// перечеркнули бы друг друга. Поэтому каждый излом осевой скругляется
// дугой радиуса W/2 + внутренний радиус. Все восемь проходов тогда —
// параллельные копии этой оси: прямые остаются прямыми, дуги становятся
// концентрическими, и ничто нигде не пересекается.
// Превью рисуется по той же скруглённой оси — экран не врёт.
const filletCache = new Map();
function filleted(p) {
  const W = p.style.weight, rIn = (S.paint.cornerR ?? 10) / PT_MM;
  const key = JSON.stringify([p.segs, W, rIn]);
  const hit = filletCache.get(p.id); if (hit && hit.key === key) return hit.val;
  const src = JSON.parse(JSON.stringify(p.segs)).filter(g => segLen(g) > 1e-6);
  const n = src.length, want = W / 2 + rIn;
  const warn = [];
  // 1. излом на каждом стыке и желаемая длина подрезки
  const J = [];
  for (let i = 0; i < n - 1; i++) {
    const d0 = segDirEnd(src[i]), d1 = segDirStart(src[i + 1]);
    const th = wrapA(Math.atan2(d1.y, d1.x) - Math.atan2(d0.y, d0.x));
    if (Math.abs(th) < rad(0.5)) { J.push(null); continue; }
    const tn = Math.tan(Math.min(Math.abs(th), rad(179)) / 2);
    J.push({ th, tn, t: want * tn });
  }
  // 2. подрезка не длиннее сегмента: если оба конца скругляются — делим пропорционально
  const trimA = new Array(n).fill(0), trimB = new Array(n).fill(0);
  J.forEach((j, i) => { if (j) { trimB[i] = j.t; trimA[i + 1] = j.t; } });
  const scale = src.map((g, i) => { const L = segLen(g), need = trimA[i] + trimB[i]; return need > L ? L / need : 1; });
  J.forEach((j, i) => {
    if (!j) return;
    j.t *= Math.min(scale[i], scale[i + 1]);
    j.R = j.t / j.tn;
    trimB[i] = j.t; trimA[i + 1] = j.t;
    if (j.R < W / 2 - 1e-3) warn.push(segEnd(src[i]));            // угол слишком тесный для этой ширины
  });
  // 3. подрезать сегменты
  const cut = src.map((g, i) => {
    const a = trimA[i], b = trimB[i], L = segLen(g);
    if (g.t === 'L') { const u = norm(sub(g.b, g.a)); return { t: 'L', a: P(g.a.x + u.x * a, g.a.y + u.y * a), b: P(g.b.x - u.x * b, g.b.y - u.y * b) }; }
    const sg = Math.sign(g.s);
    return { t: 'A', c: g.c, r: g.r, a0: g.a0 + sg * a / g.r, s: g.s - sg * (a + b) / g.r };
  });
  // дуги самого рисунка, которые уже меньше W/2
  src.forEach(g => { if (g.t === 'A' && g.r < W / 2 - 1e-3) warn.push(segAt(g, segLen(g) / 2)); });
  // 4. собрать ось: сегмент, скругление, сегмент…
  const out = [];
  cut.forEach((g, i) => {
    if (segLen(g) > 1e-4) out.push(g);
    const j = J[i]; if (!j) return;
    const P0 = segEnd(g), P1 = segStart(cut[i + 1]);
    const f = tangentArc(P0, segDirEnd(src[i]), P1);
    if (f && isFinite(f.r) && f.r > 1e-3) { delete f.tangent; out.push(f); }
    else if (dist(P0, P1) > 1e-4) out.push({ t: 'L', a: P0, b: P1 });
  });
  const val = { segs: out, warn };
  filletCache.set(p.id, { key, val });
  return val;
}
// Параллельная копия оси на расстоянии off (плюс — вправо по ходу).
function offsetSegs(segs, off) {
  const out = [];
  for (const g of segs) {
    let h;
    if (g.t === 'L') { const u = norm(sub(g.b, g.a)); h = { t: 'L', a: P(g.a.x - u.y * off, g.a.y + u.x * off), b: P(g.b.x - u.y * off, g.b.y + u.x * off) }; }
    else {
      const r = g.r - Math.sign(g.s) * off;          // правый поворот (s > 0): справа центр, радиус уменьшается
      if (r < 0.5) continue;                          // дуга схлопнулась — мост ниже соединит соседей
      h = { t: 'A', c: g.c, r, a0: g.a0, s: g.s };
    }
    const prev = out[out.length - 1];
    if (prev && dist(segEnd(prev), segStart(h)) > 0.05) out.push({ t: 'L', a: segEnd(prev), b: segStart(h) });
    out.push(h);
  }
  return out;
}

// ---------- краска: расчёт ----------
// Всё в мм и мл. Слой краски (film) и то, что остаётся в кисти (retention), —
// предположения, их надо откалибровать первым тестом (см. Rubens_v2.md, раздел 8).
function traceMM(p) { return p.style.weight * PT_MM; }
function laneMM(p) { return traceMM(p) / 8; }
function lengthMM(p) { return pathLen({ segs: filleted(p).segs }) * PT_MM; }
function mlNeeded(p) { const k = S.paint; return lengthMM(p) * laneMM(p) * k.film * (1 + k.retention / 100) / 1000; }
function mlPerDrop(p) { return p.style.load === 'manual' ? Math.max(0.001, +p.style.ml || 0) : mlNeeded(p); }
// Сколько мм пройдёт кисть до конца чистого следа.
function cleanReachMM(p) { const k = S.paint; return mlPerDrop(p) * 1000 / (1 + k.retention / 100) / (laneMM(p) * k.film); }
function beadMM(ml) { const d = S.paint.nozzle; return ml * 1000 / (Math.PI * d * d / 4); }
function blobMM(ml) { return 2 * Math.cbrt(3 * ml * 1000 / (2 * Math.PI)); } // диаметр капли-полусферы

// ---------- полоски-штампы ----------
// Поперечный срез кисти: одна строка пикселей на ширину следа.
// Для каждого уровня расхода краски (K_LEV) и варианта сухой кисти (N_VAR).
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
function getStrips(colors, mix, bk, N, seed) {
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
    const mixE = m + (1 - m) * 0.3 * Math.min(1, p);      // к концу мазка дорожки размазываются сильнее
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
        if (!c0 && !c1) { col = [1, 1, 1]; a = 0; }             // пустая ячейка — краски нет
        else if (!c0) { col = c1; a = w; }
        else if (!c1) { col = c0; a = 1 - w; }
        else { col = pigmentMix(c0, c1, w); a = 1; }
        // щербинки между каплями: у широкой кисти дорожки не всегда сходятся
        if (i0 >= 0 && i0 < 7) { const gg = Math.exp(-Math.pow((fr - 0.5) / br.gap, 2)); a *= 1 - br.gapDepth * (1 - mixE * 0.85) * gg * (0.5 + 0.5 * bristle[j]); }
        // щетина: продольные полосы
        const sh = 1 + br.streakAmp * (bristle[j] - 0.5) * 2;
        col = col.map(c => clamp(c * sh, 0, 1));
        if (hil[j]) col = col.map(c => c + (0.8 - c) * hil[j]);
        // кромка: краска собирается у края, край рваный
        const e = Math.min(u, 1 - u);
        if (e < 0.05) col = col.map(c => c * (0.84 + 0.16 * smooth(0.008, 0.05, e)));
        a *= smooth(0, 0.01 + 0.012 * bristle[j], e);
        // сухая кисть
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

// ---------- отрисовка краски ----------
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
// k — пикселей на pt в этом контексте.
function renderPaint(ctx, k, W, H) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = paperPattern(ctx); ctx.fillRect(0, 0, W, H);
  for (const p of S.paths) renderPath(ctx, p, k);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
function renderPath(ctx, p, k) {
  if (!p.segs.length) return;
  const st = p.style, wpx = st.weight * k;
  const N = clamp(Math.round(wpx), 6, 1400);
  const strips = getStrips(pal(st.palette).colors, st.mix, st.brush, N, p.seed);
  const step = 0.6 / k, hpx = 1.7;
  const reach = cleanReachMM(p) / PT_MM;  // в pt
  const samples = samplePath({ segs: filleted(p).segs }, step);
  const R = rng(p.seed ^ 0x5bd1);
  let n = 0, variant = 0;
  ctx.imageSmoothingEnabled = true;
  // неровный нажим вдоль мазка: сумма двух медленных волн со случайной фазой
  const ph1 = R() * TAU, ph2 = R() * TAU, per = Math.max(st.weight * 2.2, 40);
  const press = s => 0.9 + 0.06 * Math.sin(s / per * TAU + ph1) + 0.04 * Math.sin(s / (per * 0.37) * TAU + ph2);
  const stamp = (x, y, dx, dy, s) => {
    const pr = s / reach; if (pr >= P_MAX) return;
    const lev = Math.min(K_LEV - 1, Math.floor(pr / P_MAX * K_LEV));
    if ((n++ % 7) === 0) variant = (R() * N_VAR) | 0;
    // ось x штампа — поперёк хода, слева направо; ось y — вдоль хода
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

// ---------- экран ----------
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
  if (paintDirty) { paintDirty = false; renderPaint(pctx, kCss * dpr, paintCv.width, paintCv.height); save(); updatePanel(); }
  if (G) holdTick();
  drawWire();
  if (G) kick();
}

// ---------- проволока: пути, якоря, подсказки ----------
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
  for (const p of S.paths) {
    const selected = p.id === S.sel;
    if (!p.segs.length) continue;
    if (S.view.drops) drawDrops(c, p, k);
    if (!S.view.wires && !selected) continue;   // выделенный путь виден всегда
    c.beginPath(); tracePath(c, p.segs, k);
    c.strokeStyle = selected ? '#3D6BFF' : 'rgba(61,107,255,.55)'; c.lineWidth = selected ? 1.4 : 1; c.stroke();
    if (selected) {
      // якоря
      c.fillStyle = '#fff'; c.strokeStyle = '#3D6BFF'; c.lineWidth = 1;
      const pts = [segStart(p.segs[0]), ...p.segs.map(segEnd)];
      pts.forEach((q, i) => {
        const on = S.selAnchors.includes(i), h = on ? 4 : 3;
        c.fillStyle = on ? '#3D6BFF' : '#fff';
        c.fillRect(q.x * k - h, q.y * k - h, 2 * h, 2 * h); c.strokeRect(q.x * k - h, q.y * k - h, 2 * h, 2 * h);
      });
      // начало: порядок дорожек 1…8
      laneLabels(c, p, k);
    }
  }
  // активный жест
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
function drawGrid(c, k) {
  const step = 10 / PT_MM; // 10 мм
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
// План капель: восемь колбасок краски у начала мазка, в натуральную величину.
function drawDrops(c, p, k) {
  const q = segAt(p.segs[0], 0), r = P(-q.dy, q.dx), w = p.style.weight;
  const ml = mlPerDrop(p), nozPt = S.paint.nozzle / PT_MM, bead = beadMM(ml) / PT_MM;
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

// ---------- ввод: общий ----------
function evPt(e) { const r = wireCv.getBoundingClientRect(); return P((e.clientX - r.left) / kCss, (e.clientY - r.top) / kCss); }
const tol = () => 5 / kCss;
function snapGridPt(q) { if (!S.view.snapGrid) return q; const st = 10 / PT_MM; return P(Math.round(q.x / st) * st, Math.round(q.y / st) * st); }

// история
let undoStack = [], redoStack = [];
const snapshot = () => JSON.stringify({ paths: S.paths, sel: S.sel, palettes: S.palettes });
function undoPush() { undoStack.push(snapshot()); if (undoStack.length > 200) undoStack.shift(); redoStack = []; }
let lastSoftPush = 0;
function undoPushSoft() { const t = performance.now(); if (t - lastSoftPush > 700) undoPush(); lastSoftPush = t; }
function restore(js) { const o = JSON.parse(js); S.paths = o.paths; S.sel = o.sel; S.selAnchors = S.selAnchors.filter(i => { const p = S.paths.find(q => q.id === S.sel); return p && i <= p.segs.length; }); S.palettes = o.palettes; renderPalettes(); invalidate(); }
function undo() { finishAll(); if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }

// ---------- жест: веди медленно, остановись — выровняется ----------
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
  G.prov = fitSegment(G.raw, G.anchor, G.tan, G.mode, tol());
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

// ---------- перо: клик — точка, A/Alt — касательная дуга ----------
let PEN = null;
function penSeg(q, e) {
  const wantArc = (S.penArc !== !!e.altKey) && PEN.tan;
  if (wantArc) { const g = tangentArc(PEN.anchor, PEN.tan, q); if (g) return snapArc(g); }
  if (dist(q, PEN.anchor) < tol()) return null;
  return makeLine(PEN.anchor, q, PEN.tan);
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

// ---------- выделение и перенос ----------
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


// ---------- правка якорей ----------
// Якорь i: 0 — начало первого сегмента, i — конец сегмента i-1.
// Прямая просто тянется за якорем. Дуга сохраняет развёртку: полукруг
// остаётся полукругом, меняются радиус и поворот. Касательность с соседями
// при этом может разойтись — стык рисуется поворотом кисти на месте.
const anchorsOf = p => p.segs.length ? [segStart(p.segs[0]), ...p.segs.map(segEnd)] : [];
function anchorHit(q) {
  const p = selPath(); if (!p) return null;
  const pts = anchorsOf(p), lim = 7 / kCss;
  let best = null, bd = lim;
  pts.forEach((a, i) => { const d = dist(a, q); if (d < bd) { bd = d; best = i; } });
  return best;
}
function rebuildArc(g, A, B, side) {
  const c = sub(B, A), L = len(c); if (L < 1e-6) return;
  const hs = Math.abs(g.s) / 2, r = L / 2 / Math.sin(hs);
  const n = P(-c.y / L, c.x / L), d = r * Math.cos(hs);   // cos<0 при дуге больше 180° — центр уходит на другую сторону сам
  const C = P((A.x + B.x) / 2 + n.x * d * side, (A.y + B.y) / 2 + n.y * d * side);
  g.c = C; g.r = r; g.a0 = Math.atan2(A.y - C.y, A.x - C.x);
}
// Сдвинуть выбранные якоря на delta от исходного состояния (без накопления ошибки).
function applyAnchorMove(p, orig, idx, delta) {
  const moved = new Set(idx);
  const origPts = anchorsOf({ segs: orig });
  p.segs = orig.map((g0, j) => {
    const g = JSON.parse(JSON.stringify(g0));
    const ma = moved.has(j), mb = moved.has(j + 1);
    if (!ma && !mb) return g;
    if (ma && mb) { moveSeg(g, delta); return g; }
    const A = ma ? add(origPts[j], delta) : origPts[j];
    const B = mb ? add(origPts[j + 1], delta) : origPts[j + 1];
    if (g.t === 'L') { g.a = A; g.b = B; return g; }
    const ch = sub(origPts[j + 1], origPts[j]);
    // с какой стороны хорды стоял центр, считая «как для малой дуги»
    const side = Math.sign(cross(ch, sub(g0.c, origPts[j]))) * (Math.abs(g0.s) > Math.PI ? -1 : 1) || 1;
    rebuildArc(g, A, B, side);
    return g;
  });
}
let AD = null;   // перетаскивание якорей
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

// ---------- клавиатура ----------
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

// ---------- инструменты и вид ----------
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

// ---------- панель ----------
function setStyle(key, val, soft) {
  soft ? undoPushSoft() : undoPush();
  S.defaults[key] = val;                          // последнее выбранное — по умолчанию для новых
  const p = selPath(); if (p) p.style[key] = val;
  invalidate();
}
// логарифмический бегунок толщины: 1…300 pt
const wToSlider = w => Math.round(Math.log(w / WEIGHT_MIN) / Math.log(WEIGHT_MAX / WEIGHT_MIN) * 1000);
const sliderToW = v => { const w = WEIGHT_MIN * Math.pow(WEIGHT_MAX / WEIGHT_MIN, v / 1000); return w < 10 ? Math.round(w * 2) / 2 : Math.round(w); };
function setWeight(w, soft) { w = clamp(+w || 1, WEIGHT_MIN, WEIGHT_MAX); setStyle('weight', w, soft); }
$('#wSlider').oninput = e => setWeight(sliderToW(+e.target.value), true);
$('#wNum').onchange = e => setWeight(+e.target.value);
$('#wMinus').onclick = () => { const w = styleOf().weight; setWeight(w > 10 ? w - 5 : w - 1); };
$('#wPlus').onclick = () => { const w = styleOf().weight; setWeight(w >= 10 ? w + 5 : w + 1); };
$('#wPreset').innerHTML = '<option value="">…</option>' + WEIGHT_PRESETS.map(w => `<option value="${w}">${w} pt</option>`).join('');
$('#wPreset').onchange = e => { if (e.target.value) setWeight(+e.target.value); e.target.value = ''; };
$('#mix').oninput = e => setStyle('mix', +e.target.value, true);

$('#brushSeg').innerHTML = Object.entries(BRUSHES).map(([k, b]) => {
  const bars = Array.from({ length: b.mm === 8 ? 8 : 12 }, () => `<i style="width:2px;height:${14 + Math.random() * 4}px"></i>`).join('');
  return `<button data-brush="${k}"><span class="bico">${bars}</span>${b.label}</button>`;
}).join('');
document.querySelectorAll('#brushSeg button').forEach(b => b.onclick = () => setStyle('brush', b.dataset.brush));

$('#film').onchange = e => { S.paint.film = Math.max(0.05, +e.target.value || 0.3); invalidate(); };
$('#ret').onchange = e => { S.paint.retention = Math.max(0, +e.target.value || 0); invalidate(); };
$('#nozzle').onchange = e => { S.paint.nozzle = Math.max(0.3, +e.target.value || 6); invalidate(); };
$('#cornerR').onchange = e => { S.paint.cornerR = Math.max(0, +e.target.value || 0); invalidate(); };
$('#maxdrop').onchange = e => { S.paint.maxDrop = Math.max(0.05, +e.target.value || 1); invalidate(); };
document.querySelectorAll('input[name=load]').forEach(r => r.onchange = () => setStyle('load', r.value));
$('#ml').onchange = e => { setStyle('ml', Math.max(0.01, +e.target.value || 0.1)); setStyle('load', 'manual'); };

$('#format').innerHTML = Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
$('#format').onchange = e => { S.format = e.target.value; layout(); save(); };
$('#anglesnap').onchange = e => { S.angleSnap = +e.target.value; save(); };

// палитры
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

// срез кисти в панели
function drawXsec() {
  const cv = $('#xsec'), w = cv.clientWidth, h = 44, d = window.devicePixelRatio || 1;
  cv.width = w * d; cv.height = h * d;
  const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = PAPER; c.fillRect(0, 0, cv.width, cv.height);
  const st = styleOf(), N = Math.round(w * d);
  const strips = getStrips(pal(st.palette).colors, st.mix, st.brush, N, 12345);
  c.imageSmoothingEnabled = false;
  for (let y = 0; y < cv.height; y++) {
    const lev = Math.min(K_LEV - 1, Math.floor((1 - y / cv.height) * 0.55 * K_LEV)); // сверху свежая краска, снизу — ближе к концу
    c.drawImage(strips[lev][y % N_VAR], 0, 1, N, 1, 0, y, N, 1);
  }
}

function updatePanel() {
  const p = selPath(), st = styleOf();
  const tn = $('#targetName'); tn.textContent = p ? `Stroke ${String(S.paths.indexOf(p) + 1).padStart(2, '0')}` : 'New stroke'; tn.classList.toggle('sel', !!p);
  if (document.activeElement !== $('#wNum')) $('#wNum').value = st.weight;
  $('#wSlider').value = wToSlider(st.weight);
  $('#wRead').innerHTML = `Trace <b>${fmt(st.weight * PT_MM, 1)} mm</b> wide · each lane ${fmt(st.weight * PT_MM / 8, 1)} mm`;
  document.querySelectorAll('#brushSeg button').forEach(b => b.classList.toggle('on', b.dataset.brush === st.brush));
  // CNC: восемь проходов этой кистью, шаг = stroke / 8
  const B = BRUSHES[st.brush], pitch = st.weight * PT_MM / 8, fullPt = B.mm * 8 / PT_MM, gap = pitch - B.mm;
  let note = '';
  if (gap > 0.5) note = ` <span class="warn">Gaps of ${fmt(gap, 1)} mm between passes.</span>`;
  else if (gap < -0.5) note = ` <span class="warn">Passes overlap by ${fmt(-gap, 1)} mm.</span>`;
  $('#bRead').innerHTML = `CNC runs <b>8 passes</b> of the ${B.mm} mm brush, ${fmt(pitch, 1)} mm apart.${note}` +
    (Math.abs(gap) > 0.5 ? ` <button class="link" id="matchBrush">Stroke = 8 × ${B.mm} mm (${fmt(fullPt, 0)} pt)</button>` : '');
  const mb = $('#matchBrush'); if (mb) mb.onclick = () => setWeight(Math.round(fullPt));
  $('#mix').value = st.mix; $('#mixVal').textContent = st.mix + '%';
  document.querySelectorAll('input[name=load]').forEach(r => r.checked = r.value === st.load);
  if (document.activeElement !== $('#ml')) $('#ml').value = st.ml;
  for (const [id, v] of [['film', S.paint.film], ['ret', S.paint.retention], ['nozzle', S.paint.nozzle], ['maxdrop', S.paint.maxDrop ?? 1], ['cornerR', S.paint.cornerR ?? 10]]) if (document.activeElement !== $('#' + id)) $('#' + id).value = v;
  document.querySelectorAll('.pal').forEach(el => el.classList.toggle('on', el.dataset.pal === st.palette));
  drawXsec();
  updateMath(p);
  const tot = S.paths.reduce((a, q) => a + lengthMM(q), 0);
  let nPass = 0, cncL = 0;
  if (S.view.cnc) for (const q of S.paths) if (q.segs.length) for (const ps of cncPlan(q).passes) { nPass++; cncL += ps.Lmm; }
  $('#stats').textContent = `${S.paths.filter(q => q.segs.length).length} strokes · ${fmt(tot / 10, 0)} cm of path` + (S.view.cnc ? ` · CNC ${nPass} passes, ${fmt(cncL / 1000, 2)} m` : '');
}

function updateMath(p) {
  const m = $('#math');
  if (!p || !p.segs.length) { m.innerHTML = '<p class="none">Select a stroke to see how much paint each drop needs.</p>'; }
  else {
    const plan = cncPlan(p), ps = plan.passes, L = lengthMM(p), lane = plan.pitchMM;
    const total = ps.reduce((a, q) => a + q.n * q.ml, 0), nd = ps.reduce((a, q) => a + q.n, 0);
    const big = ps.reduce((a, q) => Math.max(a, q.ml), 0), bead = beadMM(big), blob = blobMM(big);
    const refill = ps.filter(q => q.n > 1).length;
    let warn = '';
    if (S.paint.nozzle > lane) warn += `<p class="warn">Nozzle ${fmt(S.paint.nozzle, 1)} mm is wider than the pass pitch (${fmt(lane, 1)} mm): beads of neighbouring passes will touch.</p>`;
    if (plan.warn.length) warn += `<p class="warn">${plan.warn.length} spot${plan.warn.length > 1 ? 's are' : ' is'} too tight for a ${fmt(traceMM(p), 0)} mm trace — inner passes would cross (marked ! in CNC Trace). Open the corner or thin the stroke.</p>`;
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
  // проходы выбранного мазка
  const pe = $('#passes');
  if (!p || !p.segs.length) pe.innerHTML = '<p class="none">Select a stroke.</p>';
  else {
    const plan = cncPlan(p);
    pe.innerHTML = plan.passes.length ? '<table class="lanes">' + plan.passes.map(ps =>
      `<tr><td class="n">${ps.lane}</td><td><span class="chip" style="background:${ps.color}"></span><span class="mono">${ps.color}</span></td><td class="r">${fmt(ps.Lmm / 10, 1)} cm</td><td class="r">${ps.n} × ${fmt(ps.ml, 2)} ml</td></tr>`).join('') + '</table>'
      : '<p class="none">This load is empty — no passes.</p>';
  }
  // сводка по всем мазкам: сколько каждого цвета выдавить (по плану CNC, с доливками)
  const agg = new Map();
  for (const q of S.paths) {
    if (!q.segs.length) continue;
    for (const ps of cncPlan(q).passes) { const a = agg.get(ps.color) || { n: 0, ml: 0 }; a.n += ps.n; a.ml += ps.n * ps.ml; agg.set(ps.color, a); }
  }
  $('#squeeze').innerHTML = agg.size ? '<table>' + [...agg.entries()].sort((a, b) => b[1].ml - a[1].ml).map(([c, a]) =>
    `<tr><td><span class="chip" style="background:${c}"></span><span class="mono">${c}</span></td><td class="r">${a.n} drop${a.n > 1 ? 's' : ''}</td><td class="r">${fmt(a.ml, 2)} ml</td></tr>`).join('') + '</table>'
    : '<p class="none">Nothing drawn yet.</p>';
}


// ---------- CNC Trace: восемь проходов кисти ----------
// Линия на экране — это восемь проходов CNC одной кистью. Проход i идёт
// параллельно осевой, со сдвигом ((i+0.5)/8 − 0.5) × ширина следа.
// Шаг между проходами = stroke / 8; для кисти 12 мм это 96 мм = 272 pt.
// Проход 1 — левый край, если смотреть по ходу, как и в превью.
// На внешней стороне излома проход огибает угол дугой, на внутренней —
// срезается в точке пересечения (петля выбрасывается).
const cncCache = new Map();
function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i], pts[i - 1]); return L; }
function polyAt(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i], pts[i - 1]);
    if (acc + d >= s) { const t = d ? (s - acc) / d : 0; return P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t); }
    acc += d;
  }
  return pts[pts.length - 1];
}
// План на мазок: проходы, их длина, сколько капель и где их выдавить.
function cncPlan(p) {
  const cols = pal(p.style.palette).colors;
  const key = JSON.stringify([p.segs, p.style, cols, S.paint]);
  const hit = cncCache.get(p.id); if (hit && hit.key === key) return hit.plan;
  const W = p.style.weight, pitchMM = W * PT_MM / 8, k = S.paint;
  const perMM = pitchMM * k.film * (1 + k.retention / 100) / 1000;   // мл на мм прохода
  const F = filleted(p), axis = F.segs;
  const passes = [];
  for (let i = 0; i < 8; i++) {
    if (!cols[i]) continue;                                            // пустая ячейка — прохода нет
    const segs = offsetSegs(axis, ((i + 0.5) / 8 - 0.5) * W);
    const pts = samplePath({ segs }, 1 / PT_MM).filter(q => !q.fan).map(q => P(q.x, q.y));
    const Lmm = polyLen(pts) * PT_MM, need = Lmm * perMM;
    let n, ml;
    if (p.style.load === 'manual') { ml = Math.max(0.001, +p.style.ml || 0); n = Math.max(1, Math.ceil(need / ml)); }
    else { n = Math.max(1, Math.ceil(need / Math.max(0.01, k.maxDrop))); ml = need / n; }
    const spacing = polyLen(pts) / n;
    const drops = Array.from({ length: n }, (_, j) => ({ at: polyAt(pts, j * spacing), s: j * spacing }));
    passes.push({ lane: i + 1, color: cols[i], segs, pts, Lmm, need, n, ml, drops });
  }
  const plan = { passes, pitchMM, axis, warn: F.warn };
  cncCache.set(p.id, { key, plan });
  return plan;
}
function drawCnc(c, k) {
  c.fillStyle = 'rgba(238,234,226,.72)'; c.fillRect(0, 0, docW() * k, docH() * k);   // приглушить краску
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.font = '600 10px ' + getComputedStyle(document.body).getPropertyValue('--sans');
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const p of S.paths) {
    if (!p.segs.length) continue;
    const plan = cncPlan(p), dim = S.sel && p.id !== S.sel;
    c.globalAlpha = dim ? 0.45 : 1;
    // ось — по ней едут моторы; сама она не красит (девятой капли нет)
    c.beginPath(); tracePath(c, plan.axis, k); c.setLineDash([7, 5]);
    c.strokeStyle = 'rgba(36,34,31,.6)'; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
    for (const ps of plan.passes) {
      c.beginPath(); tracePath(c, ps.segs, k);
      c.strokeStyle = 'rgba(36,34,31,.55)'; c.lineWidth = 3; c.stroke();         // «карандаш»
      c.beginPath(); tracePath(c, ps.segs, k);
      c.strokeStyle = ps.color; c.lineWidth = 1.6; c.stroke();
      ps.drops.forEach((d, j) => {
        const x = d.at.x * k, y = d.at.y * k;
        c.beginPath(); c.arc(x, y, j ? 5 : 7, 0, TAU);
        c.fillStyle = ps.color; c.fill(); c.strokeStyle = '#24221F'; c.lineWidth = 1.2; c.stroke();
        if (!j) { c.fillStyle = luminance(ps.color) > 0.5 ? '#24221F' : '#fff'; c.fillText(ps.lane, x, y + .5); }
      });
    }
  }
  c.globalAlpha = 1;
  // тесные места: здесь внутренние проходы не помещаются
  for (const p of S.paths) {
    if (!p.segs.length) continue;
    for (const q of cncPlan(p).warn) {
      c.beginPath(); c.arc(q.x * k, q.y * k, 13, 0, TAU); c.strokeStyle = '#D9481C'; c.lineWidth = 2; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#D9481C'; c.fillText('!', q.x * k, q.y * k);
    }
  }
  c.textAlign = 'start'; c.textBaseline = 'alphabetic'; c.lineCap = 'butt';
}
function luminance(hex) { const [r, g, b] = linOf(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

// Экспорт для машины: проходы по порядку + метки капель для карандаша.
// Линия для машины — просто траектория: чёрная, 1 мм, как след карандаша.
// Цвет прохода остаётся только справкой в data-color.
const PEN_PT = Math.round(1000 / PT_MM) / 1000;   // 1 мм в pt
function exportCNC() {
  finishAll();
  const f = FORMATS[S.format], W = docW(), H = docH();
  const drawn = S.paths.filter(p => p.segs.length);
  const circ = (q, r) => `M${r3(q.x - r)} ${r3(q.y)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(q.x + r)} ${r3(q.y)} A${r3(r)} ${r3(r)} 0 0 1 ${r3(q.x - r)} ${r3(q.y)}`;
  let body = '', marks = '', nPass = 0, total = 0;
  drawn.forEach((p, si) => {
    const plan = cncPlan(p), sid = `stroke-${String(si + 1).padStart(2, '0')}`, B = BRUSHES[p.style.brush];
    body += `<g id="${sid}" data-palette="${pal(p.style.palette).name}" data-brush="${p.style.brush}" data-pitch-mm="${fmt(plan.pitchMM, 2)}">\n`;
    for (const ps of plan.passes) {
      nPass++; total += ps.Lmm;
      body += `  <path id="${sid}-pass-${ps.lane}" data-lane="${ps.lane}" data-color="${ps.color}" data-length-mm="${fmt(ps.Lmm, 1)}" data-drops="${ps.n}" data-drop-ml="${fmt(ps.ml, 3)}" d="${pathD({ segs: ps.segs })}" fill="none" stroke="#000000" stroke-width="${PEN_PT}" stroke-linecap="round" stroke-linejoin="round"/>\n`;
      ps.drops.forEach((d, j) => {
        marks += `  <path id="${sid}-pass-${ps.lane}-drop-${j + 1}" data-lane="${ps.lane}" data-color="${ps.color}" data-ml="${fmt(ps.ml, 3)}" data-at-mm="${fmt(d.s * PT_MM, 1)}" d="${circ(d.at, 3 / PT_MM)}" fill="none" stroke="#000000" stroke-width="${PEN_PT}"/>\n`;
      });
    }
    body += `</g>\n`;
  });
  const s = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f.w}mm" height="${f.h}mm" viewBox="0 0 ${r3(W)} ${r3(H)}">
<!-- RUBENS CNC Trace v0.1 · ${f.label}
     1 user unit = 1 pt = ${PT_MM.toFixed(5)} mm.
     group "passes": ${nPass} brush passes, ${fmt(total / 1000, 2)} m in total. Each stroke = up to 8 passes,
       lane 1 → 8, all in the drawing direction. Pass i is offset from the centre line by
       ((i + 0.5) / 8 − 0.5) × stroke width. Empty palette slots have no pass.
     group "drop-marks": Ø 6 mm circles where paint is squeezed before the brush pass
       (data-ml = how much). Run "drop-marks" with a pencil first, or the passes too as a pencil guide.
     All lines are black, 1 mm wide (pencil); colour is only in data-color, for reference.
     Geometry: M, L and A only. Passes are exact parallel copies of the centre line;
       every corner of the drawing is rounded (inner radius ${fmt(S.paint.cornerR ?? 10, 0)} mm) so passes never cross. -->
<g id="passes">
${body}</g>
<g id="drop-marks">
${marks}</g>
</svg>
`;
  download(new Blob([s], { type: 'image/svg+xml' }), `rubens-cnc-${stamp()}.svg`);
}

// ---------- экспорт SVG ----------
const r3 = v => Math.round(v * 1000) / 1000;
function pathD(p) {
  let d = '', first = true;
  for (const g of p.segs) {
    const a = segStart(g);
    if (first) { d += `M${r3(a.x)} ${r3(a.y)}`; first = false; }
    if (g.t === 'L') d += ` L${r3(g.b.x)} ${r3(g.b.y)}`;
    else {
      // дуги больше 180° режем пополам — так надёжнее для любого парсера
      const parts = Math.abs(g.s) > Math.PI ? 2 : 1;
      for (let i = 1; i <= parts; i++) {
        const th = g.a0 + g.s * i / parts;
        d += ` A${r3(g.r)} ${r3(g.r)} 0 0 ${g.s > 0 ? 1 : 0} ${r3(g.c.x + g.r * Math.cos(th))} ${r3(g.c.y + g.r * Math.sin(th))}`;
      }
    }
  }
  return d;
}
function exportSVG() {
  finishAll();
  const f = FORMATS[S.format], W = docW(), H = docH();
  const drawn = S.paths.filter(p => p.segs.length);
  const state = { rubens: '0.1', format: S.format, paint: S.paint, palettes: S.palettes, paths: drawn };
  let s = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${f.w}mm" height="${f.h}mm" viewBox="0 0 ${r3(W)} ${r3(H)}">
<!-- RUBENS Brush Preview v0.1 · ${f.label}
     1 user unit = 1 pt = ${PT_MM.toFixed(5)} mm. Strokes in drawing order, one <g> per brush pass.
     Geometry: M, L and A only (straight lines and circular arcs, no Béziers).
     ${LANE_ORDER_NOTE} -->
<metadata id="rubens-state">${JSON.stringify(state).replace(/--/g, '- -')}</metadata>
`;
  drawn.forEach((p, i) => {
    const pl = pal(p.style.palette);
    s += `<g id="stroke-${String(i + 1).padStart(2, '0')}" data-palette="${pl.name}" data-lanes="${pl.colors.map(c => c || 'empty').join(' ')}" data-brush="${p.style.brush}" data-mix="${p.style.mix}" data-drop-ml="${fmt(mlPerDrop(p), 3)}" data-length-mm="${fmt(lengthMM(p), 1)}">
  <path d="${pathD(p)}" fill="none" stroke="#000000" stroke-width="${p.style.weight}" stroke-linecap="butt" stroke-linejoin="round"/>
</g>
`;
  });
  s += '</svg>\n';
  download(new Blob([s], { type: 'image/svg+xml' }), `rubens-${stamp()}.svg`);
}
function stamp() { const d = new Date(), z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`; }
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
function exportPNG() {
  finishAll();
  const long = 4000, k = long / Math.max(docW(), docH());
  const cv = document.createElement('canvas'); cv.width = Math.round(docW() * k); cv.height = Math.round(docH() * k);
  renderPaint(cv.getContext('2d'), k, cv.width, cv.height);
  cv.toBlob(b => download(b, `rubens-${stamp()}.png`), 'image/png');
}
$('#btnSvg').onclick = exportSVG;
$('#btnPng').onclick = exportPNG;
$('#btnCnc').onclick = exportCNC;

// ---------- импорт SVG ----------
$('#btnImport').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = async e => { const f = e.target.files[0]; if (!f) return; importSVG(await f.text()); e.target.value = ''; };
function importSVG(text) {
  finishAll();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const meta = doc.querySelector('metadata#rubens-state');
  undoPush();
  if (meta) {                          // свой файл — восстанавливаем точно
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
// Чужой SVG (Иллюстратор): любые кривые разбиваются на короткие прямые.
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
      if (prev && dist(q, prev) > step * sc * 4) flush();   // разрыв между подпутями
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
function simplify(pts, eps) { // Рамер — Дуглас — Пекер
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], u = norm(sub(b, a)); let mx = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(cross(u, sub(pts[i], a))); if (d > mx) { mx = d; idx = i; } }
  if (mx < eps) return [a, b];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

// ---------- сохранение в браузере ----------
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem('rubens.v01', JSON.stringify({ format: S.format, paths: S.paths.filter(p => p.segs.length), palettes: S.palettes, defaults: S.defaults, paint: S.paint, view: S.view, angleSnap: S.angleSnap, nextId: S.nextId })); } catch (e) { }
  }, 300);
}
function load() {
  try {
    const o = JSON.parse(localStorage.getItem('rubens.v01') || 'null'); if (!o) return false;
    Object.assign(S, { format: o.format, paths: o.paths, palettes: o.palettes, defaults: o.defaults, paint: o.paint, view: o.view, angleSnap: o.angleSnap, nextId: o.nextId });
    if (!FORMATS[S.format]) S.format = 'p60x80';
    return true;
  } catch (e) { return false; }
}

// ---------- демо-композиция при первом запуске ----------
// Путь из команд: ['L', длина] — прямо; ['R'|'T', радиус, градусы] — поворот направо/налево по дуге.
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

// ---------- старт ----------
async function loadDefault() {
  // default.svg рядом с index.html — рисунок, который открывается «с нуля».
  // Сделать своим: Export SVG → сохранить как rubens-preview/default.svg.
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
renderPalettes(); syncTools(); syncView();
new ResizeObserver(layout).observe(stage);
layout();
if (fresh) loadDefault();
$('#btnDefault').onclick = () => { finishAll(); loadDefault().then(ok => { if (!ok) { undoPush(); demo(); invalidate(); } }); };
