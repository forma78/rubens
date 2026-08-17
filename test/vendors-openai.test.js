import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  propose, judge, judgeBatchLine, submitJudgeBatch, pollBatch, fetchBatchResults,
} from '../src/syndicate/vendors/openai.js';

function reply(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 50, completion_tokens: 10 }, id: 'chatcmpl_1' };
}

test('propose() sends temperature/system/image as a data URL and parses the reply', async () => {
  let seen;
  const client = { chat: { completions: { create: async (params) => { seen = params; return reply({ patch: { grain: 40 }, intent: 'Add texture.' }); } } } };
  const r = await propose(client, {
    model: 'gpt-5.1', rolePrompt: 'You compose by texture.', brief: { instruction: 'x' },
    parentState: {}, parentRenderPng: Buffer.from('fake-png'), critiques: [],
  });
  assert.equal(seen.model, 'gpt-5.1');
  assert.equal(seen.temperature, 1.0);
  const imagePart = seen.messages[1].content.find(c => c.type === 'image_url');
  assert.match(imagePart.image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual(r.patch, { grain: 40 });
  assert.equal(r.intent, 'Add texture.');
});

test('propose() throws when the reply does not parse', async () => {
  const client = { chat: { completions: { create: async () => reply({ nonsense: true }) } } };
  await assert.rejects(() => propose(client, {
    model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, parentState: {}, parentRenderPng: Buffer.from(''), critiques: [],
  }));
});

test('judge() sends three images and parses the verdict', async () => {
  let seen;
  const client = { chat: { completions: { create: async (params) => { seen = params; return reply({ winner: 'B', why: 'Softer.' }); } } } };
  const r = await judge(client, {
    model: 'gpt-5.4-mini', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25,
    imageA: Buffer.from('a'), imageB: Buffer.from('b'), referenceImage: Buffer.from('r'),
  });
  const images = seen.messages[1].content.filter(c => c.type === 'image_url');
  assert.equal(images.length, 3);
  assert.equal(r.winner, 'B');
});

test('judgeBatchLine builds a /v1/chat/completions batch input line with three images', () => {
  const line = judgeBatchLine('pair-01', {
    model: 'gpt-5.4-mini', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25,
    imageA: Buffer.from('a'), imageB: Buffer.from('b'), referenceImage: Buffer.from('r'),
  });
  assert.equal(line.custom_id, 'pair-01');
  assert.equal(line.method, 'POST');
  assert.equal(line.url, '/v1/chat/completions');
  assert.equal(line.body.model, 'gpt-5.4-mini');
  const images = line.body.messages[1].content.filter(c => c.type === 'image_url');
  assert.equal(images.length, 3);
});

function makeFakeBatchClient(linesToResults) {
  const files = new Map();
  const batches = new Map();
  let fileCounter = 0, batchCounter = 0;
  return {
    files: {
      create: async ({ file }) => {
        const id = `file_${fileCounter++}`;
        files.set(id, await file.text());
        return { id };
      },
      content: async (fileId) => {
        const inputJsonl = files.get(fileId);
        const lines = inputJsonl.trim().split('\n').map(l => JSON.parse(l));
        const outLines = lines.map(l => {
          const result = linesToResults(l.custom_id);
          if (result.error) return JSON.stringify({ custom_id: l.custom_id, error: result.error });
          return JSON.stringify({
            custom_id: l.custom_id,
            response: { status_code: 200, body: { id: 'r_' + l.custom_id, choices: [{ message: { content: JSON.stringify(result.body) } }], usage: { prompt_tokens: 40, completion_tokens: 8 } } },
          });
        });
        return { text: async () => outLines.join('\n') + '\n' };
      },
    },
    batches: {
      create: async ({ input_file_id }) => {
        const id = `batch_${batchCounter++}`;
        batches.set(id, { id, input_file_id, status: 'completed', output_file_id: input_file_id });
        return batches.get(id);
      },
      retrieve: async (id) => batches.get(id),
    },
  };
}

test('submitJudgeBatch uploads a .jsonl file and creates a batch pointed at it', async () => {
  const client = makeFakeBatchClient(() => ({ body: { winner: 'A', why: 'x' } }));
  const line = judgeBatchLine('p1', { model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25, imageA: Buffer.from(''), imageB: Buffer.from(''), referenceImage: Buffer.from('') });
  const batchId = await submitJudgeBatch(client, [line]);
  assert.match(batchId, /^batch_/);
});

test('pollBatch polls until status is terminal', async () => {
  let calls = 0;
  const statuses = ['in_progress', 'finalizing', 'completed'];
  const client = { batches: { retrieve: async () => ({ status: statuses[calls++], output_file_id: calls === 3 ? 'file_x' : undefined }) } };
  const result = await pollBatch(client, 'batch_1', { intervalMs: 1, timeoutMs: 2000 });
  assert.equal(result.status, 'completed');
  assert.equal(calls, 3);
});

test('fetchBatchResults maps custom_id to parsed verdicts, and to { error } for a bad line or a failed batch', async () => {
  const client = makeFakeBatchClient((customId) => {
    if (customId === 'bad') return { error: 'boom' };
    if (customId === 'garbage') return { body: { notWinnerShaped: true } };
    return { body: { winner: 'A', why: 'Reads better.' } };
  });
  const lines = [
    judgeBatchLine('good', { model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25, imageA: Buffer.from(''), imageB: Buffer.from(''), referenceImage: Buffer.from('') }),
    judgeBatchLine('bad', { model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25, imageA: Buffer.from(''), imageB: Buffer.from(''), referenceImage: Buffer.from('') }),
    judgeBatchLine('garbage', { model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25, imageA: Buffer.from(''), imageB: Buffer.from(''), referenceImage: Buffer.from('') }),
  ];
  const batchId = await submitJudgeBatch(client, lines);
  const batch = await pollBatch(client, batchId, { intervalMs: 1, timeoutMs: 2000 });
  const results = await fetchBatchResults(client, batch, { maxWords: 25 });

  assert.equal(results.get('good').winner, 'A');
  assert.ok(results.get('bad').error);
  assert.ok(results.get('garbage').error, 'a succeeded-but-unparseable line must be recorded as an error, not fabricated');
});

test('fetchBatchResults returns an empty map for a batch that never completed', async () => {
  const client = {};
  const results = await fetchBatchResults(client, { status: 'expired', output_file_id: undefined }, { maxWords: 25 });
  assert.equal(results.size, 0);
});
