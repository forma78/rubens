import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { aHash, hammingDistance, dedupe, buildContactSheet, screenRound } from '../src/syndicate/screen.js';
import { createCostTracker } from '../src/syndicate/cost.js';
import { renderToPng } from '../src/syndicate/render-core.js';
import { S as DEFAULT_STATE, PRESETS } from '../src/engine/index.js';

const ovr = [{}, {}, {}, {}, {}];
// two genuinely different real renders (not flat colour swatches — a flat
// colour image has every pixel exactly at its own channel mean, so aHash
// can't tell two of them apart regardless of hue) — a different reference
// study's palette shifts the per-channel averages enough to separate them
const pngA = await renderToPng(DEFAULT_STATE, PRESETS.slice(0, 1), ovr, { quality: 'preview' });
const pngB = await renderToPng(DEFAULT_STATE, [PRESETS[1] ?? PRESETS[0]], ovr, { quality: 'preview' });

test('aHash/hammingDistance: identical images hash to distance 0', async () => {
  const h1 = await aHash(pngA);
  const h2 = await aHash(pngA);
  assert.equal(h1, h2);
  assert.equal(hammingDistance(h1, h2), 0);
});

test('aHash is colour-sensitive, not just luminance (regression: a real round collapsed to 1 survivor on 2026-08-19 under a greyscale-only version)', async () => {
  const hA = await aHash(pngA);
  const hB = await aHash(pngB);
  assert.equal(hA.length, 48, 'per-channel hash is 192 bits (48 hex chars), not the old 64-bit greyscale one');
  // two different reference studies, same geometry — a greyscale hash of
  // this exact pair measured 8/64 bits apart (12.5%) before this fix; the
  // per-channel version should read as at least as separated proportionally
  assert.ok(hammingDistance(hA, hB) >= 20, `expected >= 20/192 bits apart, got ${hammingDistance(hA, hB)}`);
});

test('dedupe drops byte-identical renders, keeps visibly different ones', async () => {
  const variants = [
    { id: 'r1-var-01', png: pngA },
    { id: 'r1-var-02', png: pngA }, // identical to 01
    { id: 'r1-var-03', png: pngB }, // visibly different
  ];
  const { kept, dropped } = await dedupe(variants, 4);
  assert.deepEqual(kept.map(v => v.id).sort(), ['r1-var-01', 'r1-var-03']);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].id, 'r1-var-02');
  assert.equal(dropped[0].reason, 'duplicate');
  assert.equal(dropped[0].of, 'r1-var-01'); // earlier id wins
});

test('dedupe picks the same survivor whatever order the array is given in', async () => {
  const a = { id: 'r1-var-01', png: pngA };
  const b = { id: 'r1-var-02', png: pngA };
  const forward = await dedupe([a, b], 4);
  const backward = await dedupe([b, a], 4);
  assert.deepEqual(forward.kept.map(v => v.id), backward.kept.map(v => v.id));
  assert.deepEqual(forward.dropped.map(v => v.id), backward.dropped.map(v => v.id));
  assert.deepEqual(forward.kept.map(v => v.id), ['r1-var-01']);
});

// small, fast synthetic tiles for the contact-sheet structural tests —
// content doesn't matter here, only the id<->tile-number mapping and the
// composite's geometry
async function tinyPngs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: i * 10, g: 0, b: 0 } } }).png().toBuffer());
  }
  return out;
}

test('buildContactSheet: tile n maps to order[n-1], N not divisible by cols still valid', async () => {
  const pngs = await tinyPngs(5);
  const variants = pngs.map((png, i) => ({ id: `r1-var-${String(i + 1).padStart(2, '0')}`, png }));
  const { sheets } = await buildContactSheet(variants, { tilePx: 16, cols: 4 });
  assert.equal(sheets.length, 1);
  const { jpeg, order } = sheets[0];
  assert.equal(order.length, 5);
  assert.deepEqual(order, variants.map(v => v.id));
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.width, 4 * 16); // cols * tilePx
  assert.equal(meta.height, 2 * 16); // ceil(5/4) rows * tilePx — last row short, not padded onto a false grid
});

