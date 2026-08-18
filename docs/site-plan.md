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
- [ ] A3. Owner login on the site (Supabase Auth — the email/password
      already in `.env`, wired into the frontend). Only an authenticated
      owner can create a brief; anonymous visitors stay read-only.
- [ ] A4. Brief-creation form. **Blocked on two things, discovered
      2026-08-18 — do not build the form until both land:**
      1. **No approved design canon exists yet.** An early mockup got
         verbal approval (different fonts, white ground) but nothing was
         ever written down as the reference. The Contact Sheet artifact
         built this session was designed blind, with no canon to check
         against, and it showed — wrong fonts, wrong ground, arbitrary
         choices. Before any more site UI gets built: pin down and write
         down the actual approved look (palette, type, layout) somewhere
         durable in this repo, not just "approved in a chat that scrolled
         away."
      2. **The form's actual shape depends on the SPEC 3.1/3.2 fix.**
         `docs/SPEC.md` currently locks a brief to one reference photo,
         applied to every layer — but the generator itself (the frozen
         hand-tool, `generator/index.html`) has always had a real
         "Reference library": up to four distinct studies, freely assigned
         per layer. The site's form has to mirror that actual capability,
         not the artificially narrowed one SPEC currently describes: the
         owner picks the canvas format themself (that's the seed of the
         round, a real decision, not a default), attaches 1-4 reference
         images the way the generator's own "Attach reference" +
         per-layer library already works, then Go. See the
         `wip/multireference` branch and SPEC 3.1/3.2 for the underlying
         fix this form needs to sit on top of — building A4 before that
         lands means rebuilding it once it does.

## B — Trigger and execution (GitHub Actions actually runs `run()`)

- [x] B1. GitHub fine-grained token, `Actions: Read and write`, scoped to
      `rubens` only.
- [x] B2. Same token added to Vercel's own environment variables.
- [ ] B3. Vercel trigger-proxy function: verifies the request is really the
      logged-in owner, then calls GitHub's `workflow_dispatch` API with the
      token from B2. The only server-side code the site has — everything
      else stays static.
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
