// Small math helpers: clamping, 2D vectors, angles, number formatting and a
// seeded random generator. No DOM.

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const P = (x, y) => ({ x, y });
export const sub = (a, b) => P(a.x - b.x, a.y - b.y);
export const add = (a, b) => P(a.x + b.x, a.y + b.y);
export const len = a => Math.hypot(a.x, a.y);
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const norm = a => { const l = len(a) || 1; return P(a.x / l, a.y / l); };
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export const TAU = Math.PI * 2;
export const wrapA = a => { while (a > Math.PI) a -= TAU; while (a <= -Math.PI) a += TAU; return a; };
export const mod = (a, m) => ((a % m) + m) % m;
export const fmt = (v, d = 1) => Number(v).toFixed(d);
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
