import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run, resolveBriefSource } from '../src/syndicate/run.js';
import { makeFakeClients } from './helpers/fake-clients.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const briefPath = path.join(root, 'test/fixtures/brief.json');
const runScript = path.join(root, 'src/syndicate/run.js');
const fakeEnv = { ANTHROPIC_API_KEY: 'fake', XAI_API_KEY: 'fake', OPENAI_API_KEY: 'fake' }; // run() only checks these are present, not that they're real
const fakeSupabaseEnv = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_EMAIL: 'owner@example.com', SUPABASE_PASSWORD: 'right-password' };
const fileConfig = JSON.parse(await readFile(path.join(root, 'config/syndicate.json'), 'utf8'));

// resolveBriefSource's Supabase path downloads its reference image with
// plain fetch — a real study photo's bytes stand in for "whatever Storage
// would have served," so analyseFile() downstream gets a real image
const studyJpegImpl = async (url) => {
  if (url !== 'https://x.supabase.co/storage/v1/object/public/references/study.jpg') {
    throw new Error(`fake fetch: unexpected url ${url}`);
  }
  const bytes = await readFile(path.join(root, 'studies/color_01.jpg'));
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

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

test('resolveBriefSource with no briefId loads from the local file, untouched by env', async () => {
  const { brief, referencePath, existingBriefId, accessToken } = await resolveBriefSource({
    briefPath, cwd: root, fileConfig, env: {}, dry: false,
  });
  assert.equal(brief.id, 'test-brief');
  assert.equal(existingBriefId, null);
  assert.equal(accessToken, null);
  assert.equal(referencePath, path.join(root, 'studies/color_01.jpg'));
});

test('resolveBriefSource with a briefId claims (not fetches) the row when not dry, and maps canvas_format to a ratio', async () => {
  let seenClaim = null;
  const brief = await resolveBriefSource({
    briefId: 'brief-uuid-9', cwd: root, fileConfig, env: fakeSupabaseEnv, dry: false, fetchImpl: studyJpegImpl,
    signIn: async () => ({ accessToken: 'jwt-abc' }),
    claimBrief: async (args) => { seenClaim = args; return { id: 'brief-uuid-9', slug: 'site-brief', instruction: 'Loosen.', canvas_format: '60x80', rounds: 2, reference: 'https://x.supabase.co/storage/v1/object/public/references/study.jpg' }; },
    fetchBriefById: async () => { throw new Error('should not be called when not dry'); },
  });
  assert.equal(seenClaim.briefId, 'brief-uuid-9');
  assert.equal(brief.brief.id, 'site-brief');
  assert.equal(brief.brief.ratio, 2, 'ratio is derived from canvas.js\'s CANVAS_PROFILES, not stored on the row');
  assert.equal(brief.brief.canvasFormat, '60x80');
  assert.equal(brief.existingBriefId, 'brief-uuid-9');
  assert.equal(brief.accessToken, 'jwt-abc');
  await assert.doesNotReject(readFile(brief.referencePath), 'the reference image should have been downloaded to a real local file');
});

test('resolveBriefSource with a briefId only reads (fetchBriefById) when dry, never claims', async () => {
  let claimCalled = false;
  const { existingBriefId } = await resolveBriefSource({
    briefId: 'brief-uuid-9', cwd: root, fileConfig, env: fakeSupabaseEnv, dry: true, fetchImpl: studyJpegImpl,
    signIn: async () => ({ accessToken: 'jwt-abc' }),
    claimBrief: async () => { claimCalled = true; return null; },
    fetchBriefById: async () => ({ id: 'brief-uuid-9', slug: 'site-brief', instruction: 'x', canvas_format: '70x100', rounds: 1, reference: 'https://x.supabase.co/storage/v1/object/public/references/study.jpg' }),
  });
  assert.equal(claimCalled, false, 'a dry run must never flip a real brief to running — see the comment in resolveBriefSource');
  assert.equal(existingBriefId, 'brief-uuid-9');
});

test('resolveBriefSource throws a clear error when the brief is already claimed (or does not exist)', async () => {
  await assert.rejects(
    () => resolveBriefSource({
      briefId: 'brief-uuid-9', cwd: root, fileConfig, env: fakeSupabaseEnv, dry: false, fetchImpl: studyJpegImpl,
      signIn: async () => ({ accessToken: 'jwt-abc' }),
      claimBrief: async () => null,
    }),
    /is not pending/,
  );
});

test('resolveBriefSource throws a clear error for an unknown canvas_format', async () => {
  await assert.rejects(
    () => resolveBriefSource({
      briefId: 'brief-uuid-9', cwd: root, fileConfig, env: fakeSupabaseEnv, dry: false, fetchImpl: studyJpegImpl,
      signIn: async () => ({ accessToken: 'jwt-abc' }),
      claimBrief: async () => ({ id: 'brief-uuid-9', slug: 'x', instruction: 'x', canvas_format: '50x50', rounds: 1, reference: 'https://x.supabase.co/storage/v1/object/public/references/study.jpg' }),
    }),
    /unknown canvas_format/,
  );
});

test('run({ briefId }) claims the brief, runs the shift, and updates (not inserts) the same row on publish', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  let seenSync = null;
  const fakeSync = {
    signIn: async () => ({ accessToken: 'jwt-abc' }),
    claimBrief: async () => ({ id: 'brief-uuid-9', slug: 'site-brief', instruction: 'Loosen the grid.', canvas_format: '70x100', rounds: 1, reference: 'https://x.supabase.co/storage/v1/object/public/references/study.jpg' }),
    fetchBriefById: async () => { throw new Error('should not be called for a non-dry run'); },
    syncShift: async (args) => { seenSync = args; return { briefId: args.briefId, variantCount: 1, comparisonCount: 0 }; },
  };
  try {
    const result = await run({
      briefId: 'brief-uuid-9', dry: false, cwd: root, runsDir,
      env: { ...fakeEnv, ...fakeSupabaseEnv }, clients: makeFakeClients(), sync: fakeSync, fetchImpl: studyJpegImpl,
    });
    assert.equal(result.published, true, result.publishError);
    assert.equal(seenSync.briefId, 'brief-uuid-9', 'syncShift must update the existing row, not insert a new one');
    assert.equal(seenSync.brief.id, 'site-brief');

    const runDir = path.join(runsDir, 'site-brief');
    await assert.doesNotReject(readFile(path.join(runDir, 'FINAL.md')));
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run({ briefId, publish: false }) still publishes — a claimed row must always be closed out', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  let published = false;
  const fakeSync = {
    signIn: async () => ({ accessToken: 'jwt-abc' }),
    claimBrief: async () => ({ id: 'brief-uuid-9', slug: 'site-brief', instruction: 'x', canvas_format: '70x100', rounds: 1, reference: 'https://x.supabase.co/storage/v1/object/public/references/study.jpg' }),
    syncShift: async () => { published = true; return { briefId: 'brief-uuid-9', variantCount: 1, comparisonCount: 0 }; },
  };
  try {
    const result = await run({
      briefId: 'brief-uuid-9', dry: false, cwd: root, runsDir, publish: false,
      env: { ...fakeEnv, ...fakeSupabaseEnv }, clients: makeFakeClients(), sync: fakeSync, fetchImpl: studyJpegImpl,
    });
    assert.equal(published, true);
    assert.equal(result.published, true);
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
