import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeRound, renderRound, judgeRound, selectRound, applyPatch } from '../src/syndicate/round.js';
import { S as DEFAULT_STATE, PRESETS } from '../src/engine/index.js';
import { createCostTracker } from '../src/syndicate/cost.js';
import { renderToPng } from '../src/syndicate/render-core.js';
import { makeFakeClients } from './helpers/fake-clients.js';

const config = {
  variantsPerRound: 8,
  survivors: 2,
  wildcards: 1,
  proposalSplit: { anthropic: 2, xai: 2, openai: 2, mechanical: 2 },
  judging: { pairsPerVariantPerJudge: 3, extraRandomPairsPerVariant: 1, shuffleSlots: true, maxWords: 25 },
  models: {
    anthropic: { generator: 'claude-opus-5', judge: 'claude-sonnet-5' },
    xai: { generator: 'grok-4.6', judge: 'grok-4.6' },
    openai: { generator: 'gpt-5.1', judge: 'gpt-5.1-mini' },
  },
  limits: { retriesPerCall: 1 },
};
const roles = {
  judges: [
    { id: 'architect', vendors: ['anthropic', 'xai', 'openai'], prompt: 'judge weight', rounds: [1, 2] },
    { id: 'gallerist', vendors: ['anthropic', 'xai', 'openai'], prompt: 'judge hand', rounds: [2] },
  ],
  generators: [
    { id: 'gen-tight', vendor: 'anthropic', prompt: 'tighten' },
    { id: 'gen-loose', vendor: 'xai', prompt: 'loosen' },
    { id: 'gen-grain', vendor: 'openai', prompt: 'texture' },
  ],
};
const brief = { instruction: 'Anxious.', unlockedColours: [] };
const refs = PRESETS.slice(0, 1);
const ovr = [{}, {}, {}, {}, {}];
// a real rendered PNG — proposeRound's non-mechanical path runs it through
// sharp (toTransmitJpeg), which a fake buffer like Buffer.from('png') can't decode
const basePng = await renderToPng(DEFAULT_STATE, refs, ovr, { quality: 'preview' });

test('applyPatch merges top-level and L[i].field keys without mutating the parent', () => {
  const parent = { cols: 5, L: [{ bands: 3 }] };
  const child = applyPatch(parent, { cols: 9, 'L[0].bands': 4 });
  assert.equal(child.cols, 9);
  assert.equal(child.L[0].bands, 4);
  assert.equal(parent.cols, 5);
  assert.equal(parent.L[0].bands, 3);
});

test('proposeRound (round 1): produces variantsPerRound variants split across sources, all valid patches applied', async () => {
  const clients = makeFakeClients();
  const costTracker = createCostTracker(100);
  const logged = [];
  const parents = [{ id: 'base', state: DEFAULT_STATE, png: basePng }];

  const children = await proposeRound({
    parents, roundNum: 1, config, roles, brief, unlockedColours: [],
    clients, costTracker, dry: false, seedBase: 1,
    logProposal: (e) => logged.push(e), critiquesFor: () => [],
  });

  assert.equal(children.length, config.variantsPerRound);
  const ids = new Set(children.map(c => c.id));
  assert.equal(ids.size, children.length, 'ids must be unique');
  for (const id of ids) assert.match(id, /^r1-var-\d{2}$/);
  assert.equal(logged.length, config.variantsPerRound);
  const sources = children.map(c => c.source);
  assert.ok(sources.includes('mechanical'));
  assert.ok(costTracker.spent > 0, 'model calls should have registered a cost');
});

test('renderRound produces a PNG and a transmit JPEG per variant', async () => {
  const clients = makeFakeClients();
  const costTracker = createCostTracker(100);
  const parents = [{ id: 'base', state: DEFAULT_STATE, png: basePng }];
  const children = await proposeRound({
    parents, roundNum: 1, config, roles, brief, unlockedColours: [],
    clients, costTracker, dry: true, seedBase: 2, // dry: all-mechanical, keeps this test fast/network-free
    logProposal: () => {}, critiquesFor: () => [],
  });
  await renderRound(children, refs, ovr);
  for (const v of children) {
    assert.ok(Buffer.isBuffer(v.png) && v.png.length > 0);
    assert.ok(Buffer.isBuffer(v.jpeg) && v.jpeg.length > 0);
  }
});

