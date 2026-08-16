import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdForUsage, createCostTracker } from '../src/syndicate/cost.js';

test('usdForUsage computes input+output cost from an Anthropic-shaped usage object', () => {
  const usd = usdForUsage('anthropic', 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.equal(usd, 3.00); // input price per 1M tokens
});

test('usdForUsage accepts an OpenAI-shaped usage object (xAI via the openai client)', () => {
  const usd = usdForUsage('xai', 'grok-4.6', { prompt_tokens: 0, completion_tokens: 1_000_000 });
  assert.equal(usd, 15.00); // output price per 1M tokens
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
