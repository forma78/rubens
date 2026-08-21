/* SPEC 2, model 2 — what an agent may say about ruled cloth.
 *
 * The grammar is patch-core.js's, shared with model 1: an unknown key or a
 * wrong type drops that key, a locked key rejects the whole patch, an
 * out-of-range number is clamped and kept. Only the vocabulary differs.
 *
 * The cloth ranges are model 1's, imported rather than restated. They were
 * tightened after round 1 of the first real shift produced compositions no
 * cloth makes — a fold at a shallow angle, an overhang past nothing, drape
 * at zero — and both models draw the same cloth from the same frozen
 * geometry, so the same physics binds them. index2.html's own sliders are
 * wider (angle from 45 degrees, overhang to +30, up to 40 columns); that is
 * the artist's range while he is designing by hand, not the range an agent
 * proposes in.
 */

import { RANGE as CLOTH_RANGE, FLOAT_KEYS } from './patch.js';
import { canvasRangeOverrides } from './canvas.js';
import { validateWith } from './patch-core.js';
import { PRESETS, SPARE } from '../engine2/index.js';

/* the cloth half of the state — the keys both models share */
const CLOTH_KEYS = [
  'cols', 'rows', 'weave', 'edge', 'nv', 'nh', 'rw', 'angle',
  'scatter', 'over', 'squeeze', 'swell', 'round', 'drape', 'hand', 'seed',
];

/* the brush half — model 2's own, and taken from index2.html's own sliders
   (min/max/step), the same way SPEC 2.1's table was taken from model 1's */
const BRUSH_RANGE = {
  paint:  [0, 1],
  pitch:  [4, 70],
  weight: [8, 95],
  length: [10, 100],
  jitter: [0, 100],
  shade:  [0, 60],
  cseed:  [1, 99999],
  wover:  [0, 1],
};

const RANGE = Object.fromEntries([
  ...CLOTH_KEYS.map((k) => [k, CLOTH_RANGE[k]]),
  ...Object.entries(BRUSH_RANGE),
]);

/* never patchable, brief or no brief. `pattern` keeps the polka dots welded
   shut: the generator can draw them, the syndicate may not ask for them. */
const LOCKED_TOP = new Set(['ratio', 'pattern']);

/* locked unless the brief explicitly names them in opts.unlockedColours */
const COLOUR_KEYS = new Set(['thread', 'cell', 'ribbon', 'bg']);

const ENUMS = { caps: ['round', 'square'] };

/* Every ink the generator itself ships — the six presets plus the spare
   swatches the editor offers. An agent may move colour around inside this
   library, which is a real compositional decision; it may not invent a hex
   value nobody painted. This is model 1's `L[i].ref` in a different shape:
   there a layer picks one of the brief's four studies, here it picks inks. */
const INK_LIBRARY = new Set(
  [...PRESETS.flatMap((p) => p.inks), ...SPARE].map((c) => c.toUpperCase()),
);
const MAX_INKS_PER_LAYER = 3;

/* dir and cover only mean anything on layers 0-3: owner() shares the cells
   between those four, and layer 4 is the ribbons, which barRibbons lays
   along the band rather than across a cell. span, on and inks apply to all
   five — the ribbon layer picks its inks and can be switched off like any
   other. */
const LAYER_FIELDS = {
  inks:  { kind: 'inks',   maxLayer: 4, maxInks: MAX_INKS_PER_LAYER, library: INK_LIBRARY },
  on:    { kind: 'number', range: [0, 1],   maxLayer: 4 },
  span:  { kind: 'enum',   values: ['bar', 'cell', 'sheet'], maxLayer: 4 },
  dir:   { kind: 'enum',   values: ['v', 'h'], maxLayer: 3 },
  cover: { kind: 'number', range: [0, 100], maxLayer: 3 },
};

/* See patch.js's VOCABULARY for why this lives in the schema. Model 2's
   knobs are genuinely different — an agent told model 1's vocabulary would
   propose L[i].ref and bands, which do not exist here, and never touch the
   brush that does. */
const VOCABULARY = [
  'The cells are ruled, not dyed: short ink bars laid inside each cell.',
  'Five stacked layers. Layers 0-3 each take a share of the cells (L[i].cover) and lay their bars one way',
  "(L[i].dir 'v'|'h'); whatever a layer leaves uncovered falls through to the one beneath it. Layer 4 lays bars",
  'across the ribbons themselves, so it has no dir or cover of its own.',
  "Each layer draws from its own inks (L[i].inks: 1-3 colours from the generator's library, no invented values),",
  "and L[i].span decides whether one ink runs per bar, per cell, or across the whole sheet.",
  'One brush governs every layer: pitch (bar spacing), weight (bar thickness), length, jitter (an unsteady hand),',
  "shade (tonal variation between bars), caps ('round'|'square'), wover (bars over or under the threads).",
].join(' ');

const SCHEMA = {
  vocabulary: VOCABULARY,
  range: RANGE,
  floatKeys: FLOAT_KEYS,
  lockedTop: LOCKED_TOP,
  colourKeys: COLOUR_KEYS,
  enums: ENUMS,
  layerFields: LAYER_FIELDS,
  maxLayerIndex: 4,
  rangeOverrides: canvasRangeOverrides,
};

/**
 * validate(patch, opts) -> { ok, patch, errors }
 * Same signature and same rules as model 1's — see patch-core.js.
 */
function validate(patch, opts = {}) {
  return validateWith(SCHEMA, patch, opts);
}

export { validate, RANGE, BRUSH_RANGE, CLOTH_KEYS, INK_LIBRARY, MAX_INKS_PER_LAYER, LAYER_FIELDS, SCHEMA, VOCABULARY };
