/* SPEC 3.3 — one round: propose -> render -> judge -> rank -> select.
   "mutate" (survivors carrying forward unchanged) happens in run.js, which
   owns the loop across rounds; this module does the inside of one round.

   Three model vendors now, not two (Anthropic, xAI, OpenAI), added for
   symmetry so disagreement is measured across all three rather than a
   single pair.

   TWO SHIFT MODES (2026-08-18). A shift used to run every judge call
   through the vendors' batch APIs, one vendor at a time. Batch is a queue
   with a 24-hour SLA and a 50% discount: correct for volume, wrong for a
   shift someone is watching. Three vendors polled sequentially at 15s
   intervals is how a round became hours.

   - live (config.judging.useBatchApi false, the default): every call goes
     through the ordinary synchronous endpoint, all vendors together, with
     `limits.concurrency.judge` in flight. Round latency becomes the
     slowest call times the number of waves, not the sum of three queues.
   - night (useBatchApi true): the original path, unchanged, kept behind
     BATCH_ADAPTERS for large unattended runs where the discount is worth
     the wait.

   proposeRound and renderRound are pooled the same way. Everything stays
   deterministic: ids and seeds come from the job index, not from
   completion order, and both the proposals and comparisons arrays are
   assembled in index order before anyone reads them (eloRound applies K
   updates in array order — reordering it would change ratings). */

import { mk } from '../engine/rng.js';
import { mapPool, serialise } from './pool.js';
import { modelFor } from './models.js';
import { canvasGuidance } from './canvas.js';
import { mutate } from './mutate.js';
import { renderToPng } from './render-core.js';
import { toTransmitJpeg } from './image.js';
import { round1Pairs, swissPairs } from './pairing.js';
import { eloRound, disagreement } from './elo.js';
import { judgeVendor, judgeModel, activeJudges } from './judges.js';
import * as anthropic from './vendors/anthropic.js';
import * as xai from './vendors/xai.js';
import * as openai from './vendors/openai.js';

const VENDOR_MODULES = { anthropic, xai, openai };
const BATCH_ADAPTERS = {
  anthropic: {
    buildItem: (id, params) => anthropic.judgeBatchRequest(id, params),
    submit: (client, items) => anthropic.submitJudgeBatch(client, items),
    poll: (client, batchId, opts) => anthropic.pollBatch(client, batchId, opts),
    // anthropic.fetchBatchResults wants the batch *id*; poll() gives us the object
    fetch: (client, batch, opts) => anthropic.fetchBatchResults(client, batch.id, opts),
  },
  openai: {
    buildItem: (id, params) => openai.judgeBatchLine(id, params),
    submit: (client, items) => openai.submitJudgeBatch(client, items),
    poll: (client, batchId, opts) => openai.pollBatch(client, batchId, opts),
    // openai.fetchBatchResults wants the batch *object* (output_file_id lives on it)
    fetch: (client, batch, opts) => openai.fetchBatchResults(client, batch, opts),
  },
};

/* How many calls are allowed in flight per stage. Judge calls are short
   and network-bound, so they take the widest lane; render is resvg, which
   is synchronous CPU work — going wider than a handful of cores buys
   nothing and only lengthens the event-loop stalls. Overridable per shift
   in config.limits.concurrency. */
const DEFAULT_CONCURRENCY = { propose: 12, render: 6, judge: 24 };

function lanes(config) {
  return { ...DEFAULT_CONCURRENCY, ...(config?.limits?.concurrency ?? {}) };
}

function applyPatch(state, patch) {
  const next = structuredClone(state);
  for (const [key, value] of Object.entries(patch)) {
    const m = key.match(/^L\[(\d)\]\.(\w+)$/);
    if (m) next.L[Number(m[1])][m[2]] = value;
    else next[key] = value;
  }
  return next;
}

/**
 * proposeRound: variantsPerRound patches from parents, split across every
 * model vendor named in config.proposalSplit plus mechanical, in
 * proportion to their configured shares. Round 1 has a single parent (the
 * base state) and no critiques. Every proposal — model or mechanical — is
 * written to proposals.jsonl via `logProposal`, accepted or rejected; a
 * rejected model proposal is retried once (SPEC 2.1) then dropped, in
 * which case that slot is filled by a mechanical mutation instead so the
 * round still reaches variantsPerRound.
 */
