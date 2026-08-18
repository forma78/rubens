import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signIn, syncShift, fetchBriefById, claimBrief } from '../src/syndicate/sync.js';

// A fake PostgREST + GoTrue endpoint. Never touches the network — this is
// the same dependency-injection pattern as clients/env in run.js, and for
// the same reason: a test must not be able to fire a real Supabase call.
function makeFakeSupabase({ seedBriefs = [] } = {}) {
  let n = 0;
  const nextId = () => `uuid-${++n}`;
  const calls = [];
  const tables = { briefs: [...seedBriefs], variants: [], comparisons: [] };

  const fetchImpl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method: opts.method, headers: opts.headers, body });
    const u = new URL(url);

    if (url.includes('/auth/v1/token')) {
      if (body.email !== 'owner@example.com' || body.password !== 'right-password') {
        return { ok: false, status: 400, text: async () => 'invalid_grant' };
      }
      return { ok: true, status: 200, json: async () => ({ access_token: 'jwt-abc', user: { id: 'user-1' } }) };
    }

    if (u.pathname === '/rest/v1/briefs' && (!opts.method || opts.method === 'GET')) {
      // GET /rest/v1/briefs?id=eq.<id>&select=* — fetchBriefById
      const idFilter = u.searchParams.get('id'); // 'eq.<uuid>'
      const id = idFilter?.startsWith('eq.') ? idFilter.slice(3) : null;
      const rows = tables.briefs.filter(r => r.id === id);
      return { ok: true, status: 200, json: async () => rows };
    }

    if (u.pathname === '/rest/v1/briefs' && opts.method === 'PATCH') {
      // claimBrief (id + status=eq.pending) or syncShift's update-existing
      // path (id only) — both are PATCH .../briefs?id=eq.<id>[&status=eq.X]
      const idFilter = u.searchParams.get('id');
      const id = idFilter?.startsWith('eq.') ? idFilter.slice(3) : null;
      const statusFilter = u.searchParams.get('status'); // 'eq.pending' or null
      const requiredStatus = statusFilter?.startsWith('eq.') ? statusFilter.slice(3) : null;
      const row = tables.briefs.find(r => r.id === id && (!requiredStatus || r.status === requiredStatus));
      if (!row) return { ok: true, status: 200, json: async () => [] };
      Object.assign(row, body);
      return { ok: true, status: 200, json: async () => [row] };
    }

    if (url.endsWith('/rest/v1/briefs')) {
      const row = { ...body, id: nextId() };
      tables.briefs.push(row);
      return { ok: true, status: 201, json: async () => [row] };
    }

    if (url.endsWith('/rest/v1/variants')) {
      const rows = body.map(r => ({ ...r, id: nextId() }));
      tables.variants.push(...rows);
      return { ok: true, status: 201, json: async () => rows };
    }

    if (url.endsWith('/rest/v1/comparisons')) {
      const rows = body.map(r => ({ ...r, id: nextId() }));
      tables.comparisons.push(...rows);
      return { ok: true, status: 201, json: async () => rows };
    }

    throw new Error(`fake supabase: unexpected url ${url}`);
  };

  return { fetchImpl, calls, tables };
}

test('signIn posts email/password and returns the access token', async () => {
  const { fetchImpl, calls } = makeFakeSupabase();
  const { accessToken, userId } = await signIn({
    supabaseUrl: 'https://x.supabase.co', apikey: 'anon-key',
    email: 'owner@example.com', password: 'right-password', fetchImpl,
  });
  assert.equal(accessToken, 'jwt-abc');
  assert.equal(userId, 'user-1');
  assert.equal(calls[0].headers.apikey, 'anon-key');
});

test('signIn throws with the response body on a failed sign-in', async () => {
  const { fetchImpl } = makeFakeSupabase();
  await assert.rejects(
    () => signIn({ supabaseUrl: 'https://x.supabase.co', apikey: 'anon-key', email: 'owner@example.com', password: 'wrong', fetchImpl }),
    /sign-in failed/,
  );
});

test('fetchBriefById returns the row for a known id', async () => {
  const { fetchImpl } = makeFakeSupabase({ seedBriefs: [{ id: 'brief-uuid-1', slug: 'x', status: 'pending' }] });
  const row = await fetchBriefById({ supabaseUrl: 'https://x.supabase.co', apikey: 'anon-key', accessToken: 'jwt-abc', briefId: 'brief-uuid-1', fetchImpl });
  assert.equal(row.slug, 'x');
});

