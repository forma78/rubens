/* SPEC 3.3 — the mechanical third of a round's proposals: no model at all.
   Pick 2-4 editable keys at random from the parent, perturb each by a
   Gaussian of sigma = 12% of its range, clamp.

   The pool is read off a model's own schema (patch.js for model 1,
   patch2.js for model 2) rather than restated here, so a key added to a
   generator becomes mutable by existing, and a key that must not be nudged
   says so once, where it is defined.

   Only numeric keys are in it. Categorical fields — L[i].dir/span, caps,
   and model 2's L[i].inks — are excluded because "a Gaussian perturbation
   of the range" has no sensible meaning for them; a layer's inks are also
   the same kind of big deliberate jump as model 1's L[i].ref, which is
   marked `mutable: false` for exactly that reason. Locked keys (ratio,
   pattern, colours nobody unlocked) are never in the pool either.

   Determinism note: the pool's order is part of the seed contract. Same
   seed picks the same keys only if the pool is built in the same order, and
   every mechanical variant in runs/ depends on that. Flat keys keep their
   order in schema.range; layer keys follow the order the fields are
   declared in schema.layerFields. Reordering either silently rewrites
   history.
*/

import { mk } from '../engine/rng.js';
import { SCHEMA as MODEL_1 } from './patch.js';

const SIGMA_PCT = 0.12;
const MIN_KEYS = 2, MAX_KEYS = 4;

/* the full pool of numeric, patchable key-paths and their ranges — the same
   domain the model's validator checks against, flattened into a list a
   mutator can pick from and read/write by path. */
function numericKeyPool(schema = MODEL_1) {
  const pool = [];
  for (const [key, [lo, hi]] of Object.entries(schema.range)) {
    pool.push({ key, lo, hi, float: schema.floatKeys.has(key) });
  }
  for (let i = 0; i <= schema.maxLayerIndex; i++) {
    for (const [field, spec] of Object.entries(schema.layerFields)) {
      if (spec.kind !== 'number' || spec.mutable === false || i > spec.maxLayer) continue;
      pool.push({ key: `L[${i}].${field}`, lo: spec.range[0], hi: spec.range[1], float: false });
    }
  }
  return pool;
}

const LAYER_KEY_RE = /^L\[(\d)\]\.(\w+)$/;
function readPath(state, key) {
  const m = key.match(LAYER_KEY_RE);
  return m ? state.L[Number(m[1])][m[2]] : state[key];
}

/* Box-Muller, off the same seeded uniform generator the rest of the engine
   uses — never Math.random(). */
function gaussian(rnd) {
  const u1 = Math.max(rnd(), Number.EPSILON), u2 = rnd();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function pickDistinct(pool, n, rnd) {
  const copy = pool.slice(), chosen = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(rnd() * copy.length);
    chosen.push(copy.splice(idx, 1)[0]);
  }
  return chosen;
}

/**
 * mutate(parentState, seed, schema) -> raw patch (unclamped numbers; run it
 * through the matching model's validate() before using it — mutate() only
 * proposes, it does not sanitise). `schema` defaults to model 1's.
 *
 * Deterministic in `seed`: same parent + same seed => same patch. The
 * caller is responsible for deriving a fresh seed per child (e.g. from the
 * round number, the parent's id, and the child's index) so repeat runs of
 * a shift are reproducible.
 */
function mutate(parentState, seed, schema = MODEL_1) {
  const rnd = mk(seed);
  const pool = numericKeyPool(schema);
  const n = MIN_KEYS + Math.floor(rnd() * (MAX_KEYS - MIN_KEYS + 1));
  const chosen = pickDistinct(pool, n, rnd);

  const patch = {};
  for (const { key, lo, hi } of chosen) {
    const sigma = (hi - lo) * SIGMA_PCT;
    const current = readPath(parentState, key);
    patch[key] = current + gaussian(rnd) * sigma;
  }
  return patch;
}

export { mutate, numericKeyPool };
