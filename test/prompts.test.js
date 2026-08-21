import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatorSystemPrompt } from '../src/syndicate/prompts.js';
import { SCHEMA as MODEL_1 } from '../src/syndicate/patch.js';
import { SCHEMA as MODEL_2 } from '../src/syndicate/patch2.js';

test('each model is told its own knobs, not the other model s', () => {
  const one = generatorSystemPrompt('role', MODEL_1);
  const two = generatorSystemPrompt('role', MODEL_2);

  assert.match(one, /dyed/);
  assert.match(one, /L\[i\]\.ref/);
  assert.match(one, /ilock/);
  assert.doesNotMatch(one, /ink bars/);

  assert.match(two, /ink bars/);
  assert.match(two, /L\[i\]\.inks/);
  assert.match(two, /jitter/);
  assert.doesNotMatch(two, /L\[i\]\.ref/, "ref does not exist in model 2");
  assert.doesNotMatch(two, /ilock/);
});

/* The old prompt told every agent that L[i].ref was locked. It stopped being
   locked with the multireference fix (2026-08-18) and the sentence was never
   updated, so agents were refused a control they were allowed to use. The
   list is read off the schema now, which is what stops that recurring. */
test('the locked list is the schema s, not a sentence that can go stale', () => {
  for (const schema of [MODEL_1, MODEL_2]) {
    const p = generatorSystemPrompt('role', schema);
    for (const key of schema.lockedTop) assert.match(p, new RegExp(`Locked: [^\\n]*${key}`));
    assert.match(p, /every colour picker unless the brief explicitly names it as unlocked/);
  }
  const one = generatorSystemPrompt('role', MODEL_1);
  assert.doesNotMatch(one, /Locked: [^\n]*L\[i\]\.ref/, 'ref has been patchable since 2026-08-18');
});

test('model 2 agents are told inks come from the library, not from imagination', () => {
  assert.match(generatorSystemPrompt('role', MODEL_2), /from the generator's library, no invented values/);
});

test('the role prompt still leads, and the reply shape is still spelled out', () => {
  const p = generatorSystemPrompt('You compose by breaking.', MODEL_2);
  assert.ok(p.startsWith('You compose by breaking.'));
  assert.match(p, /"patch"/);
  assert.match(p, /no markdown fence/);
});

test('defaulting to model 1 keeps every existing caller working', () => {
  assert.equal(generatorSystemPrompt('role'), generatorSystemPrompt('role', MODEL_1));
});
