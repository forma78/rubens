/* OpenAI wrapper: generator proposals, single-call judging, and batch
   judging. Third vendor, added for symmetry with Anthropic and xAI (SPEC
   3.3's "one third / one third / one third" becomes a four-way split once
   mechanical mutation is counted alongside three model vendors).

   OpenAI's Batch API is shaped differently from Anthropic's: instead of
   posting an array of requests directly, you upload a .jsonl file of
   requests, create a batch pointing at that file's id, then download a
   second .jsonl file of results once it's done. The client is passed in
   (same DI pattern as vendors/anthropic.js and vendors/xai.js) so this is
   testable against a fake client — no network, no key, no spend. */

import { toFile } from 'openai';
import {
  generatorSystemPrompt, generatorUserPrompt, judgeSystemPrompt, judgeUserPrompt,
  screenSystemPrompt, screenUserPrompt,
} from '../prompts.js';
import { parseGeneratorResponse, parseJudgeResponse, parseScreenResponse } from '../parse.js';

function dataUrl(buf, mediaType) {
  return `data:${mediaType};base64,${buf.toString('base64')}`;
}
function imagePart(buf, mediaType = 'image/jpeg') {
  return { type: 'image_url', image_url: { url: dataUrl(buf, mediaType) } };
}

async function propose(client, { model, rolePrompt, brief, parentState, parentRenderPng, critiques }) {
  const resp = await client.chat.completions.create({
    model,
    temperature: 1.0,
    messages: [
      { role: 'system', content: generatorSystemPrompt(rolePrompt) },
      {
        role: 'user',
        content: [
          { type: 'text', text: generatorUserPrompt({ brief, parentState, critiques }) },
          // parentRenderPng is round.js's toTransmitJpeg() output despite
          // the name — always JPEG bytes. Anthropic's API 400s on this
          // exact mismatch (found 2026-08-19); OpenAI's has been lenient
          // about it so far, but the label was wrong here too — don't
          // override imagePart's correct 'image/jpeg' default.
          imagePart(parentRenderPng),
        ],
      },
    ],
  });
  const text = resp.choices[0]?.message?.content ?? '';
  const { patch, intent } = parseGeneratorResponse(text);
  return { patch, intent, usage: resp.usage, model, id: resp.id };
}

async function judge(client, { model, rolePrompt, brief, maxWords, imageA, imageB, referenceImage }) {
  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: judgeSystemPrompt(rolePrompt, maxWords) },
      {
        role: 'user',
        content: [
          { type: 'text', text: judgeUserPrompt({ brief }) },
          imagePart(imageA),
          imagePart(imageB),
          imagePart(referenceImage),
        ],
      },
    ],
  });
  const text = resp.choices[0]?.message?.content ?? '';
  const { winner, why } = parseJudgeResponse(text, maxWords);
  return { winner, why, usage: resp.usage, model, id: resp.id };
}

/** One screening call: one contact sheet + the reference, mirroring judge()
 *  exactly but with a single sheet image instead of A/B. */
async function screen(client, { model, rolePrompt, brief, maxWords, tileCount, keepCount, sheetImage, referenceImage }) {
  const resp = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: screenSystemPrompt(rolePrompt, keepCount, maxWords) },
      {
        role: 'user',
        content: [
          { type: 'text', text: screenUserPrompt({ brief, tileCount }) },
          imagePart(sheetImage),
          imagePart(referenceImage),
        ],
      },
    ],
  });
  const text = resp.choices[0]?.message?.content ?? '';
  const { keep, why } = parseScreenResponse(text, { tileCount, keepCount, maxWords });
  return { keep, why, usage: resp.usage, model, id: resp.id };
}

/** One line of the batch input .jsonl file (SPEC: /v1/chat/completions batch shape). */
function judgeBatchLine(customId, { model, rolePrompt, brief, maxWords, imageA, imageB, referenceImage }) {
  return {
    custom_id: customId,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model,
      messages: [
        { role: 'system', content: judgeSystemPrompt(rolePrompt, maxWords) },
        {
          role: 'user',
          content: [
            { type: 'text', text: judgeUserPrompt({ brief }) },
            imagePart(imageA),
            imagePart(imageB),
            imagePart(referenceImage),
          ],
        },
      ],
    },
  };
}

/** Upload the .jsonl, create the batch, return its id. */
async function submitJudgeBatch(client, lines) {
  const jsonl = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  const file = await client.files.create({
    file: await toFile(Buffer.from(jsonl, 'utf8'), 'batch.jsonl'),
    purpose: 'batch',
  });
  const batch = await client.batches.create({
    input_file_id: file.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
  });
  return batch.id;
}

async function pollBatch(client, batchId, { intervalMs = 15000, timeoutMs = 60 * 60 * 1000, onPoll } = {}) {
  const start = Date.now();
  const terminal = new Set(['completed', 'failed', 'expired', 'cancelled']);
  for (;;) {
    const batch = await client.batches.retrieve(batchId);
    if (onPoll) onPoll(batch);
    if (terminal.has(batch.status)) return batch;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`openai: batch ${batchId} did not finish within ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/**
 * fetchBatchResults(client, batch, opts) -> Map<custom_id, { winner, why, usage } | { error }>
 * Takes the *batch object* (from pollBatch's return, not just the id) since
 * the output file id only exists once the batch has actually finished.
 */
async function fetchBatchResults(client, batch, { maxWords } = {}) {
  const out = new Map();
  if (batch.status !== 'completed' || !batch.output_file_id) {
    // the whole batch failed/expired/was cancelled before producing output;
    // every request in it is a recorded failure, not a fabricated verdict
    return out;
  }
  const response = await client.files.content(batch.output_file_id);
  const text = await response.text();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (entry.error) {
      out.set(entry.custom_id, { error: JSON.stringify(entry.error) });
      continue;
    }
    const body = entry.response?.body;
    const content = body?.choices?.[0]?.message?.content ?? '';
    try {
      const { winner, why } = parseJudgeResponse(content, maxWords);
      out.set(entry.custom_id, { winner, why, usage: body.usage, id: body.id });
    } catch (e) {
      out.set(entry.custom_id, { error: e.message });
    }
  }
  return out;
}

export { propose, judge, screen, judgeBatchLine, submitJudgeBatch, pollBatch, fetchBatchResults };
