import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propose, judge } from '../src/syndicate/vendors/xai.js';

function reply(obj) {
  return { choices: [{ message: { content: JSON.stringify(obj) } }], usage: { prompt_tokens: 50, completion_tokens: 10 }, id: 'chatcmpl_1' };
}

test('propose() sends temperature/system/image as a data URL and parses the reply', async () => {
  let seen;
  const client = { chat: { completions: { create: async (params) => { seen = params; return reply({ patch: { scatter: 20 }, intent: 'Break it up.' }); } } } };
  const r = await propose(client, {
    model: 'grok-4.6', rolePrompt: 'You compose by breaking.', brief: { instruction: 'x' },
    parentState: {}, parentRenderPng: Buffer.from('fake-png'), critiques: [],
  });
  assert.equal(seen.model, 'grok-4.6');
  assert.equal(seen.temperature, 1.0);
  assert.equal(seen.messages[0].role, 'system');
  const imagePart = seen.messages[1].content.find(c => c.type === 'image_url');
  assert.match(imagePart.image_url.url, /^data:image\/png;base64,/);
  assert.deepEqual(r.patch, { scatter: 20 });
  assert.equal(r.intent, 'Break it up.');
  assert.deepEqual(r.usage, { prompt_tokens: 50, completion_tokens: 10 });
});

test('propose() throws when the reply does not parse', async () => {
  const client = { chat: { completions: { create: async () => reply({ nonsense: true }) } } };
  await assert.rejects(() => propose(client, {
    model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, parentState: {}, parentRenderPng: Buffer.from(''), critiques: [],
  }));
});

test('judge() sends three images and parses the verdict', async () => {
  let seen;
  const client = { chat: { completions: { create: async (params) => { seen = params; return reply({ winner: 'A', why: 'Bolder.' }); } } } };
  const r = await judge(client, {
    model: 'grok-4.6', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25,
    imageA: Buffer.from('a'), imageB: Buffer.from('b'), referenceImage: Buffer.from('r'),
  });
  const images = seen.messages[1].content.filter(c => c.type === 'image_url');
  assert.equal(images.length, 3);
  assert.equal(r.winner, 'A');
});

test('judge() throws when the word limit is exceeded', async () => {
  const why = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
  const client = { chat: { completions: { create: async () => reply({ winner: 'A', why }) } } };
  await assert.rejects(() => judge(client, {
    model: 'm', rolePrompt: 'p', brief: { instruction: 'x' }, maxWords: 25,
    imageA: Buffer.from(''), imageB: Buffer.from(''), referenceImage: Buffer.from(''),
  }));
});
