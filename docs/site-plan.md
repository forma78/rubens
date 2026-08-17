# RubensJournal — site build plan

Working checklist for "create a brief on the site, GitHub Actions runs the
shift, the site shows it live." Move through in order — later parts depend
on earlier ones actually working.

## A — Brief intake (site writes a brief, doesn't run anything yet)

- [ ] A1. Supabase: add a `status` lifecycle to `briefs` — `pending` (site
      created it, nothing has run yet) in addition to the existing
      `running`/`done`/`aborted`. This is also the lock GitHub Actions uses
      so two ticks can't pick up the same brief.
- [ ] A2. Supabase Storage: new bucket for uploaded reference images, with a
      policy (owner can upload, public read only if the brief is published).
- [ ] A3. Owner login on the site (Supabase Auth — the email/password
      already in `.env`, wired into the frontend). Only an authenticated
      owner can create a brief; anonymous visitors stay read-only.
- [ ] A4. Brief-creation form: canvas format picker (60x80 / 70x100 / 90x120
      / 120x90 / 100x100), reference image upload, instruction text,
      rounds/variantsPerRound. Writes one `briefs` row with `status:
      'pending'` plus the uploaded image's Storage URL.

## B — Trigger and execution (GitHub Actions actually runs `run()`)

- [x] B1. GitHub fine-grained token, `Actions: Read and write`, scoped to
      `rubens` only. *(owner is creating this now)*
- [ ] B2. Same token added to Vercel's own environment variables (Project →
      Settings → Environment Variables) — separate from local `.env`.
- [ ] B3. Vercel trigger-proxy function: verifies the request is really the
      logged-in owner, then calls GitHub's `workflow_dispatch` API with the
      token from B2. The only server-side code the site has — everything
      else stays static.
- [ ] B4. GitHub Actions repository secrets: `ANTHROPIC_API_KEY`,
      `XAI_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
      `SUPABASE_EMAIL`, `SUPABASE_PASSWORD` (Settings → Secrets and
      variables → Actions in the repo). Separate from B2's token.
- [ ] B5. `run.js`: teach it to load a brief from Supabase (by id) as an
      alternative to a local JSON file, and to download the reference image
      from Storage into a temp path first.
- [ ] B6. GitHub Actions workflow file: on `workflow_dispatch`, claim the
      pending brief (flip `status` to `running` — the race-condition lock),
      run `node src/syndicate/run.js --brief-id <id> --publish`, then commit
      `runs/<id>/` back to the repo (`runs/` is committed evidence, per
      CLAUDE.md).

## C — Display (the actual RubensJournal feed)

- [ ] C1. Real RubensJournal feed page, reading published shifts from
      Supabase — implements the mockup already approved as beta.
- [ ] C2. The owner's "pick the finalist" action, on-site, writing to
      `reactions`.

---
Status column above is hand-maintained — check items off as we finish them,
not as a promise of what's next.
