/* SPEC 4 — the archive. Batch sync: once a shift has finished and written
   everything to runs/<brief.id>/ (the durable record — see CLAUDE.md), push
   the same data to Supabase in one pass, metadata only. No image upload yet
   (that's Storage, deferred to Phase 5, when the site actually needs it);
   render_url is left unset here.

   RLS ties every row to auth.uid() via a `default auth.uid()` column, so
   writing requires a signed-in user, not just the anon key — signIn() does
   the password grant and hands back a bearer token for syncShift().

   Plain fetch against Supabase's PostgREST endpoint, no SDK: this is a
   handful of HTTP calls, and CLAUDE.md prices every dependency. */

/** signIn({ supabaseUrl, apikey, email, password, fetchImpl }) -> { accessToken, userId } */
async function signIn({ supabaseUrl, apikey, email, password, fetchImpl = fetch }) {
  const res = await fetchImpl(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sync: sign-in failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { accessToken: body.access_token, userId: body.user?.id };
}

/** fetchBriefById({ supabaseUrl, apikey, accessToken, briefId, fetchImpl })
 *  -> the briefs row, or throws if none exists (or RLS hides it — the
 *  caller must already be signed in as the row's owner). */
async function fetchBriefById({ supabaseUrl, apikey, accessToken, briefId, fetchImpl = fetch }) {
  const headers = { apikey, Authorization: `Bearer ${accessToken}` };
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/briefs?id=eq.${briefId}&select=*`, { headers });
  if (!res.ok) throw new Error(`sync: fetching brief ${briefId} failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`sync: no brief found with id ${briefId}`);
  return rows[0];
}

/** claimBrief({ supabaseUrl, apikey, accessToken, briefId, fetchImpl }) ->
 *  the claimed row, or null.
 *
 *  Atomically flips status pending -> running: the WHERE clause carries
 *  both the id and status:eq.pending, so PostgREST only touches the row
 *  if it is still pending at the moment this UPDATE executes. Two workers
 *  racing for the same brief is expected (a scheduled GitHub Actions tick
 *  firing while another is mid-run), not exceptional — the loser gets an
 *  empty result and should treat that as "nothing to do," not an error. */
