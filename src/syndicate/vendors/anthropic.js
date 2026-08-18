/* Anthropic wrapper: generator proposals, single-call judging, and batch
   judging (SPEC 3.5's cost lever). The client is passed in rather than
   constructed here, so this module can be exercised with a fake client in
   tests without touching the network or needing an API key. */

import {
  generatorSystemPrompt, generatorUserPrompt, judgeSystemPrompt, judgeUserPrompt,
  screenSystemPrompt, screenUserPrompt,
} from '../prompts.js';
import { parseGeneratorResponse, parseJudgeResponse, parseScreenResponse } from '../parse.js';

function textOf(message) {
  const block = message.content.find(b => b.type === 'text');
  if (!block) throw new Error('anthropic: response has no text block');
  return block.text;
}

function imageBlock(buf, mediaType = 'image/jpeg') {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } };
}

/** One generator proposal. Temperature 1.0 per SPEC 3.3. */
async function propose(client, { model, rolePrompt, brief, parentState, parentRenderPng, critiques }) {
  const resp = await client.messages.create({
    model,
    max_tokens: 1024,
    temperature: 1.0,
    system: generatorSystemPrompt(rolePrompt),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: generatorUserPrompt({ brief, parentState, critiques }) },
        // parentRenderPng is round.js's toTransmitJpeg() output despite the
        // name (kept for signature symmetry with the other two vendors) —
        // it has always been JPEG bytes, and Anthropic checks media_type
        // against the actual bytes and 400s on a mismatch (found 2026-08-19
        // via a 100% real-shift failure rate on every Anthropic proposal).
        // imageBlock's own default is already 'image/jpeg' — just don't
        // override it.
        imageBlock(parentRenderPng),
      ],
    }],
  });
  const { patch, intent } = parseGeneratorResponse(textOf(resp));
  return { patch, intent, usage: resp.usage, model, id: resp.id };
}

/** One pairwise judgment, called directly (not through the batch). */
async function judge(client, { model, rolePrompt, brief, maxWords, imageA, imageB, referenceImage }) {
  const resp = await client.messages.create({
    model,
    max_tokens: 256,
    system: judgeSystemPrompt(rolePrompt, maxWords),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: judgeUserPrompt({ brief }) },
        imageBlock(imageA),
        imageBlock(imageB),
        imageBlock(referenceImage),
      ],
    }],
  });
  const { winner, why } = parseJudgeResponse(textOf(resp), maxWords);
  return { winner, why, usage: resp.usage, model, id: resp.id };
}

/** One screening call: one contact sheet + the reference, mirroring judge()
 *  exactly but with a single sheet image instead of A/B. */
async function screen(client, { model, rolePrompt, brief, maxWords, tileCount, keepCount, sheetImage, referenceImage }) {
  const resp = await client.messages.create({
    model,
    max_tokens: 256,
    system: screenSystemPrompt(rolePrompt, keepCount, maxWords),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: screenUserPrompt({ brief, tileCount }) },
        imageBlock(sheetImage),
        imageBlock(referenceImage),
      ],
    }],
  });
  const { keep, why } = parseScreenResponse(textOf(resp), { tileCount, keepCount, maxWords });
  return { keep, why, usage: resp.usage, model, id: resp.id };
}

function judgeBatchRequest(customId, { model, rolePrompt, brief, maxWords, imageA, imageB, referenceImage }) {
  return {
    custom_id: customId,
    params: {
      model,
      max_tokens: 256,
      system: judgeSystemPrompt(rolePrompt, maxWords),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: judgeUserPrompt({ brief }) },
          imageBlock(imageA),
          imageBlock(imageB),
          imageBlock(referenceImage),
        ],
      }],
    },
  };
}

async function submitJudgeBatch(client, requests) {
  const batch = await client.beta.messages.batches.create({ requests });
  return batch.id;
}

async function pollBatch(client, batchId, { intervalMs = 15000, timeoutMs = 60 * 60 * 1000, onPoll } = {}) {
  const start = Date.now();
  for (;;) {
    const batch = await client.beta.messages.batches.retrieve(batchId);
    if (onPoll) onPoll(batch);
    if (batch.processing_status === 'ended') return batch;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`anthropic: batch ${batchId} did not finish within ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/**
 * fetchBatchResults -> Map<custom_id, { winner, why, usage } | { error }>
 * A result that fails to parse or errored/canceled/expired is recorded as
 * { error } — SPEC 2.2/CLAUDE.md: a failed call is a recorded failure,
 * never a fabricated verdict.
 */
async function fetchBatchResults(client, batchId, { maxWords } = {}) {
  const stream = await client.beta.messages.batches.results(batchId);
  const out = new Map();
  for await (const entry of stream) {
    const r = entry.result;
    if (r.type !== 'succeeded') {
      out.set(entry.custom_id, { error: `batch result: ${r.type}${r.error ? ' ' + JSON.stringify(r.error) : ''}` });
      continue;
    }
    try {
      const { winner, why } = parseJudgeResponse(textOf(r.message), maxWords);
      out.set(entry.custom_id, { winner, why, usage: r.message.usage, id: r.message.id });
    } catch (e) {
      out.set(entry.custom_id, { error: e.message });
    }
  }
  return out;
}

export { propose, judge, screen, judgeBatchRequest, submitJudgeBatch, pollBatch, fetchBatchResults };
