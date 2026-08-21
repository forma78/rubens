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

      **Needs a schema.sql run the owner hasn't done yet** — paste
      `schema.sql` into the Supabase SQL editor again (safe to run twice):
      adds `next_shift_slug()` (atomic `YYYYMMDD`+daily-counter slugs,
      replacing the old `brief-<timestamp>-<uuid>` scheme), flips
      `briefs.published`'s default to `true` (every shift is public the
      moment Go! fires now — no manual publish step was ever built), adds
      the Realtime publication for `briefs`/`variants`/`comparisons`
      (without it Live's subscription has nothing to stream even though
      RLS already allows it), and narrows anon's `briefs` grant to named
      columns so `cost_usd` never reaches the public pages. Existing rows
      keep their old slugs — only new ones get the new format.
- [ ] C2. The owner's "pick the finalist" action, on-site, writing to
      `reactions`.

---
Status column above is hand-maintained — check items off as we finish them,
not as a promise of what's next.