async function claimBrief({ supabaseUrl, apikey, accessToken, briefId, fetchImpl = fetch }) {
  const headers = {
    apikey, Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  };
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/briefs?id=eq.${briefId}&status=eq.pending`, {
    method: 'PATCH', headers, body: JSON.stringify({ status: 'running' }),
  });
  if (!res.ok) throw new Error(`sync: claiming brief ${briefId} failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

function tokensFromUsage(usage) {
  if (!usage) return { in: null, out: null };
  // Anthropic-shaped usage has input_tokens/output_tokens; xAI/OpenAI (both
  // openai-client-shaped) have prompt_tokens/completion_tokens
  if ('input_tokens' in usage) return { in: usage.input_tokens ?? null, out: usage.output_tokens ?? null };
  return { in: usage.prompt_tokens ?? null, out: usage.completion_tokens ?? null };
}

function roundNumOf(v) {
  const m = /^round-(\d+)$/.exec(v.roundNum ?? '');
  return m ? Number(m[1]) : null;
}

async function insertVariants(fetchImpl, supabaseUrl, headers, briefId, variants, allRatings, allDisagreements, survivedIds) {
  const byRound = new Map();
  for (const v of variants) {
    const n = roundNumOf(v);
    if (n == null) continue; // the base pseudo-variant has no round and is never synced
    if (!byRound.has(n)) byRound.set(n, []);
    byRound.get(n).push(v);
  }
  const roundNums = [...byRound.keys()].sort((a, b) => a - b);

  const labelToUuid = new Map();
  let count = 0;
  for (const n of roundNums) {
    const rows = byRound.get(n).map(v => {
      const row = {
        brief_id: briefId,
        round: n,
        label: v.id,
        source: v.source,
        agent_id: v.generatorId ?? null,
        parent_id: labelToUuid.get(v.parentId) ?? null,
        patch: v.patch ?? {},
        state: v.state,
        intent: v.intent ?? null,
        survived: survivedIds.has(v.id),
      };
      // rating/disagreement have DB defaults (1500 / 0); omit the key
      // entirely for an unjudged variant rather than write a fabricated 0
      const rating = allRatings.get(v.id);
      if (rating != null) row.rating = rating;
      const dis = allDisagreements.get(v.id);
      if (dis != null) row.disagreement = dis;
      return row;
    });
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/variants`, { method: 'POST', headers, body: JSON.stringify(rows) });
    if (!res.ok) throw new Error(`sync: variants insert failed (round ${n}): ${res.status} ${await res.text()}`);
    const inserted = await res.json();
    for (const row of inserted) labelToUuid.set(row.label, row.id);
    count += inserted.length;
  }
  return { labelToUuid, count };
}

async function insertComparisons(fetchImpl, supabaseUrl, headers, briefId, comparisons, labelToUuid) {
  const rows = [];
  for (const c of comparisons) {
    const leftId = labelToUuid.get(c.a);
    const rightId = labelToUuid.get(c.b);
    const winnerId = labelToUuid.get(c.winner);
    const shownFirst = labelToUuid.get(c.slotA);
    // a pair touching an unsynced variant (shouldn't happen past round 1,
    // where the only unsynced id is 'base') is skipped, not invented
    if (!leftId || !rightId || !winnerId || !shownFirst) continue;
    const tokens = tokensFromUsage(c.usage);
    rows.push({
      brief_id: briefId,
      round: c.round,
      judge_id: c.judgeId,
      vendor: c.vendor,
      model: c.model,
      request_id: c.requestId ?? null,
      left_id: leftId,
      right_id: rightId,
      shown_first: shownFirst,
      winner_id: winnerId,
      why: c.why ?? null,
      tokens_in: tokens.in,
      tokens_out: tokens.out,
    });
  }
  if (!rows.length) return { count: 0 };
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/comparisons`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`sync: comparisons insert failed: ${res.status} ${await res.text()}`);
  return { count: rows.length };
}

/**
 * syncShift({ supabaseUrl, apikey, accessToken, brief, baseState, palette,
 * variantsById, comparisons, allRatings, allDisagreements, survivedIds,
 * roundsRun, costSpent, aborted, briefId }, { fetchImpl }) ->
 * { briefId, variantCount, comparisonCount }
 *
 * briefId: pass the Supabase id of an *existing* row (site-created,
 * already claimed via claimBrief) to update it in place with the finished
 * shift's results. Omit it for the original flow — a shift that started
 * from a local JSON brief has no existing row, so one is inserted fresh.
 */
async function syncShift({
  supabaseUrl, apikey, accessToken, brief, baseState, palette,
  variantsById, comparisons, allRatings, allDisagreements, survivedIds,
  roundsRun, costSpent, aborted, briefId,
}, { fetchImpl = fetch } = {}) {
  const headers = {
    apikey, Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  };

  let resolvedBriefId = briefId;
  if (resolvedBriefId) {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/briefs?id=eq.${resolvedBriefId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        base_state: baseState,
        palette: palette ?? null,
        rounds: roundsRun,
        status: aborted ? 'aborted' : 'done',
        cost_usd: costSpent,
      }),
    });
    if (!res.ok) throw new Error(`sync: briefs update failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    if (!rows.length) throw new Error(`sync: briefs update matched no row for id ${resolvedBriefId}`);
  } else {
    const briefRes = await fetchImpl(`${supabaseUrl}/rest/v1/briefs`, {
      method: 'POST', headers,
      body: JSON.stringify({
        slug: brief.id,
        instruction: brief.instruction,
        canvas_format: brief.canvasFormat ?? null,
        base_state: baseState,
        palette: palette ?? null,
        reference: brief.reference ?? null,
        rounds: roundsRun,
        status: aborted ? 'aborted' : 'done',
        cost_usd: costSpent,
      }),
    });
    if (!briefRes.ok) throw new Error(`sync: briefs insert failed: ${briefRes.status} ${await briefRes.text()}`);
    const [briefRow] = await briefRes.json();
    resolvedBriefId = briefRow.id;
  }

  const variants = [...variantsById.values()];
  const { labelToUuid, count: variantCount } = await insertVariants(
    fetchImpl, supabaseUrl, headers, resolvedBriefId, variants, allRatings, allDisagreements, survivedIds,
  );
  const { count: comparisonCount } = await insertComparisons(
    fetchImpl, supabaseUrl, headers, resolvedBriefId, comparisons, labelToUuid,
  );

  return { briefId: resolvedBriefId, variantCount, comparisonCount };
}

export { signIn, syncShift, fetchBriefById, claimBrief };
