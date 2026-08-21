# Working notes for Claude Code

Read `docs/SPEC.md` before writing anything. It is the contract. This file is
how to work in this repository, not what to build.

## Ground rules

**The generators' geometry is frozen.** There are two: `generator/index.html`
(model 1 — dyed colour fields) and `generator/index2.html` (model 2 — short ink
bars). Each was derived by hand over many sessions: convex clipping into
panels, per-edge offsets, the Gaussian drape field, the rounded outline. Both
are extracted, into `src/engine/` and `src/engine2/`. When extracting anything
further, move it **byte for byte**. Do not refactor it, do not rename its
variables, do not "improve" the maths. The only permitted changes are removing
DOM access and adding `export`.

If you believe you found a bug in the geometry, stop and say so. Do not fix it.

**The two models share the cloth.** `ribbons`, `layers`, `lattice`, `clipHalf`,
`panels`, `edges`, `drape`, `outline`, `bbox`, `h3`, `owner`, `shareOf`,
`ribbonSpan` and `frame` are not similar between the models, they are the *same
functions* — `src/engine2/` imports them from `src/engine/`. What differs is
what gets laid inside the cells. Never fork one of those to make one model
behave differently; if a model genuinely needs its own, ask first.

**Prove an extraction, don't assert it.** Byte-for-byte is a claim that can be
checked, so check it: render several states from the untouched generator in a
real browser, render the same states through the extracted engine, and compare
the bytes. Mind two traps that cost time in the 2026-08-21 extraction — apply
each test state to a *freshly loaded* page (states applied in sequence
accumulate onto one another and the goldens quietly stop meaning what you
think), and remember that the browser's `svgOut` divides by the live canvas
size, so pin the canvas to the canonical size to make that ratio 1 on both
sides. `test/engine2.test.js` records the whole method.

**One source of truth.** After extraction, the browser and the command line
must run the same functions from `src/engine/` and `src/engine2/`. If a change
makes them diverge, the change is wrong. There is a test for each; keep them
green.

**Determinism is a feature.** Same state plus same seeds must produce a
byte-identical SVG, on any machine, on any run. Never call `Math.random()`
inside the engine — the seeded hash `h3` and the xorshift `mk` are there for
this. A run that cannot be reproduced cannot be published, and publishing the
runs is the entire point of the project.

**Concurrency must not cost determinism.** Stages are pooled
(`src/syndicate/pool.js`), but nothing that reaches `runs/` may depend on
completion order. Variant ids and seeds come from the job index, never a
running counter. `mapPool` is order-preserving and the `comparisons` array is
assembled in call order — `eloRound()` applies K-factor updates sequentially,
so reordering that array silently changes every rating in the shift. Any
`appendFile` reached from inside a pool goes through `serialise()`: two
concurrent appends of a long jsonl line can interleave, and half a line in
`runs/` is a corrupted record, not a cosmetic problem.

**Never invent numbers into the record.** Anything written to `runs/` or to the
database must have actually happened: a real API response, a real render. No
placeholder verdicts, no synthetic scores while a provider is down, no
back-filling a missing judge. If a call fails, record the failure.

**Incremental sync is load-bearing, not an implementation detail.**
`src/syndicate/sync.js` writes to Supabase as a shift happens — a variant
right after it renders, comparisons as they land, ratings patched on once a
round's judging finishes — not once in a batch after the shift is done. This
is not an optimisation to simplify away: RubensJournal is a feed, and a feed
that fills in as it happens is the reason the site exists.

**A shift is fast because it is watched, not slow because it is watched.**
Shifts used to take 60-180 minutes. That was never a property of the work —
it was the vendors' batch APIs, which are queues with a 24-hour SLA, polled
one vendor after another. The wait was a bug wearing the costume of a
feature. The live path (`config.judging.useBatchApi: false`) puts every call
on the ordinary endpoint with `limits.concurrency.judge` in flight. Target
for a round is **tens of seconds**, and the feed still fills in as it goes —
it just fills in at reading speed instead of overnight.

The batch path is kept, behind `useBatchApi: true`, for unattended volume
runs where the 50% discount is worth the queue. Do not delete
`BATCH_ADAPTERS` or `judgeViaBatches()`. Do not make it the default again.

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
engine or the runner. Each generator stays a single HTML file — interface only,
importing its engine as ES modules. That means it is served, not opened from
disk: `npm run dev`, then `/generator/` or `/generator/index2.html`. (Opening
`file://` predates the engine extraction and has not worked since; see
`generator/README.md`.) Dependencies are a cost — the current count is four, and each new
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
