# RubensJournal — site build plan

Working checklist for "create a brief on the site, GitHub Actions runs the
shift, the site shows it live." Move through in order — later parts depend
on earlier ones actually working.

Once C1 exists, a real shift's variants and judges' comments land in
Supabase incrementally as they happen, not in one batch at the end — see
sync.js's own comment for the shape. A shift itself now runs in minutes,
not 60-180 (2026-08-18, "two speeds" — pooled live judging replaced walking
the vendors' batch queues one at a time); the feed still fills in live, it
just does so at reading speed instead of overnight.

## A — Brief intake (site writes a brief, doesn't run anything yet)

- [x] A1. Supabase: `status` lifecycle now includes `pending` (default),
      `base_state` is nullable (a pending brief has no shift yet), and
      `canvas_format` has a real column — done via schema.sql + a live
      migration (2026-08-18).
- [x] A2. Supabase Storage: `references` bucket, public read, owner-only
      upload — done via schema.sql + a live migration (2026-08-18).
- [x] A3. Owner login on the site — `site/app/login/page.tsx`, Supabase
      Auth email/password (the same account `SUPABASE_EMAIL`/`PASSWORD` in
      `.env` already sign in as), no signup flow — there's only ever one
      owner. `site/proxy.ts` (Next.js 16 renamed `middleware.ts`) refreshes
      the session cookie on every request and redirects `/new` to `/login`
      when signed out; `site/app/new/page.tsx` checks again server-side as
      defence in depth. 2026-08-20.
- [x] A4. Brief-creation form — `site/app/new/brief-form.tsx`. Canvas
      format picker (the 5 real `CANVAS_PROFILES`, nothing pre-selected —
      "a real decision, not a default"), up to 4 reference images
      (uploaded straight to Storage's `references` bucket from the
      browser, matching `design-canon.md`'s "4 studies + Add image" row),
      instruction text, and the circular Rubens-self-portrait **Go**
      button — disabled until a format and at least one reference are set,
      and a real `window.confirm()` before it fires (a real shift, real
      spend). Originally built on `docs/design-canon.md`'s tokens; that
      file is retired as of 2026-08-21 (see C1) and this form was
      restyled onto the new canon in the same pass, without changing its
      own logic. 2026-08-20.

      Required `reference_urls` jsonb column and migration on `briefs`
      (`schema.sql`, additive — `reference` untouched for old rows) plus a
      matching change to `run.js`'s `resolveBriefSource` (downloads every
      real URL now, not just one) and `sync.js`'s `insertBrief`. 199 tests
      still green.

## B — Trigger and execution (GitHub Actions actually runs `run()`)

- [x] B1. GitHub fine-grained token, `Actions: Read and write`, scoped to
      `rubens` only.
- [x] B2. Same token added to Vercel's own environment variables.
- [x] B3. `site/app/api/shift/route.ts`: verifies the caller has a real
      Supabase session and that the brief is actually `pending` (fail
      fast — the real atomic guard against a double dispatch is still
      `claimBrief`'s pending->running swap inside `run.js`), then calls
      GitHub's `workflow_dispatch` on `shift.yml` with B2's token. The
      only server-side code the site has — everything else is static
      Next.js output. 2026-08-20. **Not fired for real from the site
      yet** — deliberately: verified the 401/409 paths respond correctly
      without ever completing a real dispatch during this build, to
      avoid triggering a real paid shift as a side effect of testing the
      wiring. The owner's own first real click is the actual first test.

      **Manual steps — all done by the owner, 2026-08-20:**
      - [x] `reference_urls` migration pasted into the Supabase SQL Editor
        and run ("Success. No rows returned").
      - [x] Vercel project → Settings → General → **Root Directory** →
        `site`.
      - [x] Vercel project → Settings → Environment Variables:
        `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` added.
      - `site/package-lock.json` is committed, so Vercel's own
        `npm install` is reproducible.
      - [x] **Deploy confirmed working, 2026-08-20** — production URL now
        renders `/login` correctly. Two real Vercel misconfigurations found
        and fixed along the way, neither one in this repo's code:
        - **Framework Preset was stuck on "Other"** (a leftover from
          before Root Directory pointed at `site` — the repo root itself
          has no framework). With "Other", Vercel skipped Next.js-aware
          building entirely: no serverless functions, no framework
          routing — a "successful" build that 404'd on every route. Fixed
          by setting Framework Preset to Next.js and turning **off**
          Output Directory override specifically (an explicit
          `.next` override reproduces the same bug — Next.js on Vercel is
          not "serve this folder as static," the framework builder needs
          to own that setting).
        - **Deployment Protection → Vercel Authentication ("Require Log
          In") was on**, gating every deployment, including production,
          behind a Vercel-team login — orthogonal to the app's own
          Supabase auth and wrong for a public site. Turned off.
      Not yet done: B3 has never actually fired `workflow_dispatch` for
      real — see B3's own note above; the owner's first real Go click is
      still the actual first test.
- [x] B4. GitHub Actions repository secrets: `ANTHROPIC_API_KEY`,
      `XAI_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
      `SUPABASE_EMAIL`, `SUPABASE_PASSWORD` — set via `gh secret set`
      (2026-08-18). Separate from B2's token.
- [x] B5. `run.js --brief-id <uuid>`: signs in, atomically claims the row
      (`sync.js`'s `claimBrief`, pending -> running), downloads the
      reference image, runs the shift syncing incrementally throughout
      (see the note above), closes the brief out at the end. Dry mode only
      reads (`fetchBriefById`), never claims. 2026-08-18.
- [x] B6. `.github/workflows/shift.yml`: `workflow_dispatch` with a
      `brief_id` input, materialises `.env` from repo secrets, runs
      `run.js --brief-id --publish`, commits `runs/<slug>/` back if
      produced. **Fired for real** (2026-08-18, run 32084559547): a
      hand-inserted test brief + hand-uploaded Storage image, 32 real
      variants proposed/rendered, 192 real comparisons judged before the
      original 60-minute job timeout killed it mid-OpenAI-batch — timeout
      raised to 180. Confirmed runs/ still gets committed correctly even
      when the job is killed. Full completion not yet re-verified after
      raising the timeout, and the incremental-sync rewrite (this same
      commit) hasn't had its own real end-to-end test yet — A4 (or another
      hand-inserted row) is the natural next real check.

## C — Display (the actual RubensJournal feed)

- [x] C1. Real RubensJournal feed — `/` (Archive), `/shift/[slug]` (Live,
      real-time via Supabase Realtime on `briefs`/`variants`/
      `comparisons`), `/shift/[slug]/round/[n]` (Canon — every real
      pairwise comparison for that round, never an invented verdict),
      `/about` (built from `README.md`). Design canon swapped: the
      Claude-Design prototype in `rubens-claude-design/` (Behance-style —
      grey bordered panels, gradient top bar, monospace metadata)
      replaces `docs/design-canon.md` (deleted) as the one source of
      truth; `/new` and `/login` were restyled onto it too so the whole
      site reads as one system. No guest write access anywhere (no
      signup flow exists — Appreciate/comments were in the prototype but
      dropped, owner's call, 2026-08-21) — Judges' verdicts
      (`comparisons.why`) are real, read-only, shown to everyone.
      Go! now redirects straight to `/shift/[slug]` (no more inline
      polling swap on `/new`) using the slug the DB just generated.
      2026-08-21.

      `schema.sql` run by the owner in the Supabase SQL editor, 2026-08-21
      ("Success. No rows returned"): `next_shift_slug()` (atomic
      `YYYYMMDD`+daily-counter slugs), `briefs.published` default `true`,
      the Realtime publication for `briefs`/`variants`/`comparisons`,
      anon's `briefs` grant narrowed so `cost_usd` stays owner-only.
      **First real Go! click, same day**: hit `new row violates row-level
      security policy for table "shift_counters"` — `next_shift_slug()`
      ran as the calling (`authenticated`) role, which had no grant on
      the new counter table (Supabase enables RLS by default on tables
      made in the SQL editor). Fixed by making the function `security
      definer`; `shift_counters` itself stays RLS-on/zero-policies —
      nothing outside that one function should ever touch it. Re-run
      confirmed working.

      **One real round, not five** (2026-08-21, after the first real
      shift's own results prompted the question): re-running
      `proposeRound`/`judgeRound` every round burned tokens generating
      fresh mutations with no discussion payoff a single well-judged
      round doesn't already give. `briefs.rounds` now defaults to `1`;
      `config/roles.json`'s `old-master` and `child` judges (previously
      gated to round 3+/4+, which no longer runs) now judge round 1 too,
      so all four judges weigh in on the round that actually decides
      things. Live/Canon still show a shift narrowing 32 → 16 → 8 → 4 →
      2 like `rubens-claude-design`'s own spec says — `lib/shift.ts`'s
      `narrowingSizes()` halves round 1's real, final rating instead of
      running four more paid rounds to get there. A pre-2026-08-21 shift
      that really ran 5 rounds (e.g. Shift 07) renders exactly as it
      always did — the site tells the two apart by whether more than one
      real `round` value exists on the brief's own variants.
- [x] C1a. **Back onto the canon** (2026-08-21, second pass). The owner
      opened a real shift and found the feed reading nothing like
      `rubens-claude-design/Rubens Prototype.dc.html`; the screens he sent
      that day are the single truth for it. Four real faults, all visible
      on every shift page, all fixed:
      - **Every round showed 32 images in 5 auto-fill columns**, so each
        round ended on a half-empty row. The canon is fixed counts —
        32 / 16 / 8 / 4 / 2 images at 8 / 8 / 4 / 2 / 2 to a row, which
        divide exactly. `lib/shift.ts`'s `canonRounds`/`canonColumns` now
        cut the field and `globals.css` sets the columns per round.
        The narrowing itself is not new (`narrowingSizes`) — it was gated
        behind "one real round *and* status done", and no shift in the
        database satisfies both, so it never once ran. The gate is now
        "has every image been judged", which is about the record rather
        than about a `status` column two killed jobs left on `running`
        for ever.
      - **The comments were a transcript, not the canon's thread** — 288
        rows under round 1, a 90,000px page. The canon shows one thread:
        a verdict and the other judges' verdicts on the *same pair*, which
        is real (the database holds 6–18 per pair). `components/comment.tsx`
        is now that row — 36px avatar, name in link blue, `(role, vendor)
        · round N`, the verdict, then `(Reply) (Thread) (Link)` — and Live
        and Canon share it, so a comment cannot read two ways.
      - **Ranking was computed from `rating`, which is 1500 on every row
        in the database** — `syncVariantResults` never patched the real
        Elo back for these shifts — so "approved"/"rejected" was decided
        by render order. `rankVariants` falls back to net wins counted off
        the real comparisons; checked against
        `runs/brief-1787183860194-0c4f3666/round-1/ratings.json`, it
        reproduces that shift's real Elo order exactly, same top 16.
      - **Both pages read at most 1000 rows** (PostgREST's cap, silent).
        That shift has 2930 comparisons — the ranking, the counts and the
        verdicts were all drawn from a third of the record. `lib/rows.ts`
        pages until a short page comes back.

      One thing the data itself decided: judging is a sparse round-robin,
      not a bracket. Below the top 8 the leaders had **never** been shown
      against each other, so a narrowed round has real verdicts *about*
      the images still standing, not between them. The panel head says
      which of the two it is (`judged head to head` / `on the images still
      standing`) rather than letting a verdict about another pair pass as
      the final call.

- [x] C1b. **Six judges, two per vendor, each on its own model** (2026-08-21).
      The sidebar used to read `Ford / architect / rounds 1-5`: a role id
      where a model belongs, and a rounds range that says nothing once
      every judge judges the one round there is. A judge is now one persona
      pinned to one model — `config/roles.json` carries `vendor` + `model`
      per judge, `src/syndicate/judges.js` resolves them, and the sidebar
      prints `Ford / claude-opus-5 / Anthropic`. Two new Westworld seats:
      **Hector** (colourist — colour, heat, nerve) and **Stubbs**
      (inspector — what comes apart at the seams).

      Fewer calls, not more: one call per pair per judge instead of four
      personas across three vendors is 6 instead of 12. Measured on real
      renders with one live call per judge — **$1.1-1.3 a round against
      $1.62** before, ~25% less even with Opus 5 among them. (A range, not
      a number: reasoning and completion tokens vary call to call, so two
      runs of the same six judges on the same pair came out $1.14 and
      $1.25. The first real shift's cost log is what settles it.)

      Hector's seat went to **grok-4.5, not 4.6**, on that measurement:
      4.6 spent 48 seconds and 2239 reasoning tokens producing a 25-word
      verdict, and the slowest judge sets a round's latency — that alone
      would have made a round minutes instead of the tens of seconds
      CLAUDE.md asks for. 4.5 does it in 7-13s on ~450. Judging is a short
      classification with three images attached; a reasoning-heavy
      flagship is the wrong instrument for it.

      Worth knowing for later: 97% of a judge call is pictures — 44 tokens
      of prompt text against 428 per image at `imageLongestSide` 768,
      three images a call (counted with Anthropic's count_tokens). Dropping
      to 512 would cut a call from 1328 tokens to 794 at every vendor at
      once, which is a bigger lever on spend than any model swap. Not done
      — it is a real change to what a judge is shown, and that is the
      owner's call.

      The six also visibly disagree, which the old four never did: on the
      measured pair Ford, Hector, Angela and Stubbs chose B while Maeve and
      Arnold chose A, and both Anthropic and xAI split internally. Every
      `disagreement` column in the record so far reads 0%, because a role
      replayed across three vendors mostly agrees with itself.

      Every model id was listed live on its vendor's own API that day and
      sent a real image to confirm it can see, then a real judge call
      through the actual vendor module. `grok-4-mini` does not exist —
      xAI has no mini variant at all. Prices in `src/syndicate/cost.js`
      were re-checked: Opus 5 had been sitting at $15/$75 against a real
      $5/$25, so `maxUsd` would have aborted a shift that had spent a third
      of the cap. Nothing in that table is UNVERIFIED any more, and
      `test/roles.test.js` now fails the suite if a judge names a model
      with no verified price — the old failure mode was discovering it
      inside `costTracker.add()`, after the call was already paid for.

- [ ] C2. The owner's "pick the finalist" action, on-site, writing to
      `reactions`.

---
Status column above is hand-maintained — check items off as we finish them,
not as a promise of what's next.
