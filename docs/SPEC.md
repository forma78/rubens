# Rubens Syndicate — specification

Build in the order given. Each phase ends with something the owner can run and
see. Do not start a phase before the previous one passes its checks.

Node 20+. VS Code is enough; no other editor is required.

---

## Phase 0 — repository

```
generator/index.html        ← the existing tool, dropped in as is
src/engine/                 ← the drawing code, extracted (Phase 1)
src/syndicate/              ← the runner (Phase 3)
src/analyse/                ← palette extraction from a photograph
config/roles.json           ← judge roles
config/syndicate.json       ← run parameters
runs/                       ← output, committed to git
studies/                    ← hand-painted colour studies (jpg)
canvases/                   ← photographs of finished paintings
docs/SPEC.md                ← this file
schema.sql
```

`.gitignore`

```
node_modules/
.env
*.log
runs/**/tmp/
```

`.env.example` — copy to `.env`, which is never committed

```
ANTHROPIC_API_KEY=
XAI_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_EMAIL=
SUPABASE_PASSWORD=
```

`package.json` scripts

```
"dev"       : "npx serve .",              open the generator on localhost
"render"    : "node src/syndicate/render.js",
"analyse"   : "node src/analyse/cli.js",
"syndicate" : "node src/syndicate/run.js",
"test"      : "node --test"
```

Dependencies, and nothing else without a reason:
`@resvg/resvg-js` (SVG → PNG), `sharp` (decode photographs, resize renders),
`@anthropic-ai/sdk`, `openai` (used only as an xAI client).

---

## Phase 1 — one engine, two surfaces

This phase is a prerequisite for everything else. Until it is done, no agent can
see anything.

### 1.1 Extract

Move the code from `generator/index.html` into ES modules:

```
src/engine/state.js      default state S, the RATIOS table, dom()
src/engine/rng.js        mk, h3, vn
src/engine/colour.js     s2lab, lab2s, hex, unhex, unpack, reband, PRESETS
src/engine/geometry.js   ribbons, layers, lattice, clipHalf, panels,
                         edges, drape, outline, bbox
src/engine/dye.js        dye, pick, strokeInk, strokeW, reach, owner,
                         shareOf, dyeCell, dyePanel, ribbonSpan, dyeRibbons
src/engine/svg.js        svgOut(state, refs, ovr, opts) → string
src/engine/index.js      re-exports
```

Byte-for-byte, as `CLAUDE.md` says. The functions currently read the globals
`S`, `REFS`, `OVR`; thread these through as arguments or a context object, and
change nothing else.

`generator/index.html` then keeps only the interface — markup, wiring, the
canvas renderer, the archive panel — and imports the engine with
`<script type="module">`.

> ES modules do not load over `file://`. From here on the generator is opened
> through `npm run dev` at `http://localhost:3000`. Say this in the README of
> the generator folder; it will otherwise look broken.

### 1.2 svgOut, parameterised

`svgOut` currently hard-codes `1600 * D.w`. Give it options:

```js
svgOut(ctx, { base: 1600, quality: 'full' | 'preview' })
```

`preview` uses `base: 700` and caps the stroke step count harder. A full render
is roughly 3 MB of SVG and 17 000 polylines; a preview is a fraction of that and
is what the judges will look at. Judging must never use `full`.

### 1.3 Command-line render

`npm run render -- --state runs/x/var-07.json --out var-07.png --height 1200`

