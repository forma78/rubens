/* Bounded concurrency, plus the two ordering guarantees the round depends
   on. No new dependency: parallelism is the whole point of the live shift
   path, and thirty lines here are cheaper to reason about — and to keep
   deterministic — than another package in the lockfile.

   mapPool is order-preserving on purpose. out[i] always corresponds to
   items[i] no matter which task finished first, because round.js derives
   variant ids and seeds from the index, and eloRound() applies K-factor
   updates in the order comparisons arrive — an out-of-order comparisons
   array would quietly break SPEC's "re-run the same shift, get the same
   variants".

   serialise wraps a side-effecting async function (a jsonl append, a
   Supabase push) so concurrent callers queue behind each other instead of
   interleaving mid-line. */

/**
 * mapPool(items, limit, fn) -> Promise<Array>
 * Runs fn(item, i) over items with at most `limit` in flight. Results come
 * back in input order. A rejection propagates — callers that want a failed
 * item recorded rather than fatal should catch inside fn (round.js does).
 */
async function mapPool(items, limit, fn) {
  const list = Array.from(items);
  const out = new Array(list.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, list.length || 1));
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    for (;;) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  }));
  return out;
}

/**
 * serialise(fn) -> (...args) => Promise
 * Same function, but calls run one at a time in the order they were made.
 * Used for appendFile logging: two concurrent appends of a long jsonl line
 * can interleave, and a half-written line is a corrupted record, not a
 * cosmetic problem — runs/ is committed evidence.
 */
function serialise(fn) {
  let chain = Promise.resolve();
  return (...args) => {
    const result = chain.then(() => fn(...args));
    chain = result.catch(() => {});
    return result;
  };
}

export { mapPool, serialise };
