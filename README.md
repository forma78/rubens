# Rubens Syndicate

Acrylic on canvas, composed by an algorithm written from my own brushwork.

---

## The loop

I paint a colour study by hand: many dense parallel lines of one pure colour,
laid in a single direction. One clean colour over an area, then another beside
it, then another. Together they read as a gradient, but nothing is mixed — at
arm's length the colours are separate touching lines, a raster made of paint.

That technique is not applied to the algorithm. The algorithm was **derived from
it**. A study is analysed: the direction of the strokes is measured, the pure
colours are recovered by k-means in CIE Lab, and the gradient is stored not as a
ramp but as a probability of each pure colour at every point along the stroke.
The generator then lays synthetic strokes by drawing from that probability — so
the boundaries interlock in the same combed fingers my brush leaves.

A syndicate of agents searches the space that generator opens. It proposes
compositions, renders them, argues about them across three model vendors, and
ranks them by forced pairwise choice. I am the art director: I pick one.

Then I paint it by hand, and it stops obeying. The tape edge runs straight where
the cell is curved, the impasto stands up off the surface, a colour goes
somewhere the model did not ask for. That divergence is measured too — the
finished canvas is photographed and pushed back through the same analyser, and
the delta between sketch and painting is published with the work.

Hand teaches the algorithm. Algorithm proposes to the hand.

---

## Update 1 — a third vendor

The syndicate started with two model vendors, Anthropic and xAI, each judging
the other's proposals so disagreement meant something. It is now three —
OpenAI joined both sides, generating and judging. Three independent opinions
land on an unusual finalist more often than two do, and disagreement across
three reads more like a jury than a coin flip. It costs more per shift. That
is a deliberate trade, not an oversight — the syndicate searches, I still
paint, and a canvas sold pays that back.

---

## Update 2 — names, and cloth that behaves like cloth

Every judge and every generator now has a name instead of a role id — Ford,
Maeve, Arnold and Angela judge; Bernard, Dolores, Akecheta, Akane, Clementine
and Felix propose. `FINAL.md` attributes each verdict to whoever said it. The
point isn't decoration: a jury of models arguing under real names, in the
open, is more interesting to watch than a table of scores, and this
repository is meant to be watched, not only read.

The generators also learned what canvas they're actually sketching for.
Round one of the first real shift produced compositions no cloth makes — a
fold at a shallow angle, an overhang past nothing, drape sitting at zero.
The range an agent may propose in is now the range real stretched cloth
occupies, and it changes with the physical canvas: 60×80cm fixes a single
vertical ribbon, 100×100cm allows up to three, and a 120×90cm canvas is the
same composition as 60×80cm, painted on its side. The agents are told why,
not only clamped — a brushstroke covers proportionally less of a bigger
canvas, and that's worth knowing, not just enforcing.

Finished shifts now archive to Supabase too — brief, every variant, every
comparison. Metadata for now; images once there is a site worth showing them
on.

---

## Update 3 — RubensJournal

A live shift runs in minutes; the batch mode it replaced took one to three
hours. See "Update 4 — two speeds". Either way, judging used to be
treated as something to hide until it was finished — the whole record
appeared at once, only once every vendor had finished. RubensJournal makes it
the opposite: the point.

RubensJournal is a public feed. A brief is created on the site — pick a
canvas size, attach a reference photograph, write the instruction — and a
shift runs, live: each variant appears the moment it renders, and the
named judges' verdicts trickle in underneath it as each vendor actually
returns them, not batched at the end of the round. Watching three juries
argue in something close to real time is more interesting than a table of
final scores, and this project has always been about publishing the
process, not just the result.

The site itself stays static — it never runs the shift. A shift is real
compute against real, slow APIs, so it runs in GitHub Actions, dispatched
by the site, writing to Supabase as it goes. The static/no-secrets shape
SPEC.md always asked for is unchanged; a shift just happens somewhere the
site can trigger but doesn't have to host.

---

## Update 4 — two speeds

A shift used to take between one and three hours. The first real one hit the
Actions 60-minute ceiling halfway through an OpenAI batch and died there; the
ceiling went up to 180 minutes, which fixed the symptom and admitted the
problem.

None of that time was work. Every judge call went through the vendors' **batch
APIs** — queues with a 24-hour SLA and a 50% discount, polled every 15 seconds
— and the three vendors were polled one after another, so a round cost the sum
of three queues rather than the length of the longest call. Batch is the right
tool for ten thousand calls nobody is waiting on. It is the wrong tool for a
composition search someone is watching happen.