async function proposeRound({
  parents, roundNum, config, roles, brief, unlockedColours,
  clients, costTracker, dry, seedBase, logProposal, critiquesFor,
}) {
  // which generator this shift is searching — its schema gates the patch,
  // feeds the mechanical mutation's key pool, and is what the agents are
  // told they are holding (models.js)
  const model = modelFor(brief.generator);
  const n = config.variantsPerRound;
  const split = config.proposalSplit;
  const modelVendors = Object.keys(split).filter(k => k !== 'mechanical');
  const total = Object.values(split).reduce((a, b) => a + b, 0);
  const counts = dry
    ? Object.fromEntries(modelVendors.map(v => [v, 0]))
    : Object.fromEntries(modelVendors.map(v => [v, Math.round((split[v] / total) * n)]));
  counts.mechanical = n - modelVendors.reduce((s, v) => s + (counts[v] || 0), 0);

  const jobs = [];
  for (const [source, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) jobs.push(source);
  }

  // one JPEG per distinct parent, not one per job. Round 1 has a single
  // parent and used to re-encode the same PNG 24 times; later rounds have
  // `survivors` of them. The promise itself is cached, so concurrent jobs
  // sharing a parent await the same encode instead of racing to redo it.
  const parentJpegs = new Map();
  const parentJpeg = (parent) => {
    if (!parentJpegs.has(parent.id)) parentJpegs.set(parent.id, toTransmitJpeg(parent.png));
    return parentJpegs.get(parent.id);
  };
  // proposals.jsonl lines are long enough that two concurrent appends can
  // interleave into one corrupt line — queue them instead
  const logOne = serialise(logProposal);

  const variants = await mapPool(jobs, lanes(config).propose, async (source, vi) => {
    const parent = parents[vi % parents.length];
    const seed = seedBase + roundNum * 100000 + vi;
    // derived from the job index rather than a running counter, so the id
    // a proposal is logged under is the same whatever order jobs finish in
    const id = `r${roundNum}-var-${String(vi + 1).padStart(2, '0')}`;

    let patch, intent, meta = { id, source, parentId: parent.id };
    if (source === 'mechanical') {
      patch = mutate(parent.state, seed, model.schema);
      intent = 'mechanical mutation';
    } else {
      const vendorMod = VENDOR_MODULES[source];
      const client = clients[source];
      const models = config.models[source];
      const generators = roles.generators.filter(g => g.vendor === source);
      const gen = generators[Math.floor(mk(seed + 7)() * generators.length)];
      const parentImage = await parentJpeg(parent);
      let result = null, lastError = null;
      for (let attempt = 0; attempt < 1 + (config.limits?.retriesPerCall ?? 1); attempt++) {
        try {
          result = await vendorMod.propose(client, {
            model: models.generator,
            rolePrompt: `${gen.prompt} ${canvasGuidance(brief.canvasFormat)}`,
            schema: model.schema,
            brief,
            parentState: parent.state,
            parentRenderPng: parentImage,
            critiques: critiquesFor(parent.id),
          });
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (!result) {
        await logOne({ id, source, generatorId: gen.id, parentId: parent.id, patch: null, intent: null, accepted: false, error: lastError?.message ?? 'unknown error' });
        patch = mutate(parent.state, seed, model.schema); // fill the slot mechanically rather than short the round
        intent = 'mechanical mutation (fallback after generator failure)';
        meta = { id, source: 'mechanical', parentId: parent.id, fallbackFrom: source };
      } else {
        costTracker.add(source, models.generator, result.usage, { tag: `propose:${gen.id}` });
        patch = result.patch;
        intent = result.intent;
        meta = { id, source, generatorId: gen.id, parentId: parent.id };
      }
    }

    const { ok, patch: clean, errors } = model.validate(patch, { unlockedColours, canvasFormat: brief.canvasFormat });
    await logOne({ ...meta, patch, intent, accepted: ok, errors });
    const finalPatch = ok ? clean : {}; // an invalid patch contributes no change rather than nothing at all
    const state = applyPatch(parent.state, finalPatch);
    // a new child has no rating of its own yet; inherit the parent's for
    // Swiss sort purposes only (SPEC 3.3 round 2+ pairing) — its own Elo
    // still starts at 1500 like every other variant this round
    return { state, intent, patch: finalPatch, seedRating: parent.seedRating ?? 1500, ...meta };
  });

  return variants;
}

/** renderRound: every variant to a preview PNG + its transmission JPEG,
 *  `limits.concurrency.render` at a time.
 *
 *  onRendered(v), if given, still fires per variant, as soon as that one
 *  is encoded — a viewer watching the feed sees posts arrive one by one,
 *  which is the whole reason the hook exists. It just no longer blocks the
 *  variants behind it: a slow Supabase upload used to hold up the next
 *  render, which on 32 variants is most of the stage. */
async function renderRound(variants, refs, ovr, { onRendered, config, model } = {}) {
  await mapPool(variants, lanes(config).render, async (v) => {
    v.png = await renderToPng(v.state, refs, ovr, { quality: 'preview', model });
    v.jpeg = await toTransmitJpeg(v.png);
    if (onRendered) await onRendered(v);
  });
  return variants;
}

/**
 * judgeRound: builds the round's pair set, evaluates it with every judge
 * role active this round (per roles.json's own `rounds` list) on every
 * vendor that role lists, and returns { comparisons } — the flat list
 * elo.js/disagreement() expect.
 *
 * Live mode (the default): every (pair, role, vendor) call goes out on the
 * ordinary endpoint, `limits.concurrency.judge` in flight, all three
 * vendors mixed in the same pool — no vendor waits for another to finish.
 *
 * Night mode (config.judging.useBatchApi): the batch path, for unattended
 * volume runs. Still one batch per vendor, but the three vendors' batches
 * are now submitted and polled concurrently rather than one after another.
 *
 * In --dry mode nothing is called at all — comparisons come back empty and
 * every variant keeps the Elo start rating, clearly marked as unjudged by
 * the caller.
 *
 * onComparisons(newOnes), if given, fires as results land, so a live feed
 * (run.js's incremental Supabase sync) shows judges' comments trickling in
 * over the round instead of all at once at the end. In live mode they are
 * flushed in groups of config.judging.streamEvery: one Supabase round-trip
 * per verdict would put a network call on the critical path of every
 * worker in the pool, which is the thing this rewrite exists to remove.
 *
 * The returned `comparisons` array is always in call order, never in
 * completion order — eloRound() applies K-factor updates sequentially, so
 * the array's order is part of the shift's reproducibility.
 */
async function judgeRound({
  variants, roundNum, config, roles, brief, referenceJpeg,
  clients, costTracker, dry, seedBase, logComparison, onComparisons,
}) {
  if (dry) return { comparisons: [] };

  const ids = variants.map(v => v.id);
  const byId = new Map(variants.map(v => [v.id, v]));
  const pairs = roundNum === 1
    ? round1Pairs(ids, config.judging.pairsPerVariantPerJudge, seedBase + roundNum)
    : swissPairs(ids, id => byId.get(id).seedRating ?? 1500, config.judging.pairsPerVariantPerJudge, config.judging.extraRandomPairsPerVariant, seedBase + roundNum);

  const judges = activeJudges(roles, roundNum);
  const rnd = mk(seedBase + roundNum * 7919);

  // every (pair, judge) is one comparison request — a judge is one persona
  // on one model now, not a persona replayed across three vendors
  const calls = [];
  for (const [a, b] of pairs) {
    const pairId = `${a}|${b}`;
    const swapped = config.judging.shuffleSlots && rnd() < 0.5;
    const [slotA, slotB] = swapped ? [b, a] : [a, b];
    for (const role of judges) {
      calls.push({ pairId, a, b, slotA, slotB, role, vendor: judgeVendor(role), model: judgeModel(role, config) });
    }
  }

  // batches are per vendor *and* per model: two judges share a vendor but
  // not a model, and one batch cannot carry two models
  const callsByLane = new Map();
  for (const c of calls) {
    const key = `${c.vendor}|${c.model}`;
    if (!callsByLane.has(key)) callsByLane.set(key, { vendor: c.vendor, model: c.model, calls: [] });
    callsByLane.get(key).calls.push(c);
  }

  const logOne = serialise(logComparison);
  const judgePayload = (c) => ({
    model: c.model,
    rolePrompt: c.role.prompt,
    brief,
    maxWords: config.judging.maxWords,
    imageA: byId.get(c.slotA).jpeg,
    imageB: byId.get(c.slotB).jpeg,
    referenceImage: referenceJpeg,
  });

  if (config.judging?.useBatchApi === true) {
    return { comparisons: await judgeViaBatches({ callsByLane, judgePayload, config, clients, costTracker, logOne, onComparisons }) };
  }

  // ---- live path -------------------------------------------------------
  // results are flushed to the feed in groups: awaiting a Supabase push
  // inside a worker would put a network round-trip on the critical path of
  // every single verdict
  const streamEvery = config.judging?.streamEvery ?? 16;
  let pending = [];
  let feed = Promise.resolve();
  const flush = (force) => {
    if (!onComparisons || !pending.length) return;
    if (!force && pending.length < streamEvery) return;
    const batch = pending;
    pending = [];
    feed = feed.then(() => onComparisons(batch)).catch(() => {});
  };

  const results = await mapPool(calls, lanes(config).judge, async (c) => {
    if (costTracker.capped()) return null;
    const model = c.model;
    let r;
    try {
      r = await VENDOR_MODULES[c.vendor].judge(clients[c.vendor], judgePayload(c));
    } catch (e) {
      r = { error: e.message };
    }
    const rec = await recordComparison(c, r, c.vendor, model, costTracker, logOne, false);
    if (rec) { pending.push(rec); flush(false); }
    return rec;
  });
  flush(true);
  await feed;

  return { comparisons: results.filter(Boolean) };
}

/** Night mode. One batch per vendor *and model* — two judges can share a
 *  vendor without sharing a model — and the lanes run concurrently: queues
 *  that each take up to an hour should cost an hour, not one after another.
 *  Results are still assembled in lane-then-call order so the comparisons
 *  array stays reproducible. */
async function judgeViaBatches({ callsByLane, judgePayload, config, clients, costTracker, logOne, onComparisons }) {
  const laneKeys = [...callsByLane.keys()];
  const perLane = new Map();

  await Promise.all(laneKeys.map(async (laneKey) => {
    const { vendor, model, calls: vendorCalls } = callsByLane.get(laneKey);
    if (!vendorCalls.length || costTracker.capped()) return;
    const client = clients[vendor];
    const adapter = BATCH_ADAPTERS[vendor];
    const out = [];

    if (adapter) {
      const items = vendorCalls.map((c, i) => adapter.buildItem(`c${i}`, judgePayload(c)));
      const batchId = await adapter.submit(client, items);
      const batch = await adapter.poll(client, batchId);
      const results = await adapter.fetch(client, batch, { maxWords: config.judging.maxWords });
      for (const [i, c] of vendorCalls.entries()) {
        const rec = await recordComparison(c, results.get(`c${i}`), vendor, model, costTracker, logOne, true);
        if (rec) out.push(rec);
      }
    } else {
      // no batch API at this vendor (xAI): pool its calls instead of
      // walking them one at a time — it has no queue to wait on
      const recs = await mapPool(vendorCalls, lanes(config).judge, async (c) => {
        if (costTracker.capped()) return null;
        let r;
        try {
          r = await VENDOR_MODULES[vendor].judge(client, judgePayload(c));
        } catch (e) {
          r = { error: e.message };
        }
        return recordComparison(c, r, vendor, model, costTracker, logOne, false);
      });
      out.push(...recs.filter(Boolean));
    }

    perLane.set(laneKey, out);
    if (onComparisons && out.length) await onComparisons(out);
  }));

  return laneKeys.flatMap(k => perLane.get(k) ?? []);
}

/** Records one comparison to the log and returns it, or returns null if the
 *  call failed — a failed call is a recorded failure, never a fabricated
 *  verdict (CLAUDE.md). The caller owns the comparisons array; this used to
 *  push into it, which is not safe once callers are concurrent. */
async function recordComparison(c, r, vendor, model, costTracker, logComparison, batch) {
  const base = { pairId: c.pairId, a: c.a, b: c.b, slotA: c.slotA, slotB: c.slotB, judgeId: c.role.id, vendor, model, at: new Date().toISOString() };
  if (!r || r.error) {
    await logComparison({ ...base, ok: false, error: r?.error ?? 'no result' });
    return null;
  }
  const winner = r.winner === 'A' ? c.slotA : c.slotB;
  const loser = winner === c.a ? c.b : c.a;
  if (r.usage) costTracker.add(vendor, model, r.usage, { tag: `judge:${c.role.id}`, batch });
  await logComparison({ ...base, ok: true, winner, loser, why: r.why, requestId: r.id });
  return { pairId: c.pairId, a: c.a, b: c.b, slotA: c.slotA, vendor, model, winner, loser, why: r.why, judgeId: c.role.id, requestId: r.id, usage: r.usage };
}

/** SPEC 3.3 Select: top `survivors` by rating + `wildcards` (default 1) —
 *  the highest-disagreement variants not already in the top. */
function selectRound(variants, comparisons, survivorsCount, wildcards = 1) {
  const ids = variants.map(v => v.id);
  const ratings = eloRound(ids, comparisons);
  const disagreements = disagreement(ids, comparisons);

  const byRating = [...ids].sort((a, b) => ratings.get(b) - ratings.get(a));
  const top = byRating.slice(0, survivorsCount);
  const rest = byRating.slice(survivorsCount).sort((a, b) => disagreements.get(b) - disagreements.get(a));
  const wildcardIds = rest.slice(0, wildcards);

  const selected = [...top, ...wildcardIds];
  const wildcard = wildcardIds[0] ?? null; // kept for backward-compat single-wildcard callers
  return {
    selected,
    ratings: Object.fromEntries(ids.map(id => [id, ratings.get(id)])),
    disagreements: Object.fromEntries(ids.map(id => [id, disagreements.get(id)])),
    wildcard,
  };
}

export { proposeRound, renderRound, judgeRound, selectRound, applyPatch };
