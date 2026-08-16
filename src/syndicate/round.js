/* SPEC 3.3 — one round: propose -> render -> judge -> rank -> select.
   "mutate" (survivors carrying forward unchanged) happens in run.js, which
   owns the loop across rounds; this module does the inside of one round. */

import { mk } from '../engine/rng.js';
import { validate } from './patch.js';
import { mutate } from './mutate.js';
import { renderToPng } from './render-core.js';
import { toTransmitJpeg } from './image.js';
import { round1Pairs, swissPairs } from './pairing.js';
import { eloRound, disagreement } from './elo.js';
import * as anthropic from './vendors/anthropic.js';
import * as xai from './vendors/xai.js';

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
 * proposeRound: variantsPerRound patches from parents, split anthropic /
 * xai / mechanical per config.proposalSplit. Round 1 has a single parent
 * (the base state) and no critiques. Every proposal — model or mechanical —
 * is written to proposals.jsonl via `logProposal`, accepted or rejected;
 * a rejected model proposal is retried once (SPEC 2.1) then dropped, in
 * which case that slot is filled by a mechanical mutation instead so the
 * round still reaches variantsPerRound.
 */
async function proposeRound({
  parents, roundNum, config, roles, brief, unlockedColours,
  clients, costTracker, dry, seedBase, logProposal, critiquesFor,
}) {
  const n = config.variantsPerRound;
  const split = config.proposalSplit;
  const total = split.anthropic + split.xai + split.mechanical;
  const counts = dry
    ? { anthropic: 0, xai: 0, mechanical: n }
    : {
        anthropic: Math.round((split.anthropic / total) * n),
        xai: Math.round((split.xai / total) * n),
        mechanical: 0,
      };
  counts.mechanical = n - counts.anthropic - counts.xai;

  const jobs = [];
  for (const [source, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) jobs.push(source);
  }

  const variants = [];
  let vi = 0;
  for (const source of jobs) {
    const parent = parents[vi % parents.length];
    const seed = seedBase + roundNum * 100000 + vi;
    vi++;

    let patch, intent, meta = { source, parentId: parent.id };
    if (source === 'mechanical') {
      patch = mutate(parent.state, seed);
      intent = 'mechanical mutation';
    } else {
      const vendorMod = source === 'anthropic' ? anthropic : xai;
      const client = clients[source];
      const models = config.models[source];
      const generators = roles.generators.filter(g => g.vendor === source);
      const gen = generators[Math.floor(mk(seed + 7)() * generators.length)];
      const parentJpeg = await toTransmitJpeg(parent.png);
      let result = null, lastError = null;
      for (let attempt = 0; attempt < 1 + (config.limits?.retriesPerCall ?? 1); attempt++) {
        try {
          result = await vendorMod.propose(client, {
            model: models.generator,
            rolePrompt: gen.prompt,
            brief,
            parentState: parent.state,
            parentRenderPng: parentJpeg,
            critiques: critiquesFor(parent.id),
          });
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (!result) {
        logProposal({ source, generatorId: gen.id, parentId: parent.id, patch: null, intent: null, accepted: false, error: lastError?.message ?? 'unknown error' });
        patch = mutate(parent.state, seed); // fill the slot mechanically rather than short the round
        intent = 'mechanical mutation (fallback after generator failure)';
        meta = { source: 'mechanical', parentId: parent.id, fallbackFrom: source };
      } else {
        costTracker.add(source, models.generator, result.usage, { tag: `propose:${gen.id}` });
        patch = result.patch;
        intent = result.intent;
        meta = { source, generatorId: gen.id, parentId: parent.id };
      }
    }

    const { ok, patch: clean, errors } = validate(patch, { unlockedColours });
    logProposal({ ...meta, patch, intent, accepted: ok, errors });
    const finalPatch = ok ? clean : {}; // an invalid patch contributes no change rather than nothing at all
    const state = applyPatch(parent.state, finalPatch);
    // a new child has no rating of its own yet; inherit the parent's for
    // Swiss sort purposes only (SPEC 3.3 round 2+ pairing) — its own Elo
    // still starts at 1500 like every other variant this round
    variants.push({ id: null, state, intent, seedRating: parent.seedRating ?? 1500, ...meta });
  }

  // ids are globally unique across the shift (not just this round) so a
  // survivor carried forward from an earlier round is never confused with
  // a freshly-proposed child that happens to land on the same slot number
  variants.forEach((v, i) => { v.id = `r${roundNum}-var-${String(i + 1).padStart(2, '0')}`; });
  return variants;
}

/** renderRound: every variant to a preview PNG + its transmission JPEG. */
async function renderRound(variants, refs, ovr) {
  for (const v of variants) {
    v.png = await renderToPng(v.state, refs, ovr, { quality: 'preview' });
    v.jpeg = await toTransmitJpeg(v.png);
  }
  return variants;
}

/**
 * judgeRound: builds the round's pair set, evaluates it with every judge
 * role active this round (per roles.json's own `rounds` list) on both its
 * vendors, and returns { comparisons, byId } where comparisons is the flat
 * list elo.js/disagreement() expect and byId collects the `why` quotes a
 * variant received, split into for/against.
 *
 * Anthropic's calls for the round go through the Message Batches API in
 * one batch (SPEC 3.5); xAI calls go one at a time. In --dry mode nothing
 * is called at all — comparisons come back empty and every variant keeps
 * the Elo start rating, clearly marked as unjudged by the caller.
 */
async function judgeRound({
  variants, roundNum, config, roles, brief, referenceJpeg,
  clients, costTracker, dry, seedBase, logComparison,
}) {
  if (dry) return { comparisons: [] };

  const ids = variants.map(v => v.id);
  const byId = new Map(variants.map(v => [v.id, v]));
  const pairs = roundNum === 1
    ? round1Pairs(ids, config.judging.pairsPerVariantPerJudge, seedBase + roundNum)
    : swissPairs(ids, id => byId.get(id).seedRating ?? 1500, config.judging.pairsPerVariantPerJudge, config.judging.extraRandomPairsPerVariant, seedBase + roundNum);

  const activeJudges = roles.judges.filter(j => j.rounds.includes(roundNum));
  const rnd = mk(seedBase + roundNum * 7919);

  // every (pair, judge role, vendor) is one comparison request
  const calls = [];
  for (const [a, b] of pairs) {
    const pairId = `${a}|${b}`;
    const swapped = config.judging.shuffleSlots && rnd() < 0.5;
    const [slotA, slotB] = swapped ? [b, a] : [a, b];
    for (const role of activeJudges) {
      for (const vendor of role.vendors) {
        calls.push({ pairId, a, b, slotA, slotB, role, vendor });
      }
    }
  }

  const comparisons = [];
  const anthropicCalls = calls.filter(c => c.vendor === 'anthropic');
  const xaiCalls = calls.filter(c => c.vendor === 'xai');

  // --- Anthropic: one batch for the whole round ---
  if (anthropicCalls.length && !costTracker.capped()) {
    const requests = anthropicCalls.map((c, i) => anthropic.judgeBatchRequest(`c${i}`, {
      model: config.models.anthropic.judge,
      rolePrompt: c.role.prompt,
      brief,
      maxWords: config.judging.maxWords,
      imageA: byId.get(c.slotA).jpeg,
      imageB: byId.get(c.slotB).jpeg,
      referenceImage: referenceJpeg,
    }));
    const batchId = await anthropic.submitJudgeBatch(clients.anthropic, requests);
    await anthropic.pollBatch(clients.anthropic, batchId);
    const results = await anthropic.fetchBatchResults(clients.anthropic, batchId, { maxWords: config.judging.maxWords });
    anthropicCalls.forEach((c, i) => {
      const r = results.get(`c${i}`);
      recordComparison(c, r, 'anthropic', config.models.anthropic.judge, costTracker, comparisons, logComparison, true);
    });
  }

  // --- xAI: one at a time ---
  for (const c of xaiCalls) {
    if (costTracker.capped()) break;
    let r;
    try {
      r = await xai.judge(clients.xai, {
        model: config.models.xai.judge,
        rolePrompt: c.role.prompt,
        brief,
        maxWords: config.judging.maxWords,
        imageA: byId.get(c.slotA).jpeg,
        imageB: byId.get(c.slotB).jpeg,
        referenceImage: referenceJpeg,
      });
    } catch (e) {
      r = { error: e.message };
    }
    recordComparison(c, r, 'xai', config.models.xai.judge, costTracker, comparisons, logComparison, false);
  }

  return { comparisons };
}

function recordComparison(c, r, vendor, model, costTracker, comparisons, logComparison, batch) {
  const base = { pairId: c.pairId, a: c.a, b: c.b, slotA: c.slotA, slotB: c.slotB, judgeId: c.role.id, vendor, model, at: new Date().toISOString() };
  if (!r || r.error) {
    logComparison({ ...base, ok: false, error: r?.error ?? 'no result' });
    return;
  }
  const winner = r.winner === 'A' ? c.slotA : c.slotB;
  const loser = winner === c.a ? c.b : c.a;
  if (r.usage) costTracker.add(vendor, model, r.usage, { tag: `judge:${c.role.id}`, batch });
  logComparison({ ...base, ok: true, winner, loser, why: r.why, requestId: r.id });
  comparisons.push({ pairId: c.pairId, a: c.a, b: c.b, vendor, winner, loser, why: r.why, judgeId: c.role.id });
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