test('buildContactSheet splits above maxTilesPerSheet', async () => {
  const pngs = await tinyPngs(15);
  const variants = pngs.map((png, i) => ({ id: `r1-var-${String(i + 1).padStart(2, '0')}`, png }));
  const { sheets } = await buildContactSheet(variants, { tilePx: 16, cols: 4, maxTilesPerSheet: 12 });
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].order.length, 12);
  assert.equal(sheets[1].order.length, 3);
  assert.deepEqual(sheets[0].order, variants.slice(0, 12).map(v => v.id));
  assert.deepEqual(sheets[1].order, variants.slice(12).map(v => v.id));
});

// ---- screenRound, against a fake vendor client -----------------------

const screenConfig = {
  models: {
    anthropic: { generator: 'claude-opus-5', judge: 'claude-sonnet-5' },
    xai: { generator: 'grok-4.6', judge: 'grok-4.6' },
    openai: { generator: 'gpt-5.1', judge: 'gpt-5.4-mini' },
  },
  judging: { maxWords: 25 },
  screening: { enabled: true, finalists: 4, minHammingDistance: 0, tilePx: 16, cols: 4, maxTilesPerSheet: 12 },
};
const roles = {
  judges: [{ id: 'architect', vendors: ['anthropic', 'xai', 'openai'], prompt: 'judge weight', rounds: [1] }],
};
const brief = { instruction: 'Anxious.' };

// every fake vendor always votes for the lowest-numbered tiles, best first
// — deterministic, and exercises the real vendors/*.js screen() + parse.js
// contract (system/user prompt shape, image attachment, response parsing)
// rather than re-implementing it
function pickLowest(tileCount, keepCount) {
  return Array.from({ length: Math.min(keepCount, tileCount) }, (_, i) => i + 1);
}
function fakeScreenAnthropic() {
  return {
    messages: {
      create: async (params) => {
        const m = params.system.match(/Pick the (\d+) tiles/);
        const keepCount = Number(m[1]);
        const tileM = params.messages[0].content[0].text.match(/has (\d+) numbered tiles/);
        const tileCount = Number(tileM[1]);
        return { content: [{ type: 'text', text: JSON.stringify({ keep: pickLowest(tileCount, keepCount), why: 'Clear favourites.' }) }], usage: { input_tokens: 50, output_tokens: 10 }, id: 'msg' };
      },
    },
  };
}
function fakeScreenChat() {
  return {
    chat: {
      completions: {
        create: async (params) => {
          const sys = params.messages.find(m => m.role === 'system').content;
          const m = sys.match(/Pick the (\d+) tiles/);
          const keepCount = Number(m[1]);
          const userText = params.messages.find(m => m.role === 'user').content[0].text;
          const tileM = userText.match(/has (\d+) numbered tiles/);
          const tileCount = Number(tileM[1]);
          return { choices: [{ message: { content: JSON.stringify({ keep: pickLowest(tileCount, keepCount), why: 'Clear favourites.' }) } }], usage: { prompt_tokens: 50, completion_tokens: 10 }, id: 'c' };
        },
      },
    },
  };
}
function fakeScreenClients() {
  return { anthropic: fakeScreenAnthropic(), xai: fakeScreenChat(), openai: fakeScreenChat() };
}

async function tenVariants() {
  const pngs = await tinyPngs(10);
  return pngs.map((png, i) => ({ id: `r5-var-${String(i + 1).padStart(2, '0')}`, png }));
}