State JSON is exactly what the generator's `Export file` writes: `{ v, S, ovr,
refs }`. Pipeline: state → `svgOut(preview)` → `@resvg/resvg-js` → PNG →
`sharp` resize → write.

### 1.4 Checks

1. **Determinism.** Render one fixed state twice, in separate processes. The
   two SVG strings must be identical. Commit the fixture and the test.
2. **Parity.** Export the same state from the browser and from the CLI. The
   number of `<polyline>` elements and the set of colours used must match
   exactly. Commit as a test with a stored fixture.
3. The owner opens the generator on localhost and it behaves exactly as before.

---

## Phase 2 — what an agent is allowed to say

An agent never returns an image and never returns prose that the pipeline
parses. It returns a **patch**: a flat JSON object of parameter changes, merged
onto the parent state.

### 2.1 The parameter table

Editable, with clamps. Anything outside is clamped; anything not listed is
rejected and the response is retried once, then dropped.

| key | range | note |
|---|---|---|
| `cols` | 2 – 40 | integer |
| `rows` | 2 – 48 | integer |
| `weave` | 0.4 – 20 | thread weight, px |
| `edge` | 0.4 – 20 | outline weight, px |
| `nv` | 0 – 4 | vertical ribbons |
| `nh` | 0 – 6 | horizontal ribbons |
| `rw` | 1 – 60 | ribbon width |
| `angle` | 45 – 90 | degrees |
| `scatter` | 0 – 100 | |
| `over` | −10 – 30 | overhang |
| `squeeze` | 0 – 80 | |
| `swell` | 0 – 80 | |
| `round` | 0 – 100 | |
| `drape` | 0 – 100 | |
| `hand` | 0 – 100 | |
| `seed` | 1 – 99999 | integer |
| `pitch` | 2 – 40 | stroke pitch |
| `ilock` | 0 – 100 | interlock |
| `grain` | 0 – 100 | |
| `load` | 0 – 60 | paint load |
| `cseed` | 1 – 99999 | integer |
| `wover` | 0 or 1 | weave over the dye |
| `L[i].bands` | 2 – 8 | i = 0…4 |
| `L[i].dir` | `v` \| `h` | i = 0…3 |
| `L[i].span` | `cell` \| `auto` \| `sheet` | i = 0…3 |
| `L[i].cover` | 0 – 100 | i = 0…3, cumulative threshold |
| `L[i].on` | 0 or 1 | |
| `L[i].ref` | 0 – 3 | i = 0…4, which of the brief's 4 references this layer shows |

Locked by the brief, never patchable by an agent: `ratio`, `pattern`, and the
palettes themselves (the 8 pure colours + band profile each reference
resolves to — a layer may point at a different one of the brief's 4
references, but not redefine what any of them actually contains).

The colour pickers (`thread`, `cell`, `ribbon`, `bg`) are locked by default. A
brief may unlock them explicitly.

### 2.2 Validator

`src/syndicate/patch.js` exports `validate(patch)` → `{ ok, patch, errors }`.
Clamp numerics, reject unknown keys, reject wrong types, reject a patch that
changes a locked key. Log every rejection into the run — the rejection rate per
vendor is worth knowing.

---

## Phase 3 — a shift

### 3.1 The brief

```json
{
  "id": "brief-07",
  "instruction": "Anxious. The ribbons pulled tight, the cloth crowded under them.",
  "ratio": 5,
  "references": ["studies/2026-08-16-morning.jpg", null, null, null],
  "rounds": 5,
  "variantsPerRound": 24,
  "survivors": 6
}
```

`ratio: 5` is 9:16.

`references` is 1–4 entries (a path for a local brief, a Storage URL for a
site-created one); position is which of the 4 colour layers it overrides —
`references[0]` overrides layer 0's palette, `references[1]` layer 1, and so
on. `null` (or an array shorter than 4) leaves that slot on the engine's own
built-in library (`PRESETS` in `src/engine/colour.js` — the same four
studies the generator's own "Reference library" opens with) rather than
collapsing the layer onto whichever photo *was* supplied. This mirrors the
generator itself: `generator/index.html`'s reference library and per-layer
assignment have always let a layer show any of several studies — Phase 3.2
originally narrowed a shift to one reference locking every layer, which was
a gap in this document against what the tool it's porting already did, not
a deliberate restriction, and it's fixed as of the multireference work
(2026-08-18).

A brief needs at least one real reference. Any slot the brief leaves on its
library default must say so plainly in the record (`refs[i].name` in
`base-state.json` carries the PRESETS study's own name, e.g. `"color_02"`,
for a defaulted slot, versus a real path/URL for a supplied one) — SPEC 2's
"never invent numbers into the record" applies here too: a layer quietly
painted from a photo nobody in the brief chose would be exactly that.

### 3.2 The reference enters twice, by two different doors

**As colour, by code.** Port `analyse()` from the generator to Node in
`src/analyse/`. It currently reads pixels through a canvas; in Node decode with
`sharp(...).raw()` and feed the same RGBA buffer to the same algorithm. Output:
eight pure colours, a 48-bin band profile, and the detected stroke axis. This is
deterministic and no model is involved. Run once per real reference the brief
supplies; the result replaces that reference's slot in `refs[]` (library
defaults fill the rest, per 3.1). Which of the 4 slots a given layer shows is
`L[i].ref` (SPEC 2.1) — patchable within 0–3, the same way any other layer
field is, since which reference a layer displays is a real compositional
choice once a brief can name more than one.

**As a picture, to the judges.** The first real photo the brief supplies
(`references[0]`, or the first non-null entry) is attached to every judging
call with a fixed line: *this is the tonal target; judge composition
against it.* Judges never see it as something to copy literally.

### 3.3 One round

```
propose → render → judge → rank → select → mutate
```

**Propose.** `variantsPerRound` patches, made from three sources:

- one third from the Anthropic generator agent
- one third from the xAI generator agent
- one third by **mechanical mutation** — no model at all: pick 2–4 editable
  keys at random from the parent, perturb each by a Gaussian of σ = 12 % of its
  range, clamp

The mechanical third is not filler. It is free, it is often the best of the
three, and it is the control group that tells you whether the model proposals
are earning their cost. Track win rate by source and report it.

Round 1 has no parent: seed it from the base state plus wide mutation.
Round 2 onwards, each survivor is a parent and gets an equal share of children.

Generator agents are given: the parent state (JSON), the parent render (PNG),
the brief, and the critiques that variant received last round. They return one
patch and one sentence of intent. Temperature 1.0.

**Render.** Every variant to PNG, preview quality, longest side 768 px, JPEG
q80 for transmission. At 768 px an image costs under 1 792 tokens on xAI, which
tiles at 448 px and caps at six tiles.

**Judge.** Forced pairwise choice. Never a 1–10 score — models cluster on 7 and
8 and the mean becomes noise.

Each judge call carries two renders labelled A and B, the brief, the reference,
and the role prompt. It returns strictly:

```json
{ "winner": "A" | "B", "why": "one sentence, under 25 words" }
```

Order of A and B is randomised per call and the true identity is stored
separately, so a model that favours the first slot cannot bias the result.

Pairing: round 1 random, every variant appearing in exactly 3 pairs per judge.
Round 2 onwards Swiss — sort by rating, pair neighbours — plus one random pair
per variant so the field cannot lock.

Rounds 1 and 2 use two judges to screen cheaply. Rounds 3 to 5 use all of them.

**Rank.** Elo. Start every variant of a round at 1500.

```
E_a   = 1 / (1 + 10^((R_b − R_a) / 400))
Δ_a   = K × (score_a − E_a)          K = 24, score 1 for the winner
```

Accumulate all deltas of the round and apply them once at the end, so the result
does not depend on the order comparisons happened to finish in.

Alongside the rating compute, per variant, **disagreement**: the share of pairs
where the two vendors chose opposite winners for the same pair. Store it. Do not
penalise it — high disagreement with a high rating is the most interesting
category on the sheet and gets its own column in the report.

**Select.** Top `survivors` by rating, plus one wildcard: the highest
disagreement variant not already in the top. Seven go forward, not six.

**Mutate.** The survivors themselves carry forward unchanged, so a good variant
is never lost to a bad round.

### 3.4 Output of a shift

On disk, `runs/brief-07/`:

```
brief.json
base-state.json
palette.json          the 4 reference slots: analysed for each real photo
                       the brief supplied, library default for the rest
