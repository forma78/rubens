/* SPEC 3.3 — Pairing.
   "round 1 random, every variant appearing in exactly 3 pairs per judge.
   Round 2 onwards Swiss — sort by rating, pair neighbours — plus one random
   pair per variant so the field cannot lock."

   The pair set is built once per round and shared by every active judge
   (SPEC's "per judge" describes how many pairs each variant sits in from
   any one judge's point of view — every judge active this round evaluates
   the same pairs, which is what makes cross-vendor disagreement on "the
   same pair" measurable at all). */

import { mk } from '../engine/rng.js';

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * A random k-regular graph on `ids` (each id appears in exactly k pairs, no
 * self-pairs, no repeated pairs): a perfect matching at circulant distance
 * n/2 if k is odd (needs even n), plus one full cycle per remaining pair of
 * degree at distances 1, 2, ... — the standard circulant construction.
 */
function kRegularPairs(ids, k, rnd) {
  const n = ids.length;
  if (k >= n) throw new Error(`pairing: k (${k}) must be less than the number of variants (${n})`);
  if ((n * k) % 2 !== 0) throw new Error(`pairing: a ${k}-regular graph needs n*k even (n=${n})`);

  const order = shuffle(ids, rnd);
  const edges = [];
  let remaining = k;

  if (remaining % 2 === 1) {
    if (n % 2 !== 0) throw new Error(`pairing: odd degree ${k} needs an even number of variants (got ${n})`);
    const half = n / 2;
    for (let i = 0; i < half; i++) edges.push([order[i], order[i + half]]);
    remaining -= 1;
  }
  for (let d = 1; d <= remaining / 2; d++) {
    for (let i = 0; i < n; i++) edges.push([order[i], order[(i + d) % n]]);
  }
  return edges;
}

/** SPEC 3.3, round 1: every variant in exactly `pairsPerVariant` pairs. */
function round1Pairs(variantIds, pairsPerVariant, seed) {
  return kRegularPairs(variantIds, pairsPerVariant, mk(seed));
}

function rotate(arr, by) {
  const n = arr.length;
  return arr.slice(by % n).concat(arr.slice(0, by % n));
}

/**
 * SPEC 3.3, round 2+: Swiss (sort by rating, pair neighbours) plus one
 * random pair per variant.
 *
 * `seedRating(id)` supplies the rating to sort by: a survivor's own final
 * rating from the round it was last judged in, or its parent's final
 * rating for a freshly-proposed child (new variants have no rating of
 * their own yet — the round's own Elo always starts everyone at 1500;
 * this is only the sort key used to build sensible pairs before that
 * happens).
 *
 * Swiss neighbour-pairing is repeated `pairsPerVariant` times, rotating the
 * sorted order by one position each pass so a variant does not just get
 * re-paired with the same neighbour — then `extraRandomPairs` more pairs
 * per variant are added from a fully random matching, "so the field cannot
 * lock."
 */
function swissPairs(variantIds, seedRating, pairsPerVariant, extraRandomPairs, seed) {
  const rnd = mk(seed);
  const sorted = [...variantIds].sort((a, b) => seedRating(b) - seedRating(a));

  const edges = [];
  let cur = sorted;
  for (let pass = 0; pass < pairsPerVariant; pass++) {
    for (let i = 0; i + 1 < cur.length; i += 2) edges.push([cur[i], cur[i + 1]]);
    cur = rotate(cur, 1);
  }
  if (extraRandomPairs > 0) {
    const existing = new Set(edges.map(([a, b]) => [a, b].sort().join('|')));
    // a random matching can coincide with a Swiss pair by chance; that's
    // harmless (the pair just gets judged twice), but the whole point of
    // this layer is fresh comparisons, so make a bounded effort to avoid
    // repeats rather than guaranteeing it outright
    let extra = kRegularPairs(variantIds, extraRandomPairs, rnd);
    for (let attempt = 0; attempt < 20; attempt++) {
      const collides = extra.some(([a, b]) => existing.has([a, b].sort().join('|')));
      if (!collides) break;
      extra = kRegularPairs(variantIds, extraRandomPairs, rnd);
    }
    edges.push(...extra);
  }
  return edges;
}

export { kRegularPairs, round1Pairs, swissPairs };
