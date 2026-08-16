/* Robust extraction of the strict JSON contract generator/judge agents are
   asked for (SPEC 3.3). Models sometimes wrap JSON in a markdown fence or
   add a stray sentence despite being told not to — try the exact text
   first, then recover a fenced or embedded object, and only ever return
   something once it's actually valid against the expected shape. Anything
   that doesn't parse throws, so the caller can record it as a rejection
   (SPEC 2.2's "log every rejection") rather than silently accept garbage. */

function extractJsonObject(text) {
  if (typeof text !== 'string') throw new Error('parse: expected a string response');
  const attempts = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) attempts.push(fenced[1].trim());
  const braced = text.match(/\{[\s\S]*\}/);
  if (braced) attempts.push(braced[0]);

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`parse: no valid JSON object found in response: ${text.slice(0, 200)}`);
}

/** { patch: object, intent: string } */
function parseGeneratorResponse(text) {
  const obj = extractJsonObject(text);
  if (typeof obj.patch !== 'object' || obj.patch === null || Array.isArray(obj.patch)) {
    throw new Error('parse: generator response missing a flat "patch" object');
  }
  if (typeof obj.intent !== 'string' || !obj.intent.trim()) {
    throw new Error('parse: generator response missing a string "intent"');
  }
  return { patch: obj.patch, intent: obj.intent.trim() };
}

/** { winner: 'A'|'B', why: string } */
function parseJudgeResponse(text, maxWords) {
  const obj = extractJsonObject(text);
  if (obj.winner !== 'A' && obj.winner !== 'B') {
    throw new Error(`parse: judge response "winner" must be "A" or "B", got ${JSON.stringify(obj.winner)}`);
  }
  if (typeof obj.why !== 'string' || !obj.why.trim()) {
    throw new Error('parse: judge response missing a string "why"');
  }
  const why = obj.why.trim();
  if (maxWords) {
    const words = why.split(/\s+/).filter(Boolean);
    if (words.length > maxWords) {
      throw new Error(`parse: judge "why" is ${words.length} words, over the ${maxWords}-word limit`);
    }
  }
  return { winner: obj.winner, why };
}

export { extractJsonObject, parseGeneratorResponse, parseJudgeResponse };
