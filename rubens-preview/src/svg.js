// The drawing as SVG: export with the full state in <metadata>, and the
// Ramer–Douglas–Peucker simplification used when importing foreign SVG.
// No DOM here (the import itself needs the browser and lives in app.js).

import { PT_MM, LANE_ORDER_NOTE } from './config.js';
import { sub, norm, cross, fmt } from './util.js';
import { pathD, r3 } from './geometry.js';
import { mlPerDrop, lengthMM } from './paint.js';

// formatKey — key in FORMATS, format — its entry; paletteOf(p) comes from the page.
export function drawingSvg({ formatKey, format, paths, palettes, paint, paletteOf }) {
  const W = format.w / PT_MM, H = format.h / PT_MM;
  const drawn = paths.filter(p => p.segs.length);
  const state = { rubens: '0.1', format: formatKey, paint, palettes, paths: drawn };
  let s = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${format.w}mm" height="${format.h}mm" viewBox="0 0 ${r3(W)} ${r3(H)}">
<!-- RUBENS Brush Preview v0.1.3 · ${format.label}
     1 user unit = 1 pt = ${PT_MM.toFixed(5)} mm. Strokes in drawing order, one <g> per stroke.
     Geometry: M, L and A only (straight lines and circular arcs, no Béziers).
     ${LANE_ORDER_NOTE} -->
<metadata id="rubens-state">${JSON.stringify(state).replace(/--/g, '- -')}</metadata>
`;
  drawn.forEach((p, i) => {
    const pl = paletteOf(p);
    s += `<g id="stroke-${String(i + 1).padStart(2, '0')}" data-palette="${pl.name}" data-lanes="${pl.colors.map(c => c || 'empty').join(' ')}" data-brush="${p.style.brush}" data-mix="${p.style.mix}" data-drop-ml="${fmt(mlPerDrop(p, paint), 3)}" data-length-mm="${fmt(lengthMM(p, paint), 1)}">
  <path d="${pathD(p)}" fill="none" stroke="#000000" stroke-width="${p.style.weight}" stroke-linecap="butt" stroke-linejoin="round"/>
</g>
`;
  });
  s += '</svg>\n';
  return s;
}

// Ramer–Douglas–Peucker: drop points closer than eps to the line.
export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], u = norm(sub(b, a)); let mx = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(cross(u, sub(pts[i], a))); if (d > mx) { mx = d; idx = i; } }
  if (mx < eps) return [a, b];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}