test('fetchBriefById throws when no row matches', async () => {
  const { fetchImpl } = makeFakeSupabase();
  await assert.rejects(
    () => fetchBriefById({ supabaseUrl: 'https://x.supabase.co', apikey: 'anon-key', accessToken: 'jwt-abc', briefId: 'nope', fetchImpl }),
    /no brief found/,
  );
});

test('claimBrief flips a pending brief to running and returns it', async () => {
  const { fetchImpl, tables } = makeFakeSupabase({ seedBriefs: [{ id: 'brief-uuid-1', slug: 'x', status: 'pending' }] });
  const row = await claimBrief({ supabaseUrl: 'https://x.supabase.co', apikey: 'anon-key', accessToken: 'jwt-abc', briefId: 'brief-uuid-1', fetchImpl });
  assert.equal(row.status, 'running');
  assert.equal(tables.briefs[0].status, 'running', 'the underlying row is actually updated, not just the response');
});

test('claimBrief returns null instead of throwing when the brief is already claimed', async () => {
  const { fetchImpl } = makeFakeSupabase({ seedBriefs: [{ id: 'brief-uuid-1', slug: 'x', status: 'running' }] });
  const row = await claimBrief({ supabaseUrl: 'https://x.supabase.co', apikey: 'anon-key', accessToken: 'jwt-abc', briefId: 'brief-uuid-1', fetchImpl });
  assert.equal(row, null, 'two workers racing for the same brief is expected, not exceptional');
});

function baseArgs(fetchImpl) {
  return {
    supabaseUrl: 'https://x.supabase.co', apikey: 'anon-key', accessToken: 'jwt-abc',
    brief: { id: 'brief-07', instruction: 'Anxious.', reference: 'studies/x.jpg' },
    baseState: { cols: 10 }, palette: { pal: [[1, 2, 3]] },
    roundsRun: 2, costSpent: 1.23, aborted: false,
  };
}

test('syncShift inserts the brief, then variants round by round with parent_id resolved by label', async () => {
  const { fetchImpl, calls } = makeFakeSupabase();
  const variantsById = new Map([
    ['base', { id: 'base', roundNum: 'base', state: {}, source: 'base' }],
    ['r1-var-01', { id: 'r1-var-01', roundNum: 'round-1', source: 'mechanical', parentId: 'base', patch: { cols: 5 }, state: { cols: 5 }, intent: 'mechanical mutation' }],
    ['r2-var-01', { id: 'r2-var-01', roundNum: 'round-2', source: 'anthropic', generatorId: 'gen-tight', parentId: 'r1-var-01', patch: { rows: 8 }, state: { cols: 5, rows: 8 }, intent: 'Tighten.' }],
  ]);
  const allRatings = new Map([['r1-var-01', 1512.5]]);
  const allDisagreements = new Map([['r1-var-01', 0.25]]);
  const survivedIds = new Set(['r1-var-01', 'r2-var-01']);

  const result = await syncShift({
    ...baseArgs(fetchImpl), variantsById, comparisons: [], allRatings, allDisagreements, survivedIds,
  }, { fetchImpl });

  assert.equal(result.variantCount, 2, 'the base pseudo-variant is never synced');

  const variantCalls = calls.filter(c => c.url.endsWith('/rest/v1/variants'));
  assert.equal(variantCalls.length, 2, 'one batch insert per round, in round order');
  assert.equal(variantCalls[0].body[0].round, 1);
  assert.equal(variantCalls[0].body[0].label, 'r1-var-01');
  assert.equal(variantCalls[0].body[0].parent_id, null, "base was never synced, so round 1's parent_id is null, not invented");
  assert.equal(variantCalls[0].body[0].rating, 1512.5);
  assert.equal(variantCalls[0].body[0].disagreement, 0.25);

  assert.equal(variantCalls[1].body[0].round, 2);
  const r2Row = variantCalls[1].body[0];
  assert.equal(r2Row.agent_id, 'gen-tight');
  assert.ok(r2Row.parent_id.startsWith('uuid-'), 'round 2 parent_id resolves to the round-1 row actually inserted');
  assert.equal('rating' in r2Row, false, 'an unjudged variant omits rating so the DB default (1500) applies, rather than sending a fabricated value');
  assert.equal('disagreement' in r2Row, false);
});

