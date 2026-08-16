import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonObject, parseGeneratorResponse, parseJudgeResponse } from '../src/syndicate/parse.js';

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
