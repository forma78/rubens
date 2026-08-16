import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eloRound, disagreement, START, K } from '../src/syndicate/elo.js';

test('a single comparison moves both ratings symmetrically from a 1500 start', () => {
  const ratings = eloRound(['a', 'b'], [{ winner: 'a', loser: 'b' }]);
  // both start at 1500 => E=0.5 for both => delta = K*(1-0.5) = K/2
  assert.equal(ratings.get('a'), START + K / 2);
  assert.equal(ratings.get('b'), START - K / 2);
});

test('deltas are computed against the round-start rating, not applied incrementally', () => {
  // a beats b twice in the same round: order must not matter, and both
  // wins are scored against a's *starting* 1500, not an already-boosted one
  const ratings = eloRound(['a', 'b'], [
    { winner: 'a', loser: 'b' },
    { winner: 'a', loser: 'b' },
  ]);
  assert.equal(ratings.get('a'), START + 2 * (K / 2));
  assert.equal(ratings.get('b'), START - 2 * (K / 2));
});

test('result does not depend on comparison order', () => {
  const comps = [
    { winner: 'a', loser: 'b' },
    { winner: 'c', loser: 'a' },
    { winner: 'b', loser: 'c' },
  ];
  const forward = eloRound(['a', 'b', 'c'], comps);
  const backward = eloRound(['a', 'b', 'c'], [...comps].reverse());
  for (const id of ['a', 'b', 'c']) assert.equal(forward.get(id), backward.get(id));
});

test('an untouched variant stays at the start rating', () => {
  const ratings = eloRound(['a', 'b', 'c'], [{ winner: 'a', loser: 'b' }]);
  assert.equal(ratings.get('c'), START);
});

test('every variant not in variantIds cannot be referenced by a comparison', () => {
  assert.throws(() => eloRound(['a', 'b'], [{ winner: 'a', loser: 'ghost' }]));
});

test('disagreement is 0 when both vendors always pick the same winner', () => {
  const comps = [
    { pairId: 'p1', a: 'x', b: 'y', vendor: 'anthropic', winner: 'x' },
    { pairId: 'p1', a: 'x', b: 'y', vendor: 'xai', winner: 'x' },
  ];
  const d = disagreement(['x', 'y'], comps);
  assert.equal(d.get('x'), 0);
  assert.equal(d.get('y'), 0);
});

test('disagreement is 1 when vendors always split on the only shared pair', () => {
  const comps = [
    { pairId: 'p1', a: 'x', b: 'y', vendor: 'anthropic', winner: 'x' },
    { pairId: 'p1', a: 'x', b: 'y', vendor: 'xai', winner: 'y' },
  ];
  const d = disagreement(['x', 'y'], comps);
  assert.equal(d.get('x'), 1);
  assert.equal(d.get('y'), 1);
});

test('a pair judged by only one vendor does not count toward disagreement', () => {
  const comps = [
    { pairId: 'p1', a: 'x', b: 'y', vendor: 'anthropic', winner: 'x' },
  ];
  const d = disagreement(['x', 'y'], comps);
  assert.equal(d.get('x'), 0);
  assert.equal(d.get('y'), 0);
});

test('disagreement share averages correctly across several pairs for one variant', () => {
  const comps = [
    // pair p1 (x vs y): vendors agree on x
    { pairId: 'p1', a: 'x', b: 'y', vendor: 'anthropic', winner: 'x' },
    { pairId: 'p1', a: 'x', b: 'y', vendor: 'xai', winner: 'x' },
    // pair p2 (x vs z): vendors disagree
    { pairId: 'p2', a: 'x', b: 'z', vendor: 'anthropic', winner: 'x' },
    { pairId: 'p2', a: 'x', b: 'z', vendor: 'xai', winner: 'z' },
  ];
  const d = disagreement(['x', 'y', 'z'], comps);
  assert.equal(d.get('x'), 0.5); // 1 of x's 2 pairs disagreed
  assert.equal(d.get('y'), 0);
  assert.equal(d.get('z'), 1);
});
