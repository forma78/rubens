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
      spend). Built on `docs/design-canon.md`'s tokens directly (copied
      into `site/app/globals.css`, not reinterpreted). 2026-08-20.

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
      Not yet done: a real deploy hasn't been confirmed working, and B3
      has never actually fired `workflow_dispatch` for real — see B3's own
      note below.
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

- [ ] C1. Real RubensJournal feed page, reading published shifts from
      Supabase — implements the mockup already approved as beta.
- [ ] C2. The owner's "pick the finalist" action, on-site, writing to
      `reactions`.

---
Status column above is hand-maintained — check items off as we finish them,
not as a promise of what's next.
