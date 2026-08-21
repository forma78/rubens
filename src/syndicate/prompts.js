/* SPEC 3.3 — what generator and judge agents are told. Pure string
   building, no network — lets the prompts be tested without an API key.

   A generator's prompt is model-specific: the two generators have genuinely
   different controls, and an agent given the wrong vocabulary proposes keys
   that do not exist while never touching the ones that do. Both the
   description of the knobs and the list of locked keys are read off the
   model's own schema rather than written out here, so they cannot drift
   from what the validator will actually accept. */

import { SCHEMA as MODEL_1 } from './patch.js';

const JSON_ONLY = 'Reply with a single JSON object and nothing else — no markdown fence, no prose before or after it.';

/**
 * Generator agents are given: the parent state (JSON), the parent render
 * (PNG, attached separately by the caller), the brief, and the critiques
 * that variant received last round. They return one patch and one sentence
 * of intent.
 */
function generatorSystemPrompt(rolePrompt, schema = MODEL_1) {
  const locked = [...schema.lockedTop].join(', ');
  return [
    rolePrompt,
    '',
    'You are proposing one change to a generative textile composition. You will see the current',
    'state as JSON and a render of it. Return a patch: a flat JSON object of parameter changes to',
    'merge onto that state. Only include keys you want to change.',
    '',
    schema.vocabulary,
    '',
    `Locked: ${locked}, and every colour picker unless the brief explicitly names it as unlocked.`,
    'A patch touching a locked key is discarded entirely — every key in it, not just that one.',
    '',
    'Reply with exactly this shape:',
    '{"patch": {"<key>": <value>, ...}, "intent": "<one sentence, under 25 words>"}',
    JSON_ONLY,
  ].join('\n');
}

function generatorUserPrompt({ brief, parentState, critiques }) {
  const lines = [
    `Brief: ${brief.instruction}`,
    '',
    'Current state:',
    JSON.stringify(parentState),
  ];
  if (critiques && critiques.length) {
    lines.push('', 'What judges said about this variant last round:', ...critiques.map(c => `- ${c}`));
  }
  return lines.join('\n');
}

/**
 * Each judge call carries two renders labelled A and B, the brief, the
 * reference, and the role prompt. It returns strictly
 * { "winner": "A" | "B", "why": "one sentence, under 25 words" }.
 */
function judgeSystemPrompt(rolePrompt, maxWords) {
  return [
    rolePrompt,
    '',
    'You will see two renders of a generative textile composition, labelled A and B, and a photograph',
    'of the reference study this composition was searched against — a tonal target for composition,',
    'not something to copy literally.',
    '',
    `Pick the one you prefer. Reply with exactly this shape:`,
    `{"winner": "A" | "B", "why": "<one sentence, under ${maxWords} words>"}`,
    JSON_ONLY,
  ].join('\n');
}

function judgeUserPrompt({ brief }) {
  return `Brief: ${brief.instruction}\n\nA is the first image, B is the second, the reference photograph is the third.`;
}

/**
 * Screening (SPEC follow-up, 2026-08-18): before the pairwise tournament,
 * each active judge role narrows one contact sheet of numbered renders down
 * to the tiles worth taking to the floor. One call per (sheet, role,
 * vendor); results are Borda-aggregated across all of them by screenRound.
 */
function screenSystemPrompt(rolePrompt, keepCount, maxWords) {
  return [
    rolePrompt,
    '',
    'You will see a contact sheet of numbered renders of a generative textile composition, each tile',
    'labelled with its position number, and a photograph of the reference study this composition was',
    'searched against — a tonal target for composition, not something to copy literally.',
    '',
    `Pick the ${keepCount} tiles you would keep for further judging, best first. Reply with exactly this shape:`,
    `{"keep": [<${keepCount} distinct tile numbers, best first>], "why": "<one sentence, under ${maxWords} words>"}`,
    JSON_ONLY,
  ].join('\n');
}

function screenUserPrompt({ brief, tileCount }) {
  return `Brief: ${brief.instruction}\n\nThe contact sheet has ${tileCount} numbered tiles.`;
}

export {
  generatorSystemPrompt, generatorUserPrompt, judgeSystemPrompt, judgeUserPrompt,
  screenSystemPrompt, screenUserPrompt,
};