There are now two modes, set by `judging.useBatchApi` in
`config/syndicate.json`.

**Live shift** (`false`, the default). Every call goes out on the ordinary
endpoint. Proposals, renders and judgments are each pooled —
`limits.concurrency` sets how many of each run at once — and all three vendors
share one pool, so nobody waits for anybody. A round is the slowest call times
the number of waves. Verdicts still stream to the feed as they land, in groups
of `judging.streamEvery`.

**Night shift** (`true`). The original batch path, kept intact, for large
unattended runs where the discount is worth the queue. The three vendors' batches
are now submitted and polled concurrently instead of in series, so even this
mode costs one queue rather than three.

Determinism survived the change. Variant ids and seeds are derived from the job
index rather than a running counter, `mapPool` returns results in input order,
and the comparisons array is assembled in call order — Elo applies its
K-factor updates sequentially, so that ordering is part of what makes a shift
reproducible. Log writes reached from inside a pool are serialised: two
concurrent appends to `runs/<slug>/round-N/comparisons.jsonl` can interleave
into one corrupt line, and everything under `runs/` is evidence.

What this does not do is reduce the number of calls. A late round still issues
around nine hundred judgments, because the pairwise tournament grows with the
field, the number of active roles and the number of vendors all at once.
Parallelism turns that from hours into minutes; getting a round under thirty
seconds needs the field cut before the tournament rather than the tournament
made cheaper. That is the screening stage, next.

---

## Update 5 — a brief can carry up to four references

Every shift so far has locked every one of the four colour layers to
whichever single photo the brief supplied, because that's what this
document said to build. It was a gap against the tool itself: the
generator has always had a real "Reference library" — four studies, any
layer free to show any one of them — and a shift never got to use it.

A brief now carries `references`, 1–4 entries, one per colour layer it
wants to override; a slot it leaves out keeps the generator's own built-in
study for that layer, declared by name (`"color_02"`, not silently
substituted) in `base-state.json`'s `refs[]`. `L[i].ref` — which of the
four a layer shows — is patchable now too, the same as any other layer
field: a generator agent can propose moving a study from one layer to
another, which it never could before.

Two of the shifts already in `runs/` predate this — see `runs/README.md`
for which, and what to discount in their generator agents' reasoning about
palettes as a result.

---

## What is in this repository

| | |
|---|---|
| `generator/` | The parametric generator. One HTML file, no build, no dependencies. |
| `src/engine/` | The same drawing code as a library, so the browser and the command line render identically. |
| `src/syndicate/` | The agents: proposal, rendering, pairwise judging, ranking. |
| `runs/` | Every shift, kept whole: proposals, renders, verdicts, disagreements. |
| `studies/` | The hand-painted colour studies the palettes are read from. |
| `canvases/` | Finished paintings and their deviation reports. |

The `runs/` folder is the point. Every verdict carries the model that produced
it, its version, the timestamp and the request id. Where the vendors disagreed
on the same pair, the disagreement is kept rather than averaged away — it is
usually the most interesting thing in the file.

---

## Running it

The generator alone needs nothing. Open `generator/index.html` in a browser.

The syndicate needs Node 20+, an Anthropic key, an xAI key, an OpenAI key and
a Supabase project. See `docs/SPEC.md`.

```bash
# live shift (default): ordinary endpoints, pooled, minutes
node src/syndicate/run.js --brief-id <uuid> --publish

# night shift: batch APIs, cheaper, hours — set judging.useBatchApi true first
```

`limits.concurrency` in `config/syndicate.json` controls how many calls are in
flight per stage — `{ propose: 12, render: 6, judge: 24 }` by default. Lower
`judge` first if a vendor starts returning 429s; `render` is synchronous CPU
work and gains nothing above a handful of cores.

---

## Method, honestly stated

The agents do not invent the mechanics. They search a space I built. Every
structural idea in the generator — the ribbon deformation, the cell-bounded
dye, the layer stack — came from the hand and the eye, not from a model.

The judges see a rendered image at the size of a postcard. They read
composition, proportion and colour distribution well. They are blind to
impasto, to the ridge a loaded brush leaves, to what the surface does in raking
light. That is the boundary of the instrument, and it is why a human still
paints the result.

---

Uccle, Belgium. 2026.
