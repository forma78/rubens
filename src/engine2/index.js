export { S, RATIOS, dom } from './state.js';
export { PRESETS, SPARE, ink, inkOf, shadeOf, COLC } from './ink.js';
export { barCell, barPanel, barRibbons } from './bars.js';
export { svgOut, frame, canonicalFrame, CANONICAL_BASE } from './svg.js';
/* the cloth itself is model 1's, re-exported so index2.html has one import */
export { mk, h3 } from '../engine/rng.js';
export { hex, unhex } from '../engine/colour.js';
export { ribbons, layers, lattice, clipHalf, panels, edges, drape, outline, bbox } from '../engine/geometry.js';
export { owner, shareOf, ribbonSpan } from '../engine/dye.js';
