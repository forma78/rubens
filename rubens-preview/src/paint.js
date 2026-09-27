// Paint math, in mm and ml. The paint film and what stays in the brush
// (retention) are assumptions until the first test calibrates them
// (Rubens_v2.md, section 8). No DOM here.
//
// paint = { film (mm), retention (%), nozzle (mm), maxDrop (ml), cornerR (mm) }

import { PT_MM } from './config.js';
import { pathLen } from './geometry.js';
import { filleted } from './fillet.js';

export function traceMM(p) { return p.style.weight * PT_MM; }
export function laneMM(p) { return traceMM(p) / 8; }
export function lengthMM(p, paint) { return pathLen({ segs: filleted(p, paint.cornerR).segs }) * PT_MM; }
export function mlNeeded(p, paint) { return lengthMM(p, paint) * laneMM(p) * paint.film * (1 + paint.retention / 100) / 1000; }
export function mlPerDrop(p, paint) { return p.style.load === 'manual' ? Math.max(0.001, +p.style.ml || 0) : mlNeeded(p, paint); }
// How many mm the brush travels before the clean trace ends.
export function cleanReachMM(p, paint) { return mlPerDrop(p, paint) * 1000 / (1 + paint.retention / 100) / (laneMM(p) * paint.film); }
export function beadMM(ml, nozzle) { return ml * 1000 / (Math.PI * nozzle * nozzle / 4); }
export function blobMM(ml) { return 2 * Math.cbrt(3 * ml * 1000 / (2 * Math.PI)); } // diameter of a hemispherical drop
