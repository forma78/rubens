import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signIn, fetchBriefById, claimBrief,
  insertBrief, closeBrief, syncVariants, syncVariantResults, syncComparisons,
} from '../src/syndicate/sync.js';

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
      // claimBrief (id + status=eq.pending) or closeBrief (id only) — both
      // are PATCH .../briefs?id=eq.<id>[&status=eq.X]
      const idFilter = u.searchParams.get('id');
      const id = idFilter?.startsWith('eq.') ? idFilter.slice(3) : null;
      const statusFilter = u.searchParams.get('status'); // 'eq.pending' or null
      const requiredStatus = statusFilter?.startsWith('eq.') ? statusFilter.slice(3) : null;
      const row = tables.briefs.find(r => r.id === id && (!requiredStatus || r.status === requiredStatus));
      if (!row) return { ok: true, status: 200, json: async () => [] };
      Object.assign(row, body);
      return { ok: true, status: 200, json: async () => [row] };
    }

    if (u.pathname === '/rest/v1/briefs') {
      const row = { ...body, id: nextId() };
      tables.briefs.push(row);
      return { ok: true, status: 201, json: async () => [row] };
    }

    if (u.pathname === '/rest/v1/variants') {
      // syncVariantResults upserts via Prefer: resolution=merge-duplicates
      // with an explicit id in each row — merge onto the existing row
      // instead of inserting a new one when that's the case
      const isUpsert = (opts.headers?.Prefer ?? '').includes('merge-duplicates');
      const rows = body.map(r => {
        if (isUpsert && r.id) {
          const existing = tables.variants.find(v => v.id === r.id);
          if (existing) { Object.assign(existing, r); return existing; }
        }
        const row = { ...r, id: r.id ?? nextId() };
        tables.variants.push(row);
        return row;
      });
      return { ok: true, status: 201, json: async () => rows };
    }

    if (u.pathname === '/rest/v1/comparisons') {
      const rows = body.map(r => ({ ...r, id: nextId() }));
      tables.comparisons.push(...rows);
      return { ok: true, status: 201, json: async () => rows };
    }

    throw new Error(`fake supabase: unexpected url ${url}`);
  };

  return { fetchImpl, calls, tables };
}

const ctx = (fetchImpl, extra = {}) => ({ supabaseUrl: 'https://x.supabase.co', apikey: 'anon-key', accessToken: 'jwt-abc', fetchImpl, ...extra });

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
  const row = await fetchBriefById({ ...ctx(fetchImpl), briefId: 'brief-uuid-1' });
  assert.equal(row.slug, 'x');
});

test('fetchBriefById throws when no row matches', async () => {
  const { fetchImpl } = makeFakeSupabase();
  await assert.rejects(() => fetchBriefById({ ...ctx(fetchImpl), briefId: 'nope' }), /no brief found/);
});

test('claimBrief flips a pending brief to running and returns it', async () => {
  const { fetchImpl, tables } = makeFakeSupabase({ seedBriefs: [{ id: 'brief-uuid-1', slug: 'x', status: 'pending' }] });
  const row = await claimBrief({ ...ctx(fetchImpl), briefId: 'brief-uuid-1' });
  assert.equal(row.status, 'running');
  assert.equal(tables.briefs[0].status, 'running', 'the underlying row is actually updated, not just the response');
});

test('claimBrief returns null instead of throwing when the brief is already claimed', async () => {
  const { fetchImpl } = makeFakeSupabase({ seedBriefs: [{ id: 'brief-uuid-1', slug: 'x', status: 'running' }] });
  const row = await claimBrief({ ...ctx(fetchImpl), briefId: 'brief-uuid-1' });
  assert.equal(row, null, 'two workers racing for the same brief is expected, not exceptional');
});

