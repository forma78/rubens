import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdForUsage, createCostTracker } from '../src/syndicate/cost.js';

test('usdForUsage computes input+output cost from an Anthropic-shaped usage object', () => {
  const usd = usdForUsage('anthropic', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(usd, 3.00); // input price per 1M tokens
});

test('usdForUsage accepts an OpenAI-shaped usage object (xAI via the openai client)', () => {
  const usd = usdForUsage('xai', 'grok-4.6', { prompt_tokens: 0, completion_tokens: 1_000_000 });
  assert.equal(usd, 6.00); // output price per 1M tokens (docs.x.ai, confirmed)
});

test('usdForUsage prices cached input tokens at the cached rate, not the full rate', () => {
  // grok-4.6: input $2.00/M, cachedInput $0.50/M — an all-cached request
  // should cost a quarter of an all-uncached one
  const uncached = usdForUsage('xai', 'grok-4.6', { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 0 } });
  const cached = usdForUsage('xai', 'grok-4.6', { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 1_000_000 } });
  assert.equal(uncached, 2.00);
  assert.equal(cached, 0.50);
});

test('usdForUsage treats Anthropic cache fields as additive, not a subset of input_tokens', () => {
  // input_tokens (fresh) and cache_read_input_tokens are two separate token
  // pools for Anthropic — both get billed, on top of each other. With no
  // distinct cachedInput rate configured, cache_read falls back to the full
  // input rate, so this must equal (1M + 400k) tokens at $3/M, not 1M.
  const usd = usdForUsage('anthropic', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 400_000 });
  assert.equal(usd, 4.20);
});

test('batch pricing is 50% of standard', () => {
  const standard = usdForUsage('anthropic', 'claude-opus-5', { input_tokens: 1_000_000, output_tokens: 0 });
  const batch = usdForUsage('anthropic', 'claude-opus-5', { input_tokens: 1_000_000, output_tokens: 0 }, { batch: true });
  assert.equal(batch, standard / 2);
});

test('unknown vendor/model pricing throws rather than silently costing $0', () => {
  assert.throws(() => usdForUsage('anthropic', 'made-up-model', { input_tokens: 1, output_tokens: 1 }));
});

test('createCostTracker accumulates and reports remaining budget', () => {
  const t = createCostTracker(10);
  t.add('anthropic', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(t.spent, 3);
  assert.equal(t.remaining, 7);
  assert.equal(t.capped(), false);
});

test('createCostTracker reports capped() once spend reaches the max', () => {
  const t = createCostTracker(3);
  t.add('anthropic', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(t.capped(), true);
});

test('createCostTracker keeps a log with vendor/model/usd per call', () => {
  const t = createCostTracker(100);
  t.add('xai', 'grok-4.6', { prompt_tokens: 1000, completion_tokens: 500 }, { tag: 'judge:architect' });
  assert.equal(t.log.length, 1);
  assert.equal(t.log[0].vendor, 'xai');
  assert.equal(t.log[0].tag, 'judge:architect');
  assert.ok(t.log[0].usd > 0);
});
