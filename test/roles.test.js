import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRICING } from '../src/syndicate/cost.js';
import { judgeVendor, judgeModel, activeJudges } from '../src/syndicate/judges.js';

const roles = JSON.parse(readFileSync(new URL('../config/roles.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../config/syndicate.json', import.meta.url), 'utf8'));

// The guard that matters before a paid shift: a judge naming a model with no
// price entry throws inside costTracker.add() only *after* the call has been
// made and paid for. Catch it here instead.
test('every judge names a vendor and a model that has a real, verified price', () => {
  assert.ok(roles.judges.length > 0);
  for (const j of roles.judges) {
    const vendor = judgeVendor(j);
    const model = judgeModel(j, config);
    assert.ok(model, `judge ${j.id} resolves to no model`);
    assert.ok(PRICING[vendor], `no pricing table for vendor ${vendor}`);
    assert.ok(PRICING[vendor][model], `no price for ${vendor}/${model} — add one to src/syndicate/cost.js`);
    assert.equal(PRICING[vendor][model].verified, true, `${vendor}/${model} is priced but UNVERIFIED`);
  }
});

test('judges are two to a vendor, and no two share a model', () => {
  const byVendor = new Map();
  for (const j of roles.judges) {
    if (!byVendor.has(j.vendor)) byVendor.set(j.vendor, []);
    byVendor.get(j.vendor).push(j.model);
  }
  for (const [vendor, models] of byVendor) {
    assert.equal(models.length, 2, `${vendor} should carry exactly two judges`);
  }
  const all = roles.judges.map(j => j.model);
  assert.equal(new Set(all).size, all.length, 'two judges share a model — that is one opinion, twice');
});

test('every judge has its own prompt and its own name', () => {
  const prompts = roles.judges.map(j => j.prompt.trim());
  assert.equal(new Set(prompts).size, prompts.length, 'six copies of one prompt is one judge, six times');
  for (const j of roles.judges) assert.ok(j.name, `judge ${j.id} has no display name`);
});

test('the old vendors[] shape throws instead of being silently reinterpreted', () => {
  assert.throws(
    () => judgeVendor({ id: 'legacy', vendors: ['anthropic', 'xai'] }),
    /old `vendors` array/,
  );
});

test('a judge with no rounds field judges every round', () => {
  const r = {
    judges: [
      { id: 'a', vendor: 'xai', model: 'grok-4.3' },
      { id: 'b', vendor: 'xai', model: 'grok-4.6', rounds: [2] },
    ],
  };
  assert.deepEqual(activeJudges(r, 1).map(j => j.id), ['a']);
  assert.deepEqual(activeJudges(r, 2).map(j => j.id), ['a', 'b']);
});