test('insertBrief creates a running row and includes canvas_format', async () => {
  const { fetchImpl, calls } = makeFakeSupabase();
  const { briefId } = await insertBrief({
    ...ctx(fetchImpl), brief: { id: 'brief-07', instruction: 'Anxious.', canvasFormat: '60x80', reference: 'studies/x.jpg', rounds: 5 },
  });
  assert.ok(briefId);
  const insertCall = calls.find(c => c.url.endsWith('/rest/v1/briefs') && c.method === 'POST');
  assert.equal(insertCall.body.slug, 'brief-07');
  assert.equal(insertCall.body.canvas_format, '60x80');
  assert.equal(insertCall.body.status, 'running', 'inserted as running immediately, not done at the end');
});

test('closeBrief patches the final status/cost/base_state onto an existing row', async () => {
  const { fetchImpl, tables } = makeFakeSupabase({ seedBriefs: [{ id: 'brief-uuid-1', slug: 'x', status: 'running' }] });
  await closeBrief({ ...ctx(fetchImpl), briefId: 'brief-uuid-1', baseState: { cols: 5 }, palette: { pal: [] }, rounds: 3, status: 'done', costUsd: 1.23 });
  assert.equal(tables.briefs[0].status, 'done');
  assert.equal(tables.briefs[0].cost_usd, 1.23);
  assert.equal(tables.briefs[0].rounds, 3);
});

test('closeBrief throws when it matches no row', async () => {
  const { fetchImpl } = makeFakeSupabase();
  await assert.rejects(
    () => closeBrief({ ...ctx(fetchImpl), briefId: 'nope', baseState: {}, palette: null, rounds: 1, status: 'done', costUsd: 0 }),
    /matched no row/,
  );
});

test('syncVariants inserts only round variants (skips the base pseudo-variant) and extends labelToUuid', async () => {
  const { fetchImpl } = makeFakeSupabase();
  const labelToUuid = new Map();
  const variants = [
    { id: 'base', roundNum: 'base', state: {}, source: 'base' },
    { id: 'r1-var-01', roundNum: 'round-1', source: 'mechanical', parentId: 'base', patch: { cols: 5 }, state: { cols: 5 }, intent: 'mechanical mutation' },
  ];
  const { count } = await syncVariants({ ...ctx(fetchImpl), briefId: 'brief-uuid-1', variants, labelToUuid });
  assert.equal(count, 1, 'the base pseudo-variant is never synced');
  assert.ok(labelToUuid.get('r1-var-01')?.startsWith('uuid-'));
});

test('syncVariants resolves parent_id from an already-synced label (a survivor from an earlier round)', async () => {
  const { fetchImpl, calls } = makeFakeSupabase();
  const labelToUuid = new Map([['r1-var-01', 'uuid-parent']]);
  await syncVariants({
    ...ctx(fetchImpl), briefId: 'brief-uuid-1', labelToUuid,
    variants: [{ id: 'r2-var-01', roundNum: 'round-2', source: 'anthropic', generatorId: 'gen-tight', parentId: 'r1-var-01', patch: {}, state: {}, intent: 'x' }],
  });
  const insertCall = calls.find(c => c.url.endsWith('/rest/v1/variants') && c.method === 'POST');
  assert.equal(insertCall.body[0].parent_id, 'uuid-parent');
  assert.equal(insertCall.body[0].agent_id, 'gen-tight');
});

test('syncVariants leaves rating/disagreement/survived unset — not known until judging happens', async () => {
  const { fetchImpl, calls } = makeFakeSupabase();
  await syncVariants({
    ...ctx(fetchImpl), briefId: 'brief-uuid-1', labelToUuid: new Map(),
    variants: [{ id: 'r1-var-01', roundNum: 'round-1', source: 'mechanical', parentId: 'base', patch: {}, state: {} }],
  });
  const insertCall = calls.find(c => c.url.endsWith('/rest/v1/variants') && c.method === 'POST');
  assert.equal('rating' in insertCall.body[0], false);
  assert.equal('disagreement' in insertCall.body[0], false);
  assert.equal('survived' in insertCall.body[0], false);
});

