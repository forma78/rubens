/* SPEC 3.5 — cost control.
   The runner accumulates cost from the `usage` object of every real
   response and aborts the shift when config/syndicate.json's maxUsd is
   reached, writing what it has. The cap is never raised to make something
   pass.

   Prices per 1M tokens, USD. `verified` records whether this entry has
   actually been checked against the vendor's own pricing (not just
   plausible-looking numbers) — unverified entries warn at runtime.
   config/syndicate.json says the same thing: "Model ids and prices move.
   Verify against platform.claude.com/docs pricing and docs.x.ai before the
   first paid shift." */

const PRICING = {
  anthropic: {
    // Confirmed against Anthropic's own current pricing, 2026-08-21, and
    // both ids confirmed live on GET /v1/models the same day. Opus 5 was
    // carrying 15.00/75.00 here — three times its real price, unverified
    // since the day it was written — so maxUsd would have aborted a shift
    // that had barely spent a third of the cap. Cache rates are the
    // standard multipliers: a write costs 1.25x a fresh input token, a
    // read 0.1x.
    'claude-opus-5':   { input: 5.00, cacheWriteInput: 6.25, cachedInput: 0.50, output: 25.00, verified: true },
    // Sonnet 5 is on introductory pricing (2.00/10.00) through 2026-08-31;
    // the standard rate is what's recorded, so the cap over-estimates
    // rather than under-estimates while the intro lasts.
    'claude-sonnet-5': { input: 3.00, cacheWriteInput: 3.75, cachedInput: 0.30, output: 15.00, verified: true },
  },
  xai: {
    // confirmed against the docs.x.ai pricing page, 2026-08-17
    'grok-4.6': { input: 2.00, cachedInput: 0.50, output: 6.00, verified: true },
    // confirmed against docs.x.ai (model page + pricing table) and two
    // independent aggregators (OpenRouter, Vercel AI Gateway), 2026-08-19.
    // <200k-token tier — every call this project makes is far under that.
    // Genuinely cheaper than grok-4.6 (37.5% less input, 58% less output),
    // and does support image input (checked specifically: propose/judge/
    // screen all attach at least one image, and that was the one real risk
    // in switching). Whether it also reasons less on short JSON tasks than
    // grok-4.6 — the actual complaint that motivated the switch, per the
    // xAI usage dashboard showing $2.04 of $2.28 text spend as reasoning
    // tokens — isn't stated anywhere in the docs; only real spend data
    // after the switch will confirm that part.
    'grok-4.3': { input: 1.25, cachedInput: 0.20, output: 2.50, verified: true },
    // Not a judge today — here so swapping the second xAI seat is one line.
    // Same tier and same source as grok-4.6 above (docs.x.ai, <200k), and a
    // real judge call on 2026-08-21 billed consistently with $2/M in.
    // Measured on that call: 6.9s and 456 reasoning tokens, against
    // grok-4.6's 48s and 2239 for the same pair of images.
    'grok-4.5': { input: 2.00, cachedInput: 0.50, output: 6.00, verified: true },
  },
  openai: {
    // confirmed against platform.openai.com/docs/pricing, 2026-08-17.
    // gpt-5.1 has no mini sibling (only gpt-5 and gpt-5.4 do), so the judge
    // role uses gpt-5.4-mini instead — a different generation from the
    // gpt-5.1 generator, by deliberate choice, not an oversight.
    'gpt-5.1':      { input: 1.25, cachedInput: 0.125, output: 10.00, verified: true },
    'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.50, verified: true },
    // Judges, added 2026-08-21. Both ids listed live on GET /v1/models and
    // prices read off developers.openai.com/api/docs/pricing the same day.
    // Both were also sent a real image and asked to name its colour before
    // going in here — the pricing page does not list either under its
    // multimodal section, and a judge that cannot see is a judge that
    // fails on every call.
    'gpt-5.6-luna': { input: 0.20, cachedInput: 0.02, output: 1.20, verified: true },
    'gpt-5.4':      { input: 2.50, cachedInput: 0.25, output: 15.00, verified: true },
  }
};

const warnedFor = new Set();
function warnUnverified(vendor, model) {
  const key = `${vendor}/${model}`;
  if (warnedFor.has(key)) return;
  warnedFor.add(key);
  console.error(`[cost] WARNING: ${key}'s token prices in src/syndicate/cost.js are unverified — check them against current provider pricing before a real shift.`);
}

/** usdForUsage(vendor, model, usage, { batch }) -> number (USD)
 *
 * Anthropic reports cached input differently from the other two, and it
 * matters which: its cache_creation_input_tokens/cache_read_input_tokens
 * are separate, additive token pools alongside input_tokens (a cache write
 * costs *more* than a normal token, a cache read costs less) — they are
 * not a subset of input_tokens. xAI and OpenAI's
 * prompt_tokens_details.cached_tokens *is* a subset of prompt_tokens (xAI's
 * client is the openai SDK pointed at a different base_url, so it reports
 * usage in the same shape as OpenAI itself). Treating Anthropic's cache
 * fields as a subset (subtracting them from input_tokens) would silently
 * undercount real spend, which is the one thing this module must not do. */
function usdForUsage(vendor, model, usage, { batch = false } = {}) {
  const table = PRICING[vendor]?.[model];
  if (!table) throw new Error(`cost: no pricing entry for ${vendor}/${model} — add one to src/syndicate/cost.js`);
  if (!table.verified) warnUnverified(vendor, model);
  const mult = batch ? 0.5 : 1; // Batch API: 50% of standard token prices

  if (vendor === 'anthropic') {
    const fresh = usage.input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheWriteRate = table.cacheWriteInput ?? table.input;
    const cacheReadRate = table.cachedInput ?? table.input;
    return mult * (
      (fresh / 1e6) * table.input +
      (cacheWrite / 1e6) * cacheWriteRate +
      (cacheRead / 1e6) * cacheReadRate +
      (output / 1e6) * table.output
    );
  }

  // xAI / OpenAI-shaped: prompt_tokens is the total, cached_tokens a subset
  const totalInput = usage.prompt_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, totalInput - cached);
  const output = usage.completion_tokens ?? 0;
  const cachedRate = table.cachedInput ?? table.input;
  return mult * ((uncached / 1e6) * table.input + (cached / 1e6) * cachedRate + (output / 1e6) * table.output);
}

/** A running total with a hard cap, per call site (generator/judge/etc).
 *  `onAdd(entry)` fires synchronously on every real charge — a process
 *  that gets killed mid-shift still leaves a real record of what was
 *  actually spent up to that point, instead of a total that only exists in
 *  memory and dies with the process (see the commit this was added in). */
function createCostTracker(maxUsd, { onAdd } = {}) {
  let spent = 0;
  const log = [];
  return {
    add(vendor, model, usage, opts = {}) {
      const usd = usdForUsage(vendor, model, usage, opts);
      spent += usd;
      const entry = { vendor, model, usd, batch: !!opts.batch, at: new Date().toISOString(), tag: opts.tag ?? null };
      log.push(entry);
      if (onAdd) onAdd(entry);
      return usd;
    },
    get spent() { return spent; },
    get remaining() { return maxUsd - spent; },
    capped() { return spent >= maxUsd; },
    get log() { return log.slice(); },
  };
}

export { PRICING, usdForUsage, createCostTracker };
