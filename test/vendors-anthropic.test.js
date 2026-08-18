import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  propose, judge, screen, judgeBatchRequest, submitJudgeBatch, pollBatch, fetchBatchResults,
} from '../src/syndicate/vendors/anthropic.js';

function textMessage(obj, extra = {}) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 100, output_tokens: 20 }, id: 'msg_1', ...extra };
}

test('propose() sends model/temperature/system/image and parses the reply', async () => {
  let seen;
  const client = { messages: { create: async (params) => { seen = params; return textMessage({ patch: { cols: 9 }, intent: 'Tighten it.' }); } } };
  const r = await propose(client, {
    model: 'claude-opus-5', rolePrompt: 'You compose by tightening.',
    brief: { instruction: 'Anxious.' }, parentState: { cols: 5 }, parentRenderPng: Buffer.from('fake-png'),
    critiques: ['too loose'],
  });
  assert.equal(seen.model, 'claude-opus-5');
  assert.equal(seen.temperature, 1.0);
  assert.match(seen.system, /You compose by tightening/);
  assert.equal(seen.messages[0].content[1].type, 'image');
  // parentRenderPng is always round.js's toTransmitJpeg() output despite
  // the param name — asserting image/jpeg here is what catches a real
  // regression (Anthropic 400s on a media_type/bytes mismatch; found
  // 2026-08-19 via a 100% real-shift failure rate on this exact call)
  assert.equal(seen.messages[0].content[1].source.media_type, 'image/jpeg');
  assert.deepEqual(r.patch, { cols: 9 });
  assert.equal(r.intent, 'Tighten it.');
  assert.deepEqual(r.usage, { input_tokens: 100, output_tokens: 20 });
});

test('propose() throws (does not swallow) when the model reply does not parse', async () => {
  const client = { messages: { create: async () => textMessage({ nonsense: true }) } };
  await assert.rejects(() => propose(client, {
    model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, parentState: {}, parentRenderPng: Buffer.from(''), critiques: [],
  }));
});

test('judge() sends three images (A, B, reference) and parses the verdict', async () => {
  let seen;
  const client = { messages: { create: async (params) => { seen = params; return textMessage({ winner: 'B', why: 'Better weight.' }); } } };
  const r = await judge(client, {
    model: 'claude-sonnet-5', rolePrompt: 'You judge weight.', brief: { instruction: 'x' }, maxWords: 25,
    imageA: Buffer.from('a'), imageB: Buffer.from('b'), referenceImage: Buffer.from('ref'),
  });
  const images = seen.messages[0].content.filter(c => c.type === 'image');
  assert.equal(images.length, 3);
  assert.equal(r.winner, 'B');
  assert.equal(r.why, 'Better weight.');
});

test('judge() throws when winner is outside A/B', async () => {
  const client = { messages: { create: async () => textMessage({ winner: 'C', why: 'x' }) } };
  await assert.rejects(() => judge(client, {
    model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25,
    imageA: Buffer.from(''), imageB: Buffer.from(''), referenceImage: Buffer.from(''),
  }));
});

test('screen() sends the sheet + reference (two images) and parses the keep list', async () => {
  let seen;
  const client = { messages: { create: async (params) => { seen = params; return textMessage({ keep: [4, 2], why: 'Strongest pair.' }); } } };
  const r = await screen(client, {
    model: 'claude-sonnet-5', rolePrompt: 'You judge weight.', brief: { instruction: 'x' }, maxWords: 25,
    tileCount: 6, keepCount: 2, sheetImage: Buffer.from('sheet'), referenceImage: Buffer.from('ref'),
  });
  const images = seen.messages[0].content.filter(c => c.type === 'image');
  assert.equal(images.length, 2);
  assert.deepEqual(r.keep, [4, 2]);
  assert.equal(r.why, 'Strongest pair.');
});

test('screen() throws when the keep list has a duplicate', async () => {
  const client = { messages: { create: async () => textMessage({ keep: [1, 1], why: 'x' }) } };
  await assert.rejects(() => screen(client, {
    model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25,
    tileCount: 6, keepCount: 2, sheetImage: Buffer.from(''), referenceImage: Buffer.from(''),
  }));
});

test('judgeBatchRequest builds a request with the given custom_id and three images', () => {
  const req = judgeBatchRequest('pair-01', {
    model: 'claude-sonnet-5', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25,
    imageA: Buffer.from('a'), imageB: Buffer.from('b'), referenceImage: Buffer.from('r'),
  });
  assert.equal(req.custom_id, 'pair-01');
  assert.equal(req.params.model, 'claude-sonnet-5');
  const images = req.params.messages[0].content.filter(c => c.type === 'image');
  assert.equal(images.length, 3);
});

test('submitJudgeBatch returns the batch id', async () => {
  const client = { beta: { messages: { batches: { create: async ({ requests }) => ({ id: 'batch_123', processing_status: 'in_progress', request_counts: { processing: requests.length } }) } } } };
  const id = await submitJudgeBatch(client, [judgeBatchRequest('p1', { model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25, imageA: Buffer.from(''), imageB: Buffer.from(''), referenceImage: Buffer.from('') })]);
  assert.equal(id, 'batch_123');
});

test('pollBatch polls until processing_status is "ended"', async () => {
  let calls = 0;
  const statuses = ['in_progress', 'in_progress', 'ended'];
  const client = { beta: { messages: { batches: { retrieve: async () => ({ processing_status: statuses[calls++] }) } } } };
  const seenStatuses = [];
  const result = await pollBatch(client, 'batch_1', { intervalMs: 1, onPoll: (b) => seenStatuses.push(b.processing_status) });
  assert.equal(result.processing_status, 'ended');
  assert.equal(calls, 3);
  assert.deepEqual(seenStatuses, statuses);
});

test('pollBatch times out rather than polling forever', async () => {
  const client = { beta: { messages: { batches: { retrieve: async () => ({ processing_status: 'in_progress' }) } } } };
  await assert.rejects(() => pollBatch(client, 'batch_1', { intervalMs: 1, timeoutMs: 5 }), /did not finish/);
});

test('fetchBatchResults maps succeeded entries to parsed verdicts and others to { error }', async () => {
  const entries = [
    { custom_id: 'p1', result: { type: 'succeeded', message: textMessage({ winner: 'A', why: 'x' }) } },
    { custom_id: 'p2', result: { type: 'errored', error: { message: 'boom' } } },
    { custom_id: 'p3', result: { type: 'succeeded', message: textMessage({ garbage: true }) } },
    { custom_id: 'p4', result: { type: 'expired' } },
  ];
  const client = { beta: { messages: { batches: { results: async () => (async function* () { for (const e of entries) yield e; })() } } } };
  const out = await fetchBatchResults(client, 'batch_1', { maxWords: 25 });
  assert.equal(out.get('p1').winner, 'A');
  assert.ok(out.get('p2').error);
  assert.ok(out.get('p3').error, 'unparseable succeeded result should still be recorded as an error, not fabricated');
  assert.ok(out.get('p4').error);
});
