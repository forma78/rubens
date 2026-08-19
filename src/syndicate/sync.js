/* SPEC 4 — the archive. Incremental sync: a brief's row exists in Supabase
   from the moment a shift starts (not just at the end), and each variant —
   image included — and each vendor's comparisons land as soon as they're
   real, not batched into one push after everything finishes. The point
   isn't just archival — a public RubensJournal feed reading straight off
   this table only feels alive if posts and comments actually trickle in
   while a shift runs (a shift can legitimately take 60-180 minutes; that
   wait is the show, not a cost to hide).

   A variant's render is uploaded to Storage *before* its row is inserted,
   with render_url already set — a variants row with no image should be
   impossible to observe, not just a convention placeholders happen to
   follow. Comparisons stay batched through the vendors' own Batch APIs
   (half price, SPEC 3.5) and land per-vendor or per-pair as they actually
   return — variants stream one at a time, verdicts are allowed to catch up.

   RLS ties every row to auth.uid() via a `default auth.uid()` column, so
   writing requires a signed-in user, not just the anon key — signIn() does
   the password grant and hands back a bearer token for everything below.

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

/** insertBrief({ supabaseUrl, apikey, accessToken, brief, fetchImpl }) ->
 *  { briefId }
 *
 *  For a shift that started from a local JSON brief (no existing Supabase
 *  row — a --brief-id shift already has one via claimBrief). Inserted as
 *  'running' immediately, at the top of the shift, not 'done' at the
 *  bottom: variants and comparisons need a real brief_id to reference as
 *  they're synced incrementally, and a viewer watching the feed should see
 *  the shift as in-progress while it runs. */
async function insertBrief({ supabaseUrl, apikey, accessToken, brief, fetchImpl = fetch }) {
  const headers = {
    apikey, Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  };
  // the briefs table's `reference` column is still a single URL (the site's
  // brief-creation form only uploads one image today — see the note on
  // resolveBriefSource in run.js) — a local brief that gave up to 4 is
  // recorded here by its first real one, same as what judges are shown
  const primaryReference = brief.references?.find(r => r) ?? null;
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/briefs`, {
    method: 'POST', headers,
    body: JSON.stringify({
      slug: brief.id,
      instruction: brief.instruction,
      canvas_format: brief.canvasFormat ?? null,
      reference: primaryReference,
      rounds: brief.rounds,
      status: 'running',
    }),
  });
  if (!res.ok) throw new Error(`sync: briefs insert failed: ${res.status} ${await res.text()}`);
  const [row] = await res.json();
  return { briefId: row.id };
}

/** closeBrief({ supabaseUrl, apikey, accessToken, briefId, baseState,
 *  palette, rounds, status, costUsd, fetchImpl }) -> void
 *
 *  The last call of a shift: sets the fields only known once it's over.
 *  Everything else (variants, comparisons) was already synced as it
 *  happened — this only has to close the brief row out. */
async function closeBrief({ supabaseUrl, apikey, accessToken, briefId, baseState, palette, rounds, status, costUsd, fetchImpl = fetch }) {
  const headers = {
    apikey, Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  };
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/briefs?id=eq.${briefId}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ base_state: baseState, palette: palette ?? null, rounds, status, cost_usd: costUsd }),
  });
  if (!res.ok) throw new Error(`sync: briefs close failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`sync: briefs close matched no row for id ${briefId}`);
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

/** uploadRender({ supabaseUrl, apikey, accessToken, briefId, label, jpeg,
 *  fetchImpl }) -> the public URL it now lives at.
 *
 *  The 768px transmission JPEG every variant already gets rendered for the
 *  judges (round.js's renderRound) — reused here as-is, no separate
 *  higher-res asset. Uploaded to the `renders` bucket (public read, owner
 *  upload only — see schema.sql), one object per variant. */
async function uploadRender({ supabaseUrl, apikey, accessToken, briefId, label, jpeg, fetchImpl = fetch }) {
  const objectPath = `${briefId}/${label}.jpg`;
  const res = await fetchImpl(`${supabaseUrl}/storage/v1/object/renders/${objectPath}`, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/jpeg' },
    body: jpeg,
  });
  if (!res.ok) throw new Error(`sync: render upload failed for ${label}: ${res.status} ${await res.text()}`);
  return `${supabaseUrl}/storage/v1/object/public/renders/${objectPath}`;
}

