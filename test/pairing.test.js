import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kRegularPairs, round1Pairs, swissPairs } from '../src/syndicate/pairing.js';

function degrees(ids, edges, { requireUnique = true } = {}) {
  const d = new Map(ids.map(id => [id, 0]));
  const seen = new Set();
  for (const [a, b] of edges) {
    assert.notEqual(a, b, 'no self-pairs');
    const key = [a, b].sort().join('|');
    if (requireUnique) assert.ok(!seen.has(key), `duplicate pair ${key}`);
    seen.add(key);
    d.set(a, d.get(a) + 1);
    d.set(b, d.get(b) + 1);
  }
  return d;
}

test('kRegularPairs: every id has exactly degree k, no self-pairs, no duplicates', () => {
  const ids = Array.from({ length: 24 }, (_, i) => `v${i}`);
  const edges = kRegularPairs(ids, 3, () => Math.random());
  assert.equal(edges.length, 24 * 3 / 2);
  const d = degrees(ids, edges);
  for (const id of ids) assert.equal(d.get(id), 3);
});

test('kRegularPairs handles k=1 (a plain random matching)', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `v${i}`);
  const edges = kRegularPairs(ids, 1, () => Math.random());
  assert.equal(edges.length, 4);
  const d = degrees(ids, edges);
  for (const id of ids) assert.equal(d.get(id), 1);
});

test('kRegularPairs handles even k without the odd-degree matching branch', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `v${i}`);
  const edges = kRegularPairs(ids, 4, () => Math.random());
  const d = degrees(ids, edges);
  for (const id of ids) assert.equal(d.get(id), 4);
});

test('kRegularPairs rejects k >= n and infeasible odd-degree/odd-n combinations', () => {
  const ids = ['a', 'b', 'c'];
  assert.throws(() => kRegularPairs(ids, 3, Math.random));
  assert.throws(() => kRegularPairs(['a', 'b', 'c'], 1, Math.random)); // odd k, odd n
});

test('round1Pairs is deterministic in its seed', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `v${i}`);
  const a = round1Pairs(ids, 3, 777);
  const b = round1Pairs(ids, 3, 777);
  assert.deepEqual(a, b);
  const c = round1Pairs(ids, 3, 778);
  assert.notDeepEqual(a, c);
});

test('round1Pairs gives every variant exactly pairsPerVariant pairs', () => {
  const ids = Array.from({ length: 24 }, (_, i) => `v${i}`);
  const edges = round1Pairs(ids, 3, 1);
  const d = degrees(ids, edges);
  for (const id of ids) assert.equal(d.get(id), 3);
});

test('swissPairs: total appearances per variant = pairsPerVariant + extraRandomPairs', () => {
  // requireUnique: false — the extra random layer makes a bounded effort to
  // avoid repeating a Swiss pair but does not guarantee it (see pairing.js);
  // a repeat is harmless, it just means that pair gets judged twice
  const ids = Array.from({ length: 16 }, (_, i) => `v${i}`);
  const rating = new Map(ids.map((id, i) => [id, 2000 - i * 10]));
  const edges = swissPairs(ids, id => rating.get(id), 3, 1, 99);
  const d = degrees(ids, edges, { requireUnique: false });
  for (const id of ids) assert.equal(d.get(id), 4, `${id} should appear in 3+1 pairs`);
});

test('swissPairs is deterministic in its seed', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `v${i}`);
  const rating = new Map(ids.map((id, i) => [id, 1500 + i]));
  const a = swissPairs(ids, id => rating.get(id), 2, 1, 55);
  const b = swissPairs(ids, id => rating.get(id), 2, 1, 55);
  assert.deepEqual(a, b);
});

test('swissPairs first pass pairs adjacent ranks (neighbours by rating)', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `v${i}`);
  const rating = new Map(ids.map((id, i) => [id, 100 - i])); // v0 highest ... v7 lowest
  const edges = swissPairs(ids, id => rating.get(id), 1, 0, 1);
  // with pairsPerVariant=1 and no extra pairs, the single pass pairs
  // (v0,v1), (v2,v3), (v4,v5), (v6,v7) in sorted order
  const asSet = new Set(edges.map(([a, b]) => [a, b].sort().join('|')));
  assert.ok(asSet.has('v0|v1'));
  assert.ok(asSet.has('v2|v3'));
  assert.ok(asSet.has('v4|v5'));
  assert.ok(asSet.has('v6|v7'));
});
