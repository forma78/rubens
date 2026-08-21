/* xAI wrapper, via the openai-compatible client pointed at config's
   models.xai.base_url. No batch path here — SPEC 3.5 names Anthropic's
   Message Batches API specifically as the cost lever; xAI calls go through
   one at a time. The client is passed in for the same testability reason
   as vendors/anthropic.js. */

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

async function propose(client, { model, rolePrompt, schema, brief, parentState, parentRenderPng, critiques }) {
  const resp = await client.chat.completions.create({
    model,
    temperature: 1.0,
    messages: [
      { role: 'system', content: generatorSystemPrompt(rolePrompt, schema) },
      {
        role: 'user',
        content: [
          { type: 'text', text: generatorUserPrompt({ brief, parentState, critiques }) },
          // parentRenderPng is round.js's toTransmitJpeg() output despite
          // the name — always JPEG bytes. Anthropic's API 400s on this
          // exact mismatch (found 2026-08-19); xAI's has been lenient
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

export { propose, judge, screen };