/**
 * syncVariant({ supabaseUrl, apikey, accessToken, briefId, variant,
 * labelToUuid, fetchImpl }) -> the inserted row, or null (the base
 * pseudo-variant, never synced)
 *
 * One variant at a time — called from renderRound's onRendered callback,
 * so a variant's "post" appears on the feed the moment it's ready, not
 * batched with the rest of the round, and definitely not after judging.
 * The image is uploaded *before* the row is inserted, deliberately: a
 * variants row with no render_url should be impossible to observe, not
 * just a convention "pending" placeholders happen to follow.
 *
 * Extends `labelToUuid` *in place* with label -> Supabase-id, so a later
 * syncComparisons() or syncVariantResults() call can resolve FKs —
 * including a parent from an earlier round, already in the map from that
 * round's own syncVariant() calls.
 *
 * rating/disagreement/survived aren't known yet at this point (judging
 * hasn't happened) — left at their DB defaults (1500 / 0 / false) here,
 * updated later by syncVariantResults() once selectRound() has run.
 */
async function syncVariant({ supabaseUrl, apikey, accessToken, briefId, variant, labelToUuid, fetchImpl = fetch }) {
  const round = roundNumOf(variant);
  if (round == null) return null; // the base pseudo-variant is never synced

  const renderUrl = await uploadRender({ supabaseUrl, apikey, accessToken, briefId, label: variant.id, jpeg: variant.jpeg, fetchImpl });

  const headers = {
    apikey, Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  };
  const row = {
    brief_id: briefId,
    round,
    label: variant.id,
    source: variant.source,
    agent_id: variant.generatorId ?? null,
    parent_id: labelToUuid.get(variant.parentId) ?? null,
    patch: variant.patch ?? {},
    state: variant.state,
    intent: variant.intent ?? null,
    render_url: renderUrl,
  };
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/variants`, { method: 'POST', headers, body: JSON.stringify([row]) });
  if (!res.ok) throw new Error(`sync: variant insert failed for ${variant.id}: ${res.status} ${await res.text()}`);
  const [inserted] = await res.json();
  labelToUuid.set(inserted.label, inserted.id);
  return inserted;
}

/**
 * syncVariantResults({ supabaseUrl, apikey, accessToken, variants,
 * labelToUuid, allRatings, allDisagreements, survivedIds, fetchImpl }) ->
 * { count }
 *
 * Called after selectRound() for the round just judged: now that ratings,
 * disagreements and survival are known, patch them onto the rows
 * syncVariants() already inserted. Upserts on the variant's own primary
 * key (already known via labelToUuid) via PostgREST's merge-duplicates
 * resolution — cheaper than N individual PATCH calls for one round.
 */
async function syncVariantResults({ supabaseUrl, apikey, accessToken, variants, labelToUuid, allRatings, allDisagreements, survivedIds, fetchImpl = fetch }) {
  const headers = {
    apikey, Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  const rows = [];
  for (const v of variants) {
    const id = labelToUuid.get(v.id);
    if (!id) continue; // wasn't synced (shouldn't happen — every judged variant was just syncVariants()'d)
    const row = { id, survived: survivedIds.has(v.id) };
    const rating = allRatings.get(v.id);
    if (rating != null) row.rating = rating;
    const dis = allDisagreements.get(v.id);
    if (dis != null) row.disagreement = dis;
    rows.push(row);
  }
  if (!rows.length) return { count: 0 };
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/variants`, { method: 'POST', headers, body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`sync: variant results upsert failed: ${res.status} ${await res.text()}`);
  return { count: rows.length };
}

/**
 * syncComparisons({ supabaseUrl, apikey, accessToken, briefId, comparisons,
 * labelToUuid, fetchImpl }) -> { count }
 *
 * Called as soon as a vendor's results are real — once its batch completes
 * (Anthropic, OpenAI) or, for a sequential vendor (xAI), as each pair comes
 * back — rather than waiting for the whole round to finish judging.
 */
async function syncComparisons({ supabaseUrl, apikey, accessToken, briefId, comparisons, labelToUuid, fetchImpl = fetch }) {
  const headers = {
    apikey, Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json', Prefer: 'return=minimal',
  };
  const rows = [];
  for (const c of comparisons) {
    const leftId = labelToUuid.get(c.a);
    const rightId = labelToUuid.get(c.b);
    const winnerId = labelToUuid.get(c.winner);
    const shownFirst = labelToUuid.get(c.slotA);
    // a pair touching an unsynced variant (shouldn't happen — every variant
    // is syncVariants()'d before judging starts) is skipped, not invented
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
  const res = await fetchImpl(`${supabaseUrl}/rest/v1/comparisons`, { method: 'POST', headers, body: JSON.stringify(rows) });
  if (!res.ok) throw new Error(`sync: comparisons insert failed: ${res.status} ${await res.text()}`);
  return { count: rows.length };
}

export {
  signIn, fetchBriefById, claimBrief,
  insertBrief, closeBrief,
  syncVariant, syncVariantResults, syncComparisons,
};
