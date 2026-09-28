// An LCD, like the owner's clock reference (images_CNC_drawing_machine/
// "Screenshot 2026-09-28 at 10.52.30 PM.png"): seven-segment digits with the
// unlit segments faintly there, and a bar of sticks. Returns SVG / HTML
// strings; style.css colours them (.lcd .seg-on, .lcd .bars i.on).

//   a
// f   b
//   g
// e   c
//   d
const LIT = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc',
  7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '',
};

function digit(ch, x, H) {
  const w = 0.56 * H, t = 0.13 * H, g = 0.035 * H, h = t / 2;
  const hs = (x0, x1, y) => `${x0},${y} ${x0 + h},${y - h} ${x1 - h},${y - h} ${x1},${y} ${x1 - h},${y + h} ${x0 + h},${y + h}`;
  const vs = (xc, y0, y1) => `${xc},${y0} ${xc + h},${y0 + h} ${xc + h},${y1 - h} ${xc},${y1} ${xc - h},${y1 - h} ${xc - h},${y0 + h}`;
  const L = h + g, R = w - h - g;
  const seg = {
    a: hs(x + L, x + R, h), g: hs(x + L, x + R, H / 2), d: hs(x + L, x + R, H - h),
    f: vs(x + h, h + g, H / 2 - g), b: vs(x + w - h, h + g, H / 2 - g),
    e: vs(x + h, H / 2 + g, H - h - g), c: vs(x + w - h, H / 2 + g, H - h - g),
  };
  const on = LIT[ch] ?? '';
  return Object.entries(seg).map(([k, pts]) => `<polygon points="${pts}"${on.includes(k) ? ' class="seg-on"' : ''}/>`).join('');
}

// Digits, ':' and ' ' at height H (px). A colon is narrower than a digit.
export function segments(text, H) {
  const w = 0.56 * H, gap = 0.2 * H, t = 0.13 * H;
  let x = 0, out = '';
  for (const ch of String(text)) {
    if (ch === ':') {
      out += `<rect class="seg-on" x="${x}" y="${0.28 * H}" width="${t}" height="${t}"/><rect class="seg-on" x="${x}" y="${0.62 * H}" width="${t}" height="${t}"/>`;
      x += t + gap;
    } else {
      out += digit(ch, x, H);
      x += w + gap;
    }
  }
  const W = Math.max(0, x - gap) + 0.1 * H;   // room for the slant
  return `<svg class="segs" width="${W.toFixed(1)}" height="${H}" viewBox="0 0 ${W.toFixed(1)} ${H}"><g transform="skewX(-6) translate(${(0.1 * H).toFixed(1)} 0)">${out}</g></svg>`;
}

// A bar of `n` sticks, the first `lit` of them dark.
export function sticks(fraction, n = 48) {
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * n);
  return `<div class="bars">${Array.from({ length: n }, (_, i) => `<i${i < lit ? ' class="on"' : ''}></i>`).join('')}</div>`;
}