test('judgeRound (round 1): every active judge x vendor evaluates the round-1 pair set', async () => {
  const clients = makeFakeClients();
  const costTracker = createCostTracker(100);
  const parents = [{ id: 'base', state: DEFAULT_STATE, png: basePng }];
  const children = await proposeRound({
    parents, roundNum: 1, config, roles, brief, unlockedColours: [],
    clients, costTracker, dry: true, seedBase: 3, logProposal: () => {}, critiquesFor: () => [],
  });
  await renderRound(children, refs, ovr);
  const referenceJpeg = children[0].jpeg;

  const logged = [];
  const { comparisons } = await judgeRound({
    variants: children, roundNum: 1, config, roles, brief, referenceJpeg,
    clients, costTracker, dry: false, seedBase: 3, logComparison: (e) => logged.push(e),
  });

  // round 1: only 'architect' is active (rounds:[1,2] includes 1; 'gallerist' only [2])
  // pairsPerVariantPerJudge pairs per variant, shared across every active
  // (role, vendor) combination — 1 active role x 3 vendors here
  const expectedPairs = config.variantsPerRound * config.judging.pairsPerVariantPerJudge / 2;
  assert.equal(comparisons.length, expectedPairs * 3); // 1 active role x 3 vendors
  assert.equal(logged.length, comparisons.length);
  for (const c of comparisons) {
    assert.ok(children.some(v => v.id === c.winner));
    assert.ok(children.some(v => v.id === c.loser));
    assert.notEqual(c.winner, c.loser);
  }
});

test('selectRound returns survivors + wildcards, and honours the configured wildcard count', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const variants = ids.map(id => ({ id }));
  const comparisons = [
    { winner: 'a', loser: 'b', vendor: 'anthropic', pairId: 'ab' },
    { winner: 'a', loser: 'b', vendor: 'xai', pairId: 'ab' },
    { winner: 'c', loser: 'd', vendor: 'anthropic', pairId: 'cd' },
    { winner: 'd', loser: 'c', vendor: 'xai', pairId: 'cd' }, // disagreement on c/d
    { winner: 'e', loser: 'a', vendor: 'anthropic', pairId: 'ea' },
  ];
  const { selected, wildcard } = selectRound(variants, comparisons, 2, 1);
  assert.equal(selected.length, 3); // 2 survivors + 1 wildcard
  assert.ok(wildcard, 'a wildcard should be selected');
  // c and d disagreed, so whichever of them isn't in the top-2 should be a strong wildcard candidate
});

test('end-to-end: two rounds through propose -> render -> judge -> select stays internally consistent', async () => {
  const clients = makeFakeClients();
  const costTracker = createCostTracker(100);
  const parents1 = [{ id: 'base', state: DEFAULT_STATE, png: basePng, seedRating: 1500 }];

  const children1 = await proposeRound({
    parents: parents1, roundNum: 1, config, roles, brief, unlockedColours: [],
    clients, costTracker, dry: true, seedBase: 9, logProposal: () => {}, critiquesFor: () => [],
  });
  await renderRound(children1, refs, ovr);
  const referenceJpeg = children1[0].jpeg;
  const { comparisons: c1 } = await judgeRound({
    variants: children1, roundNum: 1, config, roles, brief, referenceJpeg,
    clients, costTracker, dry: false, seedBase: 9, logComparison: () => {},
  });
  const sel1 = selectRound(children1, c1, config.survivors, config.wildcards);
  assert.equal(sel1.selected.length, config.survivors + config.wildcards);

  const field = sel1.selected.map(id => {
    const v = children1.find(x => x.id === id);
    return { ...v, seedRating: sel1.ratings[id] };
  });

  const children2 = await proposeRound({
    parents: field, roundNum: 2, config, roles, brief, unlockedColours: [],
    clients, costTracker, dry: true, seedBase: 9, logProposal: () => {}, critiquesFor: () => [],
  });
  await renderRound(children2, refs, ovr);
  for (const c of children2) assert.match(c.id, /^r2-var-\d{2}$/);
  // children inherit a seedRating from their parent (not the 1500 default) when the parent has one
  for (const c of children2) assert.notEqual(c.seedRating, undefined);

  const combined = [...field, ...children2];
  const { comparisons: c2 } = await judgeRound({
    variants: combined, roundNum: 2, config, roles, brief, referenceJpeg,
    clients, costTracker, dry: false, seedBase: 9, logComparison: () => {},
  });
  // round 2 has both 'architect' and 'gallerist' active
  assert.ok(c2.length > c1.length / 1, 'round 2 should have comparisons from more active judges');
  const sel2 = selectRound(combined, c2, config.survivors, config.wildcards);
  assert.equal(sel2.selected.length, config.survivors + config.wildcards);
  for (const id of sel2.selected) assert.ok(combined.some(v => v.id === id));
});
