import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run } from '../src/syndicate/run.js';
import { makeFakeClients } from './helpers/fake-clients.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const briefPath = path.join(root, 'test/fixtures/brief.json');
const runScript = path.join(root, 'src/syndicate/run.js');
const fakeEnv = { ANTHROPIC_API_KEY: 'fake', XAI_API_KEY: 'fake', OPENAI_API_KEY: 'fake' }; // run() only checks these are present, not that they're real

test('run({ dry: true }) completes a full shift with no model calls, writing the documented layout', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  try {
    const result = await run({ briefPath, dry: true, cwd: root, runsDir });

    assert.equal(result.dry, true);
    assert.equal(result.roundsRun, 1); // the fixture brief sets rounds:1
    assert.equal(result.costSpent, 0, 'dry run must never spend anything');
    assert.ok(result.finalIds.length > 0);

    const runDir = path.join(runsDir, 'test-brief');
    for (const f of ['brief.json', 'base-state.json', 'palette.json', 'FINAL.md']) {
      await assert.doesNotReject(readFile(path.join(runDir, f)), `${f} should exist`);
    }

    const variantsDir = path.join(runDir, 'round-1', 'variants');
    const files = await readdir(variantsDir);
    const pngs = files.filter(f => f.endsWith('.png'));
    const jsons = files.filter(f => f.endsWith('.json'));
    assert.equal(pngs.length, 12); // fixture brief sets variantsPerRound:12
    assert.equal(jsons.length, 12);

    const baseState = JSON.parse(await readFile(path.join(runDir, 'base-state.json'), 'utf8'));
    assert.equal(baseState.S.ratio, 3); // fixture brief sets ratio:3
    assert.ok(baseState.S.L.every(l => l.ref === 0), 'every layer should be locked to the one analysed reference');
    assert.equal(baseState.refs.length, 1);

    const finalMd = await readFile(path.join(runDir, 'FINAL.md'), 'utf8');
    assert.match(finalMd, /# test-brief/);
    assert.match(finalMd, /Spend: \$0\.00/);
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run() throws a clear error for a real (non-dry) shift with no API keys configured', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  try {
    // env: {} is an explicit override — this must stay independent of
    // whatever the real repo's own .env happens to contain (it now holds
    // real keys), or this test stops testing "no keys" and instead fires a
    // real, paid shift. That happened once already; see run.js's `env`
    // param and the commit message for the incident.
    await assert.rejects(
      () => run({ briefPath, dry: false, cwd: root, runsDir, env: {} }),
      /ANTHROPIC_API_KEY|XAI_API_KEY|OPENAI_API_KEY/
    );
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run() never touches real clients when env is explicitly empty, even with dry:false', async () => {
  // belt-and-braces: assert the rejection happens before any client is
  // constructed or any file is written, by checking runsDir stays empty
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  try {
    await assert.rejects(() => run({ briefPath, dry: false, cwd: root, runsDir, env: {} }));
    const entries = await readdir(runsDir).catch(() => []);
    assert.deepEqual(entries, [], 'no run directory should have been created before the key check failed');
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run({ dry: false }) against fake clients writes cost-log.jsonl incrementally, one line per real charge', async () => {
  // exercises the exact non-dry code path that once fired a real shift by
  // accident (see the "no API keys" test above) — but entirely offline,
  // via injected fake clients, so it can safely run every time
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  try {
    const result = await run({ briefPath, dry: false, cwd: root, runsDir, env: fakeEnv, clients: makeFakeClients() });

    assert.equal(result.dry, false);
    assert.ok(result.costSpent > 0, 'fake clients report real-shaped usage, so cost should accumulate');

    const costLogPath = path.join(runsDir, 'test-brief', 'cost-log.jsonl');
    const lines = (await readFile(costLogPath, 'utf8')).trim().split('\n');
    assert.ok(lines.length > 0);
    const entries = lines.map(l => JSON.parse(l));
    for (const e of entries) {
      assert.ok(['anthropic', 'xai', 'openai'].includes(e.vendor));
      assert.ok(e.usd > 0);
      assert.ok(e.at);
    }
    const total = entries.reduce((s, e) => s + e.usd, 0);
    assert.ok(Math.abs(total - result.costSpent) < 1e-9, 'the log should sum to the same total run() reports');
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run() does not publish by default, and dry runs never publish even if asked', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  try {
    const r1 = await run({ briefPath, dry: true, cwd: root, runsDir });
    assert.equal(r1.published, false);
    assert.equal(r1.publishError, null);

    // publish:true is ignored in dry mode — nothing real to publish and no
    // key check to even attempt, same gate as the API-key check above it
    const r2 = await run({ briefPath, dry: true, cwd: root, runsDir, publish: true });
    assert.equal(r2.published, false);
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run({ publish: true }) reports (not throws) a clear error when SUPABASE_* is missing from env', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  try {
    const result = await run({ briefPath, dry: false, cwd: root, runsDir, env: fakeEnv, clients: makeFakeClients(), publish: true });
    assert.equal(result.published, false);
    assert.match(result.publishError, /SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_EMAIL|SUPABASE_PASSWORD/);
    // the shift itself must still have completed and written its record —
    // a failed publish is not the same thing as a failed shift
    await assert.doesNotReject(readFile(path.join(runsDir, 'test-brief', 'FINAL.md')));
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run({ publish: true }) calls the injected sync functions with the shift\'s real data and reports success', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  const fakeSupabaseEnv = { ...fakeEnv, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_EMAIL: 'owner@example.com', SUPABASE_PASSWORD: 'right-password' };
  let seenSignIn, seenSync;
  const fakeSync = {
    signIn: async (args) => { seenSignIn = args; return { accessToken: 'jwt-abc' }; },
    syncShift: async (args) => { seenSync = args; return { briefId: 'b1', variantCount: 4, comparisonCount: 2 }; },
  };
  try {
    const result = await run({ briefPath, dry: false, cwd: root, runsDir, env: fakeSupabaseEnv, clients: makeFakeClients(), publish: true, sync: fakeSync });
    assert.equal(result.published, true);
    assert.equal(result.publishError, null);
    assert.equal(seenSignIn.email, 'owner@example.com');
    assert.equal(seenSync.accessToken, 'jwt-abc');
    assert.equal(seenSync.brief.id, 'test-brief');
    assert.ok(seenSync.variantsById.size > 0);
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run({ publish: true }) reports a sync failure without throwing or losing the local record', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  const fakeSupabaseEnv = { ...fakeEnv, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_EMAIL: 'owner@example.com', SUPABASE_PASSWORD: 'right-password' };
  const failingSync = {
    signIn: async () => ({ accessToken: 'jwt-abc' }),
    syncShift: async () => { throw new Error('RLS: JWT expired'); },
  };
  try {
    const result = await run({ briefPath, dry: false, cwd: root, runsDir, env: fakeSupabaseEnv, clients: makeFakeClients(), publish: true, sync: failingSync });
    assert.equal(result.published, false);
    assert.match(result.publishError, /RLS: JWT expired/);
    await assert.doesNotReject(readFile(path.join(runsDir, 'test-brief', 'FINAL.md')));
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('the real CLI (node src/syndicate/run.js --dry) runs end to end', async () => {
  // the CLI always writes under <cwd>/runs (no --runsDir flag), so this
  // necessarily touches the real repo's runs/test-brief/ — clean it up after
  const writtenDir = path.join(root, 'runs', 'test-brief');
  try {
    const out = execFileSync(process.execPath, [runScript, '--brief', briefPath, '--dry'], { cwd: root, encoding: 'utf8' });
    assert.match(out, /dry run complete/);
    assert.match(out, /FINAL\.md/);
  } finally {
    await rm(writtenDir, { recursive: true, force: true });
  }
});