test('syncVariantResults upserts rating/disagreement/survived onto already-synced rows by their known id', async () => {
  const { fetchImpl, tables } = makeFakeSupabase();
  tables.variants.push({ id: 'uuid-5', label: 'r1-var-01', rating: 1500, disagreement: 0, survived: false });
  await syncVariantResults({
    ...ctx(fetchImpl), variants: [{ id: 'r1-var-01' }], labelToUuid: new Map([['r1-var-01', 'uuid-5']]),
    allRatings: new Map([['r1-var-01', 1550]]), allDisagreements: new Map([['r1-var-01', 0.5]]), survivedIds: new Set(['r1-var-01']),
  });
  assert.equal(tables.variants.length, 1, 'no duplicate row — the existing one was updated');
  assert.equal(tables.variants[0].rating, 1550);
  assert.equal(tables.variants[0].disagreement, 0.5);
  assert.equal(tables.variants[0].survived, true);
});

test('syncVariantResults skips a variant that was never synced instead of inventing a row', async () => {
  const { fetchImpl, tables } = makeFakeSupabase();
  const { count } = await syncVariantResults({
    ...ctx(fetchImpl), variants: [{ id: 'never-synced' }], labelToUuid: new Map(),
    allRatings: new Map(), allDisagreements: new Map(), survivedIds: new Set(),
  });
  assert.equal(count, 0);
  assert.equal(tables.variants.length, 0);
});

test('syncComparisons inserts with FKs resolved from the variant label map', async () => {
  const { fetchImpl, calls } = makeFakeSupabase();
  const labelToUuid = new Map([['r1-var-01', 'uuid-1'], ['r1-var-02', 'uuid-2']]);
  const comparisons = [
    { round: 1, judgeId: 'architect', vendor: 'anthropic', model: 'claude-sonnet-5', a: 'r1-var-01', b: 'r1-var-02', slotA: 'r1-var-02', winner: 'r1-var-01', why: 'Bolder.', requestId: 'req_1', usage: { input_tokens: 100, output_tokens: 20 } },
  ];
  const { count } = await syncComparisons({ ...ctx(fetchImpl), briefId: 'brief-uuid-1', comparisons, labelToUuid });
  assert.equal(count, 1);
  const compCall = calls.find(c => c.url.endsWith('/rest/v1/comparisons'));
  const row = compCall.body[0];
  assert.equal(row.judge_id, 'architect');
  assert.equal(row.model, 'claude-sonnet-5');
  assert.equal(row.tokens_in, 100);
  assert.equal(row.tokens_out, 20);
  assert.equal(row.left_id, 'uuid-1');
  assert.equal(row.right_id, 'uuid-2');
  assert.equal(row.winner_id, 'uuid-1');
  assert.equal(row.shown_first, 'uuid-2');
});

test('syncComparisons skips a comparison that references an unsynced variant instead of inventing a row', async () => {
  const { fetchImpl } = makeFakeSupabase();
  const labelToUuid = new Map([['r1-var-01', 'uuid-1']]);
  const comparisons = [
    { round: 1, judgeId: 'architect', vendor: 'anthropic', model: 'm', a: 'r1-var-01', b: 'base', slotA: 'r1-var-01', winner: 'r1-var-01', why: 'x' },
  ];
  const { count } = await syncComparisons({ ...ctx(fetchImpl), briefId: 'brief-uuid-1', comparisons, labelToUuid });
  assert.equal(count, 0);
});

test('syncComparisons throws with the response body on failure', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/rest/v1/comparisons')) return { ok: false, status: 401, text: async () => 'JWT expired' };
    throw new Error('should not reach further calls');
  };
  const labelToUuid = new Map([['a', 'uuid-1'], ['b', 'uuid-2']]);
  await assert.rejects(
    () => syncComparisons({
      ...ctx(fetchImpl), briefId: 'brief-uuid-1', labelToUuid,
      comparisons: [{ round: 1, judgeId: 'x', vendor: 'v', model: 'm', a: 'a', b: 'b', slotA: 'a', winner: 'a', why: 'x' }],
    }),
    /comparisons insert failed.*JWT expired/,
  );
});
