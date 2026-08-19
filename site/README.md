# RubensJournal (site)

The Next.js half of `forma78/rubens` — see `docs/site-plan.md` and
`docs/design-canon.md` at the repo root before touching anything here.
This directory is its own subproject (own `package.json`,
`tsconfig.json`) because the rest of the repo is deliberately plain
ES modules, no TypeScript, no bundler — that contract stays intact one
level up.

## Running it

```bash
npm install
cp .env.local.example .env.local   # fill in the real values
npm run dev
```

Needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same
project as the repo root's own `.env`) to do anything real — without them
the pages render but every Supabase call fails.

## What's here

- `app/login` — A3, the one owner's sign-in.
- `app/new` — A4, the brief-creation form (canvas format, up to 4
  references, Go).
- `app/api/shift` — B3, the one server-side function: verifies the
  session, fires `.github/workflows/shift.yml` via `workflow_dispatch`.
- `app/globals.css` — `docs/design-canon.md`'s tokens, copied directly.

C1/C2 (the public feed, the owner's "pick the finalist" reaction) aren't
built yet.

## Deploying

Vercel project's **Root Directory** must be set to `site` (Settings →
General) — this is a subproject inside a larger repo, not the repo root.
