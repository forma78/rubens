/* SPEC 3.5 — cost control.
   The runner accumulates cost from the `usage` object of every real
   response and aborts the shift when config/syndicate.json's maxUsd is
   reached, writing what it has. The cap is never raised to make something
   pass.

   PRICING BELOW IS AN UNVERIFIED PLACEHOLDER. config/syndicate.json says so
   explicitly: "Model ids and prices move. Verify against
   platform.claude.com/docs pricing and docs.x.ai before the first paid
   shift." Do that before trusting a projected cost against a real budget —
   this module warns at runtime for exactly that reason. */

const PRICING = {
  anthropic: {
    'claude-opus-5':   { input: 15.00, output: 75.00 },
    'claude-sonnet-5': { input: 3.00, output: 15.00 },
  },
  xai: {
    'grok-4.6': { input: 3.00, output: 15.00 },
  }
};

let warned = false;
function warnUnverified() {
  if (warned) return;
  warned = true;
  console.error('[cost] WARNING: token prices in src/syndicate/cost.js are unverified placeholders — check them against current provider pricing before a real shift.');
}

/** usdForUsage(vendor, model, usage, { batch }) -> number (USD) */
function usdForUsage(vendor, model, usage, { batch = false } = {}) {
  const table = PRICING[vendor]?.[model];
  if (!table) throw new Error(`cost: no pricing entry for ${vendor}/${model} — add one to src/syndicate/cost.js`);
  warnUnverified();
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
  const mult = batch ? 0.5 : 1; // Batch API: 50% of standard token prices
  return (inputTokens / 1e6) * table.input * mult + (outputTokens / 1e6) * table.output * mult;
}

/** A running total with a hard cap, per call site (generator/judge/etc). */
function createCostTracker(maxUsd) {
  let spent = 0;
  const log = [];
  return {
    add(vendor, model, usage, opts = {}) {
      const usd = usdForUsage(vendor, model, usage, opts);
      spent += usd;
      log.push({ vendor, model, usd, batch: !!opts.batch, at: new Date().toISOString(), tag: opts.tag ?? null });
      return usd;
    },
    get spent() { return spent; },
    get remaining() { return maxUsd - spent; },
    capped() { return spent >= maxUsd; },
    get log() { return log.slice(); },
  };
}

export { PRICING, usdForUsage, createCostTracker };
