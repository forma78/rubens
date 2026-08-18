# RubensJournal — site build plan

Working checklist for "create a brief on the site, GitHub Actions runs the
shift, the site shows it live." Move through in order — later parts depend
on earlier ones actually working.

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
- [ ] A4. Brief-creation form: canvas format picker (60x80 / 70x100 / 90x120
      / 120x90 / 100x100), reference image upload, instruction text,
      rounds/variantsPerRound. Writes one `briefs` row with `status:
      'pending'` plus the uploaded image's Storage URL.

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
      reference image, runs the shift, and `syncShift` updates that same
      row instead of inserting a new one. Dry mode only reads
      (`fetchBriefById`), never claims. 16 new tests, all against fake
      Supabase/fake clients (2026-08-18).
- [x] B6. `.github/workflows/shift.yml`: `workflow_dispatch` with a
      `brief_id` input, materialises `.env` from repo secrets, runs
      `run.js --brief-id --publish`, commits `runs/<slug>/` back if
      produced (2026-08-18). Not yet fired for real — needs a real pending
      brief in Supabase, which needs A4 (or a hand-inserted test row) first.

## C — Display (the actual RubensJournal feed)

- [ ] C1. Real RubensJournal feed page, reading published shifts from
      Supabase — implements the mockup already approved as beta.
- [ ] C2. The owner's "pick the finalist" action, on-site, writing to
      `reactions`.

---
Status column above is hand-maintained — check items off as we finish them,
not as a promise of what's next.
