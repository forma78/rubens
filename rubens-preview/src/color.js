// Colour: sRGB ↔ linear, HEX parsing, pigment-like mixing. No DOM.

export const toLin = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
export const toSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
export const hexRgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255); };
export const linOf = hex => hex ? hexRgb(hex).map(toLin) : null;
export const isHex = s => /^#?[0-9a-f]{6}$/i.test((s || '').trim());
export const normHex = s => { s = s.trim().toUpperCase(); return s.startsWith('#') ? s : '#' + s; };

// Pigment-like mixing: a geometric mean in linear RGB. Crude, but yellow and
// blue give a greenish colour instead of the grey that plain RGB would give.
export function pigmentMix(a, b, t) { return [0, 1, 2].map(i => Math.exp(Math.log(Math.max(a[i], 0.003)) * (1 - t) + Math.log(Math.max(b[i], 0.003)) * t)); }

export function luminance(hex) { const [r, g, b] = linOf(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
