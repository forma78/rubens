import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFinalMd, quotesFor, sharpest, winRateBySource, namesFromRoles } from '../src/syndicate/report.js';

test('sharpest picks the n longest quotes, longest first', () => {
  const quotes = [
    { why: 'short', judgeId: 'a' },
    { why: 'a medium length one here', judgeId: 'b' },
    { why: 'the longest quote of all by quite a margin', judgeId: 'c' },
    { why: 'tiny', judgeId: 'd' },
  ];
  assert.deepEqual(sharpest(quotes, 2), [
    { why: 'the longest quote of all by quite a margin', judgeId: 'c' },
    { why: 'a medium length one here', judgeId: 'b' },
  ]);
});

test('quotesFor splits a variant\'s comparisons into wins (for) and losses (against), keeping judgeId', () => {
  const comparisons = [
    { winner: 'x', loser: 'y', why: 'x has better weight', judgeId: 'architect' },
    { winner: 'z', loser: 'x', why: 'z reads calmer', judgeId: 'gallerist' },
    { winner: 'x', loser: 'w', why: 'x is bolder', judgeId: 'architect' },
  ];
  const { for: forQ, against } = quotesFor('x', comparisons);
  assert.deepEqual(new Set(forQ.map(q => q.why)), new Set(['x has better weight', 'x is bolder']));
  assert.deepEqual(against, [{ why: 'z reads calmer', judgeId: 'gallerist' }]);
});

test('winRateBySource tallies wins/total per source across all comparisons', () => {
  const variantsById = new Map([
    ['a', { source: 'anthropic' }],
    ['b', { source: 'xai' }],
    ['c', { source: 'mechanical' }],
  ]);
  const comparisons = [
    { winner: 'a', loser: 'b' },
    { winner: 'c', loser: 'a' },
    { winner: 'c', loser: 'b' },
  ];
  const rates = winRateBySource(variantsById, comparisons);
  assert.deepEqual(rates.anthropic, { wins: 1, total: 2 });
  assert.deepEqual(rates.xai, { wins: 0, total: 2 });
  assert.deepEqual(rates.mechanical, { wins: 2, total: 2 });
});

test('namesFromRoles builds an id -> name lookup from judges and generators', () => {
  const roles = {
    judges: [{ id: 'architect', name: 'Ford' }, { id: 'no-name-here' }],
    generators: [{ id: 'gen-loose', name: 'Dolores' }],
  };
  assert.deepEqual(namesFromRoles(roles), { architect: 'Ford', 'gen-loose': 'Dolores' });
});

test('renderFinalMd produces a markdown doc with a ranked table, per-variant sections, and win rates', () => {
  const variantsById = new Map([
    ['r2-var-01', { source: 'anthropic', generatorId: 'gen-tight', intent: 'Tighten it.', roundNum: 'round-2' }],
    ['r1-var-03', { source: 'mechanical', intent: 'mechanical mutation', roundNum: 'round-1' }],
  ]);
  const roles = { judges: [{ id: 'architect', name: 'Ford' }], generators: [{ id: 'gen-tight', name: 'Bernard' }] };
  const md = renderFinalMd({
    brief: { id: 'brief-test', instruction: 'Anxious.' },
    finalIds: ['r2-var-01', 'r1-var-03'],
    variantsById,
    ratings: { 'r2-var-01': 1550, 'r1-var-03': 1480 },
    disagreements: { 'r2-var-01': 0.25, 'r1-var-03': 0 },
    comparisons: [
      { winner: 'r2-var-01', loser: 'r1-var-03', why: 'Better balance overall.', judgeId: 'architect' },
    ],
    roundsRun: 2,
    costSpent: 3.4567,
    roles,
  });
  assert.match(md, /# brief-test/);
  assert.match(md, /Anxious\./);
  assert.match(md, /\$3\.46/);
  assert.match(md, /r2-var-01/);
  assert.match(md, /!\[r2-var-01\]\(round-2\/variants\/r2-var-01\.png\)/);
  assert.match(md, /anthropic \(Bernard\)/, 'the generator persona name should be attributed alongside the vendor');
  assert.match(md, /Win rate by source/);
  assert.match(md, /Better balance overall\./);
  assert.match(md, /— Ford/, 'the quote should be attributed to the judge by name');
});

test('renderFinalMd falls back to the raw id when roles is missing or a name is unset', () => {
  const variantsById = new Map([['v1', { source: 'xai', intent: 'x', roundNum: 'round-1' }]]);
  const md = renderFinalMd({
    brief: { id: 'b', instruction: 'x' },
    finalIds: ['v1'],
    variantsById,
    ratings: { v1: 1500 },
    disagreements: { v1: 0 },
    comparisons: [{ winner: 'v1', loser: 'ghost', why: 'A fine quote.', judgeId: 'unnamed-role' }],
    roundsRun: 1,
    costSpent: 0,
    // roles intentionally omitted
  });
  assert.match(md, /— unnamed-role/);
});
