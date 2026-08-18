# Working notes for Claude Code

Read `docs/SPEC.md` before writing anything. It is the contract. This file is
how to work in this repository, not what to build.

## Ground rules

**The generator's geometry is frozen.** `generator/index.html` contains a
deformation model that was derived by hand over many sessions: convex clipping
into panels, per-edge offsets, the Gaussian drape field, the rounded outline.
When extracting it into `src/engine/`, move it **byte for byte**. Do not
refactor it, do not rename its variables, do not "improve" the maths. The only
permitted changes are removing DOM access and adding `export`.

If you believe you found a bug in the geometry, stop and say so. Do not fix it.

**One source of truth.** After extraction, the browser and the command line
must run the same functions from `src/engine/`. If a change makes them diverge,
the change is wrong. There is a test for this; keep it green.

**Determinism is a feature.** Same state plus same seeds must produce a
byte-identical SVG, on any machine, on any run. Never call `Math.random()`
inside the engine — the seeded hash `h3` and the xorshift `mk` are there for
this. A run that cannot be reproduced cannot be published, and publishing the
runs is the entire point of the project.

**Never invent numbers into the record.** Anything written to `runs/` or to the
database must have actually happened: a real API response, a real render. No
placeholder verdicts, no synthetic scores while a provider is down, no
back-filling a missing judge. If a call fails, record the failure.

**Incremental sync is load-bearing, not an implementation detail.**
`src/syndicate/sync.js` writes to Supabase as a shift happens — a variant
right after it renders, a vendor's comparisons the moment that vendor
returns them, ratings patched on once a round's judging finishes — not once
in a batch after the whole shift is done. This is not an optimisation to
simplify away. A real shift genuinely takes 60-180 minutes, because real
vendor batch APIs take that long, and RubensJournal (the live site) is
built to make that wait the point: a visitor watches the feed fill in, sees
named judges disagree in something close to real time, instead of staring
at nothing and then seeing a wall of results appear at once. Collapsing
sync back into one end-of-shift call would look like a cleanup and would
quietly kill the reason the site exists. If you touch `sync.js` or the sync
call sites in `run.js`, keep the fill-in-as-it-happens shape.

**The canvas-format constraints are physical, not arbitrary.**
`src/syndicate/canvas.js` and the tightened ranges in `patch.js` (angle,
overhang, squeeze, drape, ribbon count, ribbon width) encode what real
stretched cloth on a real canvas actually does — derived from the owner's
own painting practice, after round 1 of the first real shift produced
compositions that don't exist as cloth (a fold at a shallow angle, an
overhang past nothing, zero drape). A wider range is not more permissive
here, it is wrong. Do not loosen these to make a generator's patch "pass"
without asking first.

## Style

Plain ES modules, Node 20+, no TypeScript, no bundler, no framework in the
engine or the runner. The generator must keep working as a single file opened
from disk. Dependencies are a cost — the current count is four, and each new
one needs a reason in the pull request.

Small commits with a real message. `runs/` is committed; it is the evidence.

## Costs are real

Every model call spends the owner's money. Before adding a call to a loop, work
out how many times the loop runs. The runner has a hard spend cap; respect it,
never raise it to make a test pass. Test on two variants and one judge, not on
a full shift.

## The live site

RubensJournal (the public site — Vercel, static, reads Supabase with the
anon key) is being built incrementally, piece by piece: `docs/site-plan.md`
is the working checklist of what's done and what's next. Read it before
touching anything site-related; keep it current as parts land.

The site cannot run a shift itself — Vercel has no function that stays
alive for 60-180 minutes. A shift always runs in GitHub Actions
(`.github/workflows/shift.yml`), triggered by `workflow_dispatch`. Three
separate places hold secrets, and they are not interchangeable:

- Local `.env` (gitignored) — for running the syndicate from this machine.
- GitHub Actions repository secrets (Settings → Secrets and variables →
  Actions) — the vendor keys and Supabase credentials the workflow needs to
  actually run a shift.
- Vercel's own environment variables (Project → Settings → Environment
  Variables) — currently just the GitHub trigger token, for the site's one
  server-side function that fires `workflow_dispatch`. This token has
  `Actions: Read and write` only — deliberately not enough to touch repo
  secrets — do not widen its scope to make some other task convenient.

## When something is ambiguous

Ask. This repository belongs to an artist, not a software team — a wrong
assumption implemented cleanly is worse than a question.