round-1/ … round-5/
  variants/var-01.json  var-01.png
  proposals.jsonl       every patch, its source, its intent, accepted or rejected
  comparisons.jsonl     every pair, both renders' ids, the verdict, the model,
                        the request id, the timestamp, tokens used
  ratings.json
FINAL.md              top 7 with renders, ratings, disagreement, and the
                      three sharpest quotes for and against each
```

`FINAL.md` is what the owner reads in the morning. Renders are relative links,
so it renders on GitHub as it is.

### 3.5 Cost control

`config/syndicate.json` holds `maxUsd`. The runner accumulates cost from the
`usage` object of every response and aborts the shift when the cap is reached,
writing what it has. The cap is never raised to make something pass.

Judging is the whole expense; proposals are a rounding error. Two levers:
Anthropic's Message Batches API processes up to 10 000 requests asynchronously
at 50 % of standard token prices, results normally inside an hour, and a round's
comparisons are exactly this shape — submit them as one batch. And send judges
768 px images, never full renders.

Before the first real shift, run with `variantsPerRound: 4`, `rounds: 1`, one
judge, and print the projected cost of a full shift.

---

## Phase 4 — the archive

`schema.sql` already holds `sketches`. Add: `briefs`, `variants`, `comparisons`,
`shifts`, and `reactions` for the owner's own likes.

Row level security stays as it is — every row belongs to one account. For the
public site add a `published boolean default false` on `briefs` and a policy on
role `anon` allowing `select` where the brief is published, with the same
condition cascading to its variants and comparisons. The owner decides per shift
what becomes public.

Note that a Supabase free project pauses after a week without traffic. The
public site polling the database is what keeps it awake.

---

## Phase 5 — the site

Static, on Vercel free. Reads Supabase directly with the anon key; no server of
its own, no secrets.

- shift index, newest first
- one shift: the five rounds, each a grid of renders with rating and
  disagreement, the argument underneath each pair
- the disagreement column given its own view — where the vendors split
- the owner's like, and how often his choice differed from the ranking

The like is not another vote. It is stored separately, with its own weight, and
accumulates across shifts. After twenty shifts it is a dataset about where a
human art director departs from a jury of models, which is the interesting thing
nobody else is collecting.

---

## Phase 6 — the deviation report

Later, once a canvas is finished.

Photograph the painting flat. Push it through the same `src/analyse/` that read
the studies. Compare against the state the painting was made from:

- palette drift, ΔE in CIE Lab per band
- how band proportions moved
- share of the sheet per palette, sketch against canvas

Write `canvases/<name>/deviation.md` and link it from the work. Then feed the
canvas's own extracted palette back in as a reference for the next brief.

That closes the loop the project is named for.

---

## Acceptance

The build is done when the owner can, from a cold clone:

1. `npm i && npm run dev`, and the generator works on localhost
2. `npm run render` and get a PNG identical to the browser's export
3. `npm run syndicate -- --brief config/briefs/brief-07.json` and, twenty
   minutes later, open `runs/brief-07/FINAL.md`
4. re-run the same shift with the same seeds and get the same variants
