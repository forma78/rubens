import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadBrief } from '../src/syndicate/brief.js';

const syndicateDefaults = { rounds: 5, variantsPerRound: 24, survivors: 6 };
const fixturePath = new URL('./fixtures/brief.json', import.meta.url).pathname;

test('loadBrief reads a well-formed brief', async () => {
  const brief = await loadBrief(fixturePath, syndicateDefaults);
  assert.equal(brief.id, 'test-brief');
  assert.equal(brief.ratio, 3);
  assert.equal(brief.canvasFormat, '70x100');
  assert.deepEqual(brief.references, ['studies/color_01.jpg']);
  assert.equal(brief.rounds, 1);
  assert.equal(brief.variantsPerRound, 12);
  assert.equal(brief.survivors, 2);
  assert.deepEqual(brief.unlockedColours, []);
});

test('loadBrief falls back to syndicate config for rounds/variantsPerRound/survivors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-brief-'));
  try {
    const p = path.join(dir, 'minimal.json');
    await writeFile(p, JSON.stringify({ id: 'x', instruction: 'y', ratio: 0, references: ['studies/color_01.jpg'] }));
    const brief = await loadBrief(p, syndicateDefaults);
    assert.equal(brief.rounds, 5);
    assert.equal(brief.variantsPerRound, 24);
    assert.equal(brief.survivors, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBrief rejects a brief missing required fields', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-brief-'));
  try {
    const p = path.join(dir, 'bad.json');
    await writeFile(p, JSON.stringify({ id: 'x' }));
    await assert.rejects(() => loadBrief(p, syndicateDefaults), /missing required field/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBrief rejects an out-of-range ratio', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-brief-'));
  try {
    const p = path.join(dir, 'bad-ratio.json');
    await writeFile(p, JSON.stringify({ id: 'x', instruction: 'y', ratio: 9, references: ['z'] }));
    await assert.rejects(() => loadBrief(p, syndicateDefaults), /ratio must be/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBrief rejects an unknown canvasFormat', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rubens-brief-'));
  try {
    const p = path.join(dir, 'bad-format.json');
    await writeFile(p, JSON.stringify({ id: 'x', instruction: 'y', ratio: 0, references: ['z'], canvasFormat: '50x50' }));
    await assert.rejects(() => loadBrief(p, syndicateDefaults), /canvasFormat "50x50" is not a known format/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadBrief rejects a missing file with a clear error, not a crash', async () => {
  await assert.rejects(() => loadBrief('/no/such/brief.json', syndicateDefaults), /could not read brief/);
});
