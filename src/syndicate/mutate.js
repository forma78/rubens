/* SPEC 3.3 — the mechanical third of a round's proposals: no model at all.
   Pick 2-4 editable keys at random from the parent, perturb each by a
   Gaussian of sigma = 12% of its range, clamp. This only touches numeric
   keys — L[i].dir/span are categorical (v|h, cell|auto|sheet) and a
   "Gaussian perturbation of the range" doesn't have a sensible meaning for
   them, so they're left out of the mutation pool. L[i].ref is patchable
   (2026-08-18, the multireference fix) but deliberately left out here too:
   swapping a whole layer's palette is a much bigger visual jump than a 12%
   nudge on any other key in this pool, closer in kind to a categorical pick
   than a continuous perturbation — model generators propose it deliberately
   instead. Locked keys (ratio, pattern, colours nobody unlocked) are never
   in the pool either. */

import { mk } from '../engine/rng.js';
import { RANGE, FLOAT_KEYS, LAYER_RANGE, LAYER_DIR_SPAN_COVER_MAX_I } from './patch.js';

const SIGMA_PCT = 0.12;
const MIN_KEYS = 2, MAX_KEYS = 4;

/* the full pool of numeric, patchable key-paths and their ranges — the same
   domain patch.js validates against, just flattened into a list a mutator
   can pick from and read/write by path. */
function numericKeyPool() {
  const pool = [];
  for (const [key, [lo, hi]] of Object.entries(RANGE)) {
    pool.push({ key, lo, hi, float: FLOAT_KEYS.has(key) });
  }
  for (let i = 0; i <= 4; i++) {
    pool.push({ key: `L[${i}].bands`, ...bounds('bands') });
    pool.push({ key: `L[${i}].on`, ...bounds('on') });
    if (i <= LAYER_DIR_SPAN_COVER_MAX_I) {
      pool.push({ key: `L[${i}].cover`, ...bounds('cover') });
    }
  }
  return pool;
}
function bounds(field) {
  const [lo, hi] = LAYER_RANGE[field];
  return { lo, hi, float: false };
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
 * mutate(parentState, seed) -> raw patch (unclamped numbers; run it through
 * patch.js's validate() before using it — mutate() only proposes, it does
 * not sanitise).
 *
 * Deterministic in `seed`: same parent + same seed => same patch. The
 * caller is responsible for deriving a fresh seed per child (e.g. from the
 * round number, the parent's id, and the child's index) so repeat runs of
 * a shift are reproducible.
 */
function mutate(parentState, seed) {
  const rnd = mk(seed);
  const pool = numericKeyPool();
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