test('syncShift inserts comparisons with FKs resolved from the variant label map', async () => {
  const { fetchImpl, calls } = makeFakeSupabase();
  const variantsById = new Map([
    ['r1-var-01', { id: 'r1-var-01', roundNum: 'round-1', source: 'mechanical', parentId: 'base', patch: {}, state: {} }],
    ['r1-var-02', { id: 'r1-var-02', roundNum: 'round-1', source: 'mechanical', parentId: 'base', patch: {}, state: {} }],
  ]);
  const comparisons = [
    { round: 1, judgeId: 'architect', vendor: 'anthropic', model: 'claude-sonnet-5', a: 'r1-var-01', b: 'r1-var-02', slotA: 'r1-var-02', winner: 'r1-var-01', why: 'Bolder.', requestId: 'req_1', usage: { input_tokens: 100, output_tokens: 20 } },
  ];

  const result = await syncShift({
    ...baseArgs(fetchImpl), variantsById, comparisons,
    allRatings: new Map(), allDisagreements: new Map(), survivedIds: new Set(),
  }, { fetchImpl });

  assert.equal(result.comparisonCount, 1);
  const compCall = calls.find(c => c.url.endsWith('/rest/v1/comparisons'));
  const row = compCall.body[0];
  assert.equal(row.judge_id, 'architect');
  assert.equal(row.model, 'claude-sonnet-5');
  assert.equal(row.tokens_in, 100);
  assert.equal(row.tokens_out, 20);
  assert.ok(row.left_id.startsWith('uuid-') && row.right_id.startsWith('uuid-') && row.winner_id.startsWith('uuid-') && row.shown_first.startsWith('uuid-'));
});

test('syncShift skips a comparison that references an unsynced variant instead of inventing a row', async () => {
  const { fetchImpl } = makeFakeSupabase();
  const variantsById = new Map([
    ['r1-var-01', { id: 'r1-var-01', roundNum: 'round-1', source: 'mechanical', parentId: 'base', patch: {}, state: {} }],
  ]);
  // 'base' never gets synced (it's not a round variant), so a comparison
  // that somehow touched it could never have a valid left_id/right_id
  const comparisons = [
    { round: 1, judgeId: 'architect', vendor: 'anthropic', model: 'm', a: 'r1-var-01', b: 'base', slotA: 'r1-var-01', winner: 'r1-var-01', why: 'x' },
  ];
  const result = await syncShift({
    ...baseArgs(fetchImpl), variantsById, comparisons,
    allRatings: new Map(), allDisagreements: new Map(), survivedIds: new Set(),
  }, { fetchImpl });
  assert.equal(result.comparisonCount, 0);
});

test('syncShift includes canvas_format when inserting a fresh brief row', async () => {
  const { fetchImpl, calls } = makeFakeSupabase();
  await syncShift({
    ...baseArgs(fetchImpl), brief: { ...baseArgs(fetchImpl).brief, canvasFormat: '60x80' },
    variantsById: new Map(), comparisons: [], allRatings: new Map(), allDisagreements: new Map(), survivedIds: new Set(),
  }, { fetchImpl });
  const insertCall = calls.find(c => c.url.endsWith('/rest/v1/briefs') && c.method === 'POST');
  assert.equal(insertCall.body.canvas_format, '60x80');
});

test('syncShift updates an existing brief row in place when briefId is given, instead of inserting a new one', async () => {
  const { fetchImpl, calls, tables } = makeFakeSupabase({
    seedBriefs: [{ id: 'brief-uuid-1', slug: 'site-brief', instruction: 'from the site', canvas_format: '60x80', status: 'running' }],
  });
  const result = await syncShift({
    ...baseArgs(fetchImpl), briefId: 'brief-uuid-1',
    variantsById: new Map(), comparisons: [], allRatings: new Map(), allDisagreements: new Map(), survivedIds: new Set(),
  }, { fetchImpl });

  assert.equal(result.briefId, 'brief-uuid-1');
  const briefCalls = calls.filter(c => c.url.includes('/rest/v1/briefs'));
  assert.equal(briefCalls.some(c => c.method === 'POST'), false, 'no new row should be inserted');
  assert.equal(tables.briefs.length, 1, 'still exactly the one seeded row');
  assert.equal(tables.briefs[0].status, 'done');
  assert.equal(tables.briefs[0].slug, 'site-brief', 'fields set at creation time are left alone');
});

test('syncShift throws with the response body when the briefs insert is rejected (e.g. RLS)', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/rest/v1/briefs')) return { ok: false, status: 401, text: async () => 'JWT expired' };
    throw new Error('should not reach further calls');
  };
  await assert.rejects(
    () => syncShift({ ...baseArgs(fetchImpl), variantsById: new Map(), comparisons: [], allRatings: new Map(), allDisagreements: new Map(), survivedIds: new Set() }, { fetchImpl }),
    /briefs insert failed.*JWT expired/,
  );
});
