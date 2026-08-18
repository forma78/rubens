import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, parseGeneratorResponse, parseJudgeResponse, parseScreenResponse } from '../src/syndicate/parse.js';

test('extractJsonObject parses clean JSON', () => {
  assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
});

test('extractJsonObject recovers JSON from a markdown fence', () => {
  const text = 'Sure, here it is:\n```json\n{"a":1}\n```\nHope that helps.';
  assert.deepEqual(extractJsonObject(text), { a: 1 });
});

test('extractJsonObject recovers a bare fence without the json tag', () => {
  const text = '```\n{"a":1}\n```';
  assert.deepEqual(extractJsonObject(text), { a: 1 });
});

test('extractJsonObject recovers an embedded object from surrounding prose', () => {
  const text = 'I think {"a":1} is the answer.';
  assert.deepEqual(extractJsonObject(text), { a: 1 });
});

test('extractJsonObject throws on genuinely non-JSON text', () => {
  assert.throws(() => extractJsonObject('no json here at all'));
});

test('parseGeneratorResponse accepts a well-formed patch+intent', () => {
  const r = parseGeneratorResponse('{"patch":{"cols":10},"intent":"Tighten the grid."}');
  assert.deepEqual(r.patch, { cols: 10 });
  assert.equal(r.intent, 'Tighten the grid.');
});

test('parseGeneratorResponse rejects a missing patch', () => {
  assert.throws(() => parseGeneratorResponse('{"intent":"x"}'), /missing a flat "patch"/);
});

test('parseGeneratorResponse rejects a non-object patch', () => {
  assert.throws(() => parseGeneratorResponse('{"patch":[1,2],"intent":"x"}'));
  assert.throws(() => parseGeneratorResponse('{"patch":"cols:10","intent":"x"}'));
});

test('parseGeneratorResponse rejects a missing intent', () => {
  assert.throws(() => parseGeneratorResponse('{"patch":{}}'), /missing a string "intent"/);
});

test('parseJudgeResponse accepts a well-formed verdict', () => {
  const r = parseJudgeResponse('{"winner":"A","why":"Better balance."}', 25);
  assert.equal(r.winner, 'A');
  assert.equal(r.why, 'Better balance.');
});

test('parseJudgeResponse rejects a winner that is not A or B', () => {
  assert.throws(() => parseJudgeResponse('{"winner":"C","why":"x"}', 25), /must be "A" or "B"/);
});

test('parseJudgeResponse enforces the word limit', () => {
  const why = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  assert.throws(() => parseJudgeResponse(`{"winner":"A","why":"${why}"}`, 25), /word limit/);
});

test('parseJudgeResponse recovers from a fenced response too', () => {
  const text = '```json\n{"winner":"B","why":"Tighter."}\n```';
  const r = parseJudgeResponse(text, 25);
  assert.equal(r.winner, 'B');
});

test('parseScreenResponse accepts a well-formed keep list', () => {
  const r = parseScreenResponse('{"keep":[3,1,2],"why":"These three read strongest."}', { tileCount: 5, keepCount: 3, maxWords: 25 });
  assert.deepEqual(r.keep, [3, 1, 2]);
  assert.equal(r.why, 'These three read strongest.');
});

test('parseScreenResponse rejects an out-of-range tile number', () => {
  assert.throws(
    () => parseScreenResponse('{"keep":[1,2,6],"why":"x"}', { tileCount: 5, keepCount: 3, maxWords: 25 }),
    /not an integer in 1\.\.5/,
  );
});

test('parseScreenResponse rejects a zero or negative tile number', () => {
  assert.throws(
    () => parseScreenResponse('{"keep":[0,1,2],"why":"x"}', { tileCount: 5, keepCount: 3, maxWords: 25 }),
    /not an integer in 1\.\.5/,
  );
});

test('parseScreenResponse rejects a duplicate tile number', () => {
  assert.throws(
    () => parseScreenResponse('{"keep":[1,1,2],"why":"x"}', { tileCount: 5, keepCount: 3, maxWords: 25 }),
    /duplicate entry/,
  );
});

test('parseScreenResponse rejects the wrong number of entries', () => {
  assert.throws(
    () => parseScreenResponse('{"keep":[1,2],"why":"x"}', { tileCount: 5, keepCount: 3, maxWords: 25 }),
    /exactly 3 entries, got 2/,
  );
});

test('parseScreenResponse rejects a missing "why"', () => {
  assert.throws(
    () => parseScreenResponse('{"keep":[1,2,3]}', { tileCount: 5, keepCount: 3, maxWords: 25 }),
    /missing a string "why"/,
  );
});

test('parseScreenResponse enforces the word limit on "why"', () => {
  const why = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  assert.throws(
    () => parseScreenResponse(`{"keep":[1,2,3],"why":"${why}"}`, { tileCount: 5, keepCount: 3, maxWords: 25 }),
    /word limit/,
  );
});
