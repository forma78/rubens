/* SPEC 3.3 — Rank.
   Every variant of a round starts at 1500. Deltas are computed against the
   round's starting ratings and accumulated; the round's final ratings are
   applied once at the end, so the result does not depend on the order
   comparisons happened to finish in (this matters once judging goes through
   the Batch API and results arrive out of order). */

const START = 1500, K = 24;

/**
 * eloRound(variantIds, comparisons, opts) -> Map<id, rating>
 *
 * comparisons: [{ winner: id, loser: id }, ...] — one entry per judged pair
 * (a pair judged by several judges contributes several comparisons).
 */
function eloRound(variantIds, comparisons, opts = {}) {
  const start = opts.start ?? START, k = opts.k ?? K;
  const rating = new Map(variantIds.map(id => [id, start]));
  const delta = new Map(variantIds.map(id => [id, 0]));

  for (const { winner, loser } of comparisons) {
    if (!rating.has(winner) || !rating.has(loser)) {
      throw new Error(`elo: comparison references an id outside variantIds (${winner} vs ${loser})`);
    }
    const Rw = rating.get(winner), Rl = rating.get(loser);
    const Ew = 1 / (1 + 10 ** ((Rl - Rw) / 400));
    const El = 1 / (1 + 10 ** ((Rw - Rl) / 400));
    delta.set(winner, delta.get(winner) + k * (1 - Ew));
    delta.set(loser, delta.get(loser) + k * (0 - El));
  }

  const final = new Map();
  for (const id of variantIds) final.set(id, start + delta.get(id));
  return final;
}

/**
 * disagreement(variantIds, comparisons) -> Map<id, number 0..1>
 *
 * comparisons here carry a `pairId`, `vendor` and the two participants so
 * disagreement can be measured "the share of pairs where the two vendors
 * chose opposite winners for the same pair" (SPEC 3.3): group verdicts by
 * pairId, take each vendor's majority winner for that pair, and compare.
 * A pair only counts if it was judged by both vendors at least once.
 */
function disagreement(variantIds, comparisons) {
  const byPair = new Map();
  for (const c of comparisons) {
    if (!byPair.has(c.pairId)) byPair.set(c.pairId, { a: c.a, b: c.b, votes: [] });
    byPair.get(c.pairId).votes.push({ vendor: c.vendor, winner: c.winner });
  }

  const pairDisagreed = new Map(); // pairId -> boolean
  const pairMembers = new Map();   // pairId -> [a, b]
  for (const [pairId, { a, b, votes }] of byPair) {
    const byVendor = new Map();
    for (const v of votes) {
      if (!byVendor.has(v.vendor)) byVendor.set(v.vendor, { a: 0, b: 0 });
      const tally = byVendor.get(v.vendor);
      if (v.winner === a) tally.a++; else tally.b++;
    }
    const vendors = [...byVendor.keys()];
    if (vendors.length < 2) continue; // needs both vendors represented to compare
    const majority = (t) => (t.a >= t.b ? a : b);
    const winners = new Set(vendors.map(v => majority(byVendor.get(v))));
    pairDisagreed.set(pairId, winners.size > 1);
    pairMembers.set(pairId, [a, b]);
  }

  const total = new Map(variantIds.map(id => [id, 0]));
  const disagreed = new Map(variantIds.map(id => [id, 0]));
  for (const [pairId, disagreedFlag] of pairDisagreed) {
    for (const id of pairMembers.get(pairId)) {
      if (!total.has(id)) continue;
      total.set(id, total.get(id) + 1);
      if (disagreedFlag) disagreed.set(id, disagreed.get(id) + 1);
    }
  }

  const share = new Map();
  for (const id of variantIds) {
    const t = total.get(id);
    share.set(id, t ? disagreed.get(id) / t : 0);
  }
  return share;
}

export { eloRound, disagreement, START, K };
