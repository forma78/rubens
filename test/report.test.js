import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFinalMd, quotesFor, sharpest, winRateBySource } from '../src/syndicate/report.js';

test('sharpest picks the n longest quotes, longest first', () => {
  const quotes = ['short', 'a medium length one here', 'the longest quote of all by quite a margin', 'tiny'];
  assert.deepEqual(sharpest(quotes, 2), [
    'the longest quote of all by quite a margin',
    'a medium length one here',
  ]);
});

test('quotesFor splits a variant\'s comparisons into wins (for) and losses (against)', () => {
  const comparisons = [
    { winner: 'x', loser: 'y', why: 'x has better weight' },
    { winner: 'z', loser: 'x', why: 'z reads calmer' },
    { winner: 'x', loser: 'w', why: 'x is bolder' },
  ];
  const { for: forQ, against } = quotesFor('x', comparisons);
  assert.deepEqual(new Set(forQ), new Set(['x has better weight', 'x is bolder']));
  assert.deepEqual(against, ['z reads calmer']);
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

test('renderFinalMd produces a markdown doc with a ranked table, per-variant sections, and win rates', () => {
  const variantsById = new Map([
    ['r2-var-01', { source: 'anthropic', intent: 'Tighten it.', roundNum: 'round-2' }],
    ['r1-var-03', { source: 'mechanical', intent: 'mechanical mutation', roundNum: 'round-1' }],
  ]);
  const md = renderFinalMd({
    brief: { id: 'brief-test', instruction: 'Anxious.' },
    finalIds: ['r2-var-01', 'r1-var-03'],
    variantsById,
    ratings: { 'r2-var-01': 1550, 'r1-var-03': 1480 },
    disagreements: { 'r2-var-01': 0.25, 'r1-var-03': 0 },
    comparisons: [
      { winner: 'r2-var-01', loser: 'r1-var-03', why: 'Better balance overall.' },
    ],
    roundsRun: 2,
    costSpent: 3.4567,
  });
  assert.match(md, /# brief-test/);
  assert.match(md, /Anxious\./);
  assert.match(md, /\$3\.46/);
  assert.match(md, /r2-var-01/);
  assert.match(md, /!\[r2-var-01\]\(round-2\/variants\/r2-var-01\.png\)/);
  assert.match(md, /Win rate by source/);
  assert.match(md, /Better balance overall\./);
});
