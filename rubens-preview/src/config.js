// Constants shared by the whole app: units, formats, brush profiles,
// default palettes. No DOM here, so tests can import it in Node.

// Document units are pt, 1 pt = 25.4/72 mm, 1:1 with the canvas —
// like an Illustrator artboard set to the real size.
export const PT_MM = 25.4 / 72;                  // 0.35278 mm per point

export const FORMATS = {
  p60x80:   { label: 'Paper 60 × 80 cm',   w: 600,  h: 800 },
  p80x60:   { label: 'Paper 80 × 60 cm',   w: 800,  h: 600 },
  c70x100:  { label: 'Canvas 70 × 100 cm', w: 700,  h: 1000 },
  c100x70:  { label: 'Canvas 100 × 70 cm', w: 1000, h: 700 },
  c100x100: { label: 'Canvas 100 × 100 cm', w: 1000, h: 1000 },
};

// Brush profile = texture in the preview. The trace width comes from Stroke;
// mm is the brush's own trace, which sets how far apart the passes may lie.
// round10 is the brush on the machine (the owner, 2026-09-28: a Raphael No. 4,
// "about 10 mm"). Its mm and its texture are guesses until the first paint
// photos (Rubens_v2.md, section 8): a round brush has no hard bristle rows,
// so softer streaks and shallower gaps than the flat ones.
export const BRUSHES = {
  flat8:   { label: 'Flat 8 mm',   mm: 8,  streaks: 90, streakAmp: 0.13, gap: 0.10, gapDepth: 0.10, hiChance: 0.035 },
  flat12:  { label: 'Flat 12 mm',  mm: 12, streaks: 55, streakAmp: 0.22, gap: 0.14, gapDepth: 0.60, hiChance: 0.07 },
  round10: { label: 'Round 10 mm', mm: 10, round: true, guess: true, streaks: 40, streakAmp: 0.12, gap: 0.16, gapDepth: 0.30, hiChance: 0.04 },
};

// 800 pt = 282 mm, 35 mm a lane (the owner, 2026-09-29: "25 mm and 30 mm,
// easily — like 600 or 800 pt; art has no limits"; it was 500 pt)
export const WEIGHT_MIN = 1, WEIGHT_MAX = 800;
export const WEIGHT_PRESETS = [1, 2, 3, 5, 8, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800];
export const PAPER = '#EEEAE2';
export const K_LEV = 32, N_VAR = 3, P_MAX = 1.35;   // paint-level steps in the stamp strips
export const HOLD_MS = 350;                          // how long to hold the mouse still before a segment snaps
export const LANE_ORDER_NOTE = 'Lanes 1–8 run from the left edge to the right edge of the line, looking along the drawing direction, whichever way a pass is painted.';

export const DEFAULT_PALETTES = [
  { id: 'L1', name: 'Ember',   colors: ['#D63A22', '#EC7422', '#5A2B2B', '#5A2B2B', '#5A2B2B', '#EC7422', '#F2C12E', '#FAF8F3'] },
  { id: 'L2', name: 'Indigo',  colors: ['#E3245A', '#7A3A9E', '#1E2C84', '#1E2C84', '#1E2C84', '#1E2C84', '#7A3A9E', '#161616'] },
  { id: 'L3', name: 'Sherbet', colors: ['#EF2F66', '#EF2F66', '#F6CF2F', '#FAF8F3', '#FAF8F3', '#F6CF2F', '#F6CF2F', '#EF2F66'] },
  { id: 'L4', name: 'Custom',  colors: [null, null, null, null, null, null, null, null] },
];
