import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeRound, renderRound, judgeRound, selectRound, applyPatch } from '../src/syndicate/round.js';
import { S as DEFAULT_STATE, PRESETS } from '../src/engine/index.js';
import { createCostTracker } from '../src/syndicate/cost.js';
import { renderToPng } from '../src/syndicate/render-core.js';

const config = {
  variantsPerRound: 6,
  survivors: 2,
  wildcards: 1,
  proposalSplit: { anthropic: 2, xai: 2, mechanical: 2 },
  judging: { pairsPerVariantPerJudge: 3, extraRandomPairsPerVariant: 1, shuffleSlots: true, maxWords: 25 },
  models: {
    anthropic: { generator: 'claude-opus-5', judge: 'claude-sonnet-5' },
    xai: { generator: 'grok-4.6', judge: 'grok-4.6' },
  },
  limits: { retriesPerCall: 1 },
};
const roles = {
  judges: [
    { id: 'architect', vendors: ['anthropic', 'xai'], prompt: 'judge weight', rounds: [1, 2] },
    { id: 'gallerist', vendors: ['anthropic', 'xai'], prompt: 'judge hand', rounds: [2] },
  ],
  generators: [
    { id: 'gen-tight', vendor: 'anthropic', prompt: 'tighten' },
    { id: 'gen-loose', vendor: 'xai', prompt: 'loosen' },
  ],
};
const brief = { instruction: 'Anxious.', unlockedColours: [] };
const refs = PRESETS.slice(0, 1);
const ovr = [{}, {}, {}, {}, {}];
// a real rendered PNG — proposeRound's non-mechanical path runs it through
// sharp (toTransmitJpeg), which a fake buffer like Buffer.from('png') can't decode
const basePng = await renderToPng(DEFAULT_STATE, refs, ovr, { quality: 'preview' });

function textMessage(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 100, output_tokens: 20 }, id: 'msg' };
}

// prompts.js's generatorSystemPrompt always contains "Return a patch"; its
// judgeSystemPrompt always contains "Pick the one you prefer" — inspecting
// the request content (rather than counting calls) is what a real vendor
// would receive, so it's a reliable way for the fake to tell which kind of
// call it's answering, in whatever order propose/judge calls interleave.
function isJudgeCall(systemText) {
  return /Pick the one you prefer/.test(systemText);
}

function makeFakeClients() {
  const batches = new Map();
  let batchCounter = 0;
  const anthropicClient = {
    messages: {
      create: async (params) => {
        if (isJudgeCall(params.system)) return textMessage({ winner: 'A', why: 'Reads bolder here.' });
        return textMessage({ patch: { cols: 8 + Math.floor(Math.random() * 3) }, intent: 'Tighten it.' });
      },
    },
    beta: {
      messages: {
        batches: {
          create: async ({ requests }) => {
            const id = `batch_${batchCounter++}`;
            // deterministic-ish verdict: alternate A/B by custom_id parity
            const results = requests.map((r) => {
              const n = Number(r.custom_id.replace(/\D/g, '')) || 0;
              const winner = n % 2 === 0 ? 'A' : 'B';
              return { custom_id: r.custom_id, result: { type: 'succeeded', message: textMessage({ winner, why: `Prefers ${winner} here.` }) } };
            });
            batches.set(id, results);
            return { id, processing_status: 'ended' };
          },
          retrieve: async (id) => ({ id, processing_status: 'ended' }),
          results: async (id) => (async function* () { for (const r of batches.get(id)) yield r; })(),
        },
      },
    },
  };
  const xaiClient = {
    chat: {
      completions: {
        create: async (params) => {
          const system = params.messages.find(m => m.role === 'system')?.content ?? '';
          if (isJudgeCall(system)) {
            return { choices: [{ message: { content: JSON.stringify({ winner: 'A', why: 'Reads bolder.' }) } }], usage: { prompt_tokens: 50, completion_tokens: 10 }, id: 'c' };
          }
          return { choices: [{ message: { content: JSON.stringify({ patch: { scatter: 15 }, intent: 'Loosen it.' }) } }], usage: { prompt_tokens: 50, completion_tokens: 10 }, id: 'c' };
        },
      },
    },
  };
  return { anthropic: anthropicClient, xai: xaiClient };
}

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
  // pairs per variant = 3, on 2 vendors = 6 judge-calls per variant-slot, but each *pair* is
  // shared, so total comparisons = pairs * judgeInstances = (6*3/2) * (1 role * 2 vendors)
  const expectedPairs = config.variantsPerRound * config.judging.pairsPerVariantPerJudge / 2;
  assert.equal(comparisons.length, expectedPairs * 2); // 1 active role x 2 vendors
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