test('screenRound against a fake client returns exactly `finalists` ids, best-ranked ones', async () => {
  const variants = await tenVariants();
  const clients = fakeScreenClients();
  const costTracker = createCostTracker(100);
  const screenedLog = [];

  const { kept, dropped } = await screenRound({
    variants, roundNum: 1, config: screenConfig, roles, brief, referenceJpeg: Buffer.from('ref'),
    clients, costTracker, dry: false, logScreened: (e) => screenedLog.push(e),
  });

  assert.equal(kept.length, screenConfig.screening.finalists);
  // every fake vote picked the lowest-numbered tiles, and tile numbers
  // follow id order, so the finalists should be the 4 lowest ids
  assert.deepEqual(kept.map(v => v.id).sort(), ['r5-var-01', 'r5-var-02', 'r5-var-03', 'r5-var-04']);
  assert.equal(dropped.length, variants.length - screenConfig.screening.finalists);
  assert.equal(screenedLog.length, dropped.length, 'one screened.jsonl line per dropped variant');
  for (const d of screenedLog) assert.equal(d.reason, 'screened-out');
});

test('screenRound is deterministic: same variants + same fake client -> identical finalist list', async () => {
  const variants = await tenVariants();
  const run = async () => {
    const { kept } = await screenRound({
      variants, roundNum: 1, config: screenConfig, roles, brief, referenceJpeg: Buffer.from('ref'),
      clients: fakeScreenClients(), costTracker: createCostTracker(100), dry: false, logScreened: () => {},
    });
    return kept.map(v => v.id);
  };
  const first = await run();
  const second = await run();
  assert.deepEqual(first, second);
});

test('screenRound with screening.enabled: false keeps every variant untouched (today\'s behaviour)', async () => {
  const variants = await tenVariants();
  const { kept, dropped } = await screenRound({
    variants, roundNum: 1, config: { ...screenConfig, screening: { enabled: false } }, roles, brief,
    referenceJpeg: Buffer.from('ref'), clients: fakeScreenClients(), costTracker: createCostTracker(100), dry: false,
  });
  assert.equal(kept.length, variants.length);
  assert.equal(dropped.length, 0);
});

test('screenRound skips the contact-sheet stage (zero calls) when the deduped field is already at or under `finalists`', async () => {
  const pngs = await tinyPngs(4);
  const variants = pngs.map((png, i) => ({ id: `r1-var-0${i + 1}`, png }));
  const clientThatMustNotBeCalled = () => { throw new Error('screenRound must not call the vendor when the field already fits within finalists'); };
  const clients = {
    anthropic: { messages: { create: async () => clientThatMustNotBeCalled() } },
    xai: { chat: { completions: { create: async () => clientThatMustNotBeCalled() } } },
    openai: { chat: { completions: { create: async () => clientThatMustNotBeCalled() } } },
  };
  const config = { ...screenConfig, screening: { ...screenConfig.screening, finalists: 8 } }; // 4 variants <= 8 finalists
  const calls = [];

  const { kept, dropped } = await screenRound({
    variants, roundNum: 1, config, roles, brief, referenceJpeg: Buffer.from('ref'),
    clients, costTracker: createCostTracker(100), dry: false, logScreened: () => {}, logScreenCall: (e) => calls.push(e),
  });

  assert.equal(kept.length, 4);
  assert.equal(dropped.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].skipped, true);
  assert.equal(calls[0].reason, 'field-at-or-under-finalists');
});

test('screenRound in --dry mode makes no calls and keeps every variant', async () => {
  const variants = await tenVariants();
  const clients = {
    anthropic: { messages: { create: async () => { throw new Error('should not be called in dry mode'); } } },
    xai: { chat: { completions: { create: async () => { throw new Error('should not be called in dry mode'); } } } },
    openai: { chat: { completions: { create: async () => { throw new Error('should not be called in dry mode'); } } } },
  };
  const { kept, dropped } = await screenRound({
    variants, roundNum: 1, config: screenConfig, roles, brief, referenceJpeg: Buffer.from('ref'),
    clients, costTracker: createCostTracker(100), dry: true,
  });
  assert.equal(kept.length, variants.length);
  assert.equal(dropped.length, 0);
});
