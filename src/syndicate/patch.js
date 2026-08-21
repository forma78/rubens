/* SPEC 2 — what model 1's agents are allowed to say.
   An agent returns a flat JSON object of parameter changes: keys like
   "cols" or "L[2].cover", merged onto the parent state. validate() is the
   only gate a patch passes through before it touches a state — nothing
   downstream should trust an unvalidated patch.

   This file is the vocabulary. The grammar — what happens to an unknown
   key, a wrong type, an out-of-range number, a locked field — lives in
   patch-core.js and is shared with model 2 (patch2.js), because how the
   runner answers an overstepping agent is a contract and must not differ
   between generators. */

import { canvasRangeOverrides } from './canvas.js';
import { validateWith } from './patch-core.js';

/* range, per SPEC 2.1. Granularity (integer vs one-decimal float) is taken
   from the generator's own sliders (step="1" vs step="0.1"), since the
   table only calls out "integer" explicitly for a few keys.

   cols/rows/rw/angle/over/squeeze/round/drape were tightened after round 1
   of the first real shift produced compositions that don't read as real
   cloth (shallow-angle folds, near-zero drape, an overhang that vanishes) —
   see src/syndicate/canvas.js. These are physical properties of cloth in
   general, so the tightened bounds apply regardless of canvas ratio;
   nv/nh are the one dimension that's genuinely canvas-specific and are
   layered on top per ratio by canvasRangeOverrides(), not here. */
const RANGE = {
  cols:    [2, 8],
  rows:    [2, 8],
  weave:   [0.4, 20],
  edge:    [0.4, 20],
  nv:      [0, 4],
  nh:      [0, 6],
  rw:      [30, 60],
  angle:   [70, 90],
  scatter: [0, 100],
  over:    [-10, -1],
  squeeze: [0, 20],
  swell:   [0, 80],
  round:   [0, 80],
  drape:   [1, 100],
  hand:    [0, 100],
  seed:    [1, 99999],
  pitch:   [2, 40],
  ilock:   [0, 100],
  grain:   [0, 100],
  load:    [0, 60],
  cseed:   [1, 99999],
  wover:   [0, 1],
};
const FLOAT_KEYS = new Set(['weave', 'edge']);

/* never patchable, brief or no brief */
const LOCKED_TOP = new Set(['ratio', 'pattern']);

/* locked unless the brief explicitly names them in opts.unlockedColours */
const COLOUR_KEYS = new Set(['thread', 'cell', 'ribbon', 'bg']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/* which palette a layer holds (L[i].ref) used to be in this locked set —
   patchable again as of the multireference fix (2026-08-18). A brief now
   carries up to 4 references (buildBaseState in run.js backfills any
   missing slot from the engine's own PRESETS, declared by name in
   refs[].name), so every layer always has exactly 4 real palettes to
   choose from — the range below assumes that count and needs revisiting
   if PRESETS.length ever stops being 4. dyeRibbons reads L[4].ref too
   (see engine/dye.js's dye(), called with li:4), so all five layers,
   not just 0-3, are patchable here. */
const LAYER_KEY_RE = /^L\[([0-4])\]\.(bands|dir|span|cover|on|ref)$/;
const LAYER_ENUM = { dir: ['v', 'h'], span: ['cell', 'auto', 'sheet'] };
const LAYER_RANGE = { bands: [2, 8], cover: [0, 100], on: [0, 1], ref: [0, 3] };
const LAYER_DIR_SPAN_COVER_MAX_I = 3; // dir/span/cover only exist on layers 0-3; layer 4 is the ribbons

/* What the knobs are, told to a generator agent once per call. Kept in the
   schema so a model's vocabulary and its description of that vocabulary
   cannot drift apart, and kept short because it is sent on every one of the
   round's proposal calls. */
const VOCABULARY = [
  'The cells are dyed: synthetic strokes drawn from the colour probability read out of a real painted study.',
  'Five stacked layers. Layers 0-3 each take a share of the cells (L[i].cover), lay their strokes one way',
  "(L[i].dir 'v'|'h'), reach across a cell, the weave or the sheet (L[i].span), and show one of the brief's four",
  'studies (L[i].ref); L[i].bands is how many of that study\'s pure colours the layer draws from. Whatever a layer',
  'leaves uncovered falls through to the one beneath it. Layer 4 dyes the ribbons.',
  'One brush governs every layer: pitch (stroke spacing), ilock (how far neighbouring colours interlock),',
  'grain, load (paint load), wover (dye over or under the threads).',
].join(' ');

const SCHEMA = {
  vocabulary: VOCABULARY,
  range: RANGE,
  floatKeys: FLOAT_KEYS,
  lockedTop: LOCKED_TOP,
  colourKeys: COLOUR_KEYS,
  enums: {},
  layerFields: {
    bands: { kind: 'number', range: LAYER_RANGE.bands, maxLayer: 4 },
    /* patchable, but never mutated mechanically: swapping a whole layer's
       palette is a much bigger visual jump than a 12% nudge, closer in kind
       to a categorical pick than a continuous perturbation. A model
       generator proposes it deliberately — see mutate.js. */
    ref:   { kind: 'number', range: LAYER_RANGE.ref,   maxLayer: 4, mutable: false },
    on:    { kind: 'number', range: LAYER_RANGE.on,    maxLayer: 4 },
    dir:   { kind: 'enum',   values: LAYER_ENUM.dir,   maxLayer: LAYER_DIR_SPAN_COVER_MAX_I },
    span:  { kind: 'enum',   values: LAYER_ENUM.span,  maxLayer: LAYER_DIR_SPAN_COVER_MAX_I },
    cover: { kind: 'number', range: LAYER_RANGE.cover, maxLayer: LAYER_DIR_SPAN_COVER_MAX_I },
  },
  maxLayerIndex: 4,
  rangeOverrides: canvasRangeOverrides,
};

/**
 * validate(patch, opts) -> { ok, patch, errors }
 *
 * See patch-core.js for the rules every model's validator applies. The two
 * options are SPEC 2.1's:
 *
 * opts.unlockedColours: array of 'thread'|'cell'|'ribbon'|'bg' the brief
 * has explicitly unlocked. Defaults to none.
 * opts.canvasFormat: the brief's physical canvas format string (e.g.
 * '60x80') — when canvas.js has a profile for it, its nv/nh overrides take
 * precedence over the base RANGE. Not the same as the engine's ratio index:
 * 60x80 and 120x90 render through the *same* ratio but want different nv/nh
 * treatment, since rotating the canvas swaps which axis is "vertical" — see
 * canvas.js.
 */
function validate(patch, opts = {}) {
  return validateWith(SCHEMA, patch, opts);
}

export { validate, RANGE, FLOAT_KEYS, LAYER_RANGE, LAYER_DIR_SPAN_COVER_MAX_I, SCHEMA, VOCABULARY };
