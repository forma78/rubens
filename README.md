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
compositions, renders them, argues about them, and ranks them by forced pairwise
choice. I am the art director: I pick one.

Then I paint it by hand, and it stops obeying. The tape edge runs straight where
the cell is curved, the impasto stands up off the surface, a colour goes
somewhere the model did not ask for. That divergence is measured too — the
finished canvas is photographed and pushed back through the same analyser, and
the delta between sketch and painting is published with the work.

Hand teaches the algorithm. Algorithm proposes to the hand.

---

## Who argues

Six judges. Two to a vendor, and each one is a single persona pinned to a single
model — not a role replayed across whatever happens to be cheap that week.

| | | |
|---|---|---|
| **Ford** | mass, and whether the thing holds a wall from four metres | `claude-opus-5` |
| **Maeve** | the hand, and whether it could hang in a series | `claude-sonnet-5` |
| **Arnold** | craft: proportion, and colour placed rather than distributed | `grok-4.3` |
| **Hector** | colour only — heat, and whether it was decided or arrived at | `grok-4.5` |
| **Angela** | eight years old, nobody has told her what art is | `gpt-5.6-luna` |
| **Stubbs** | what comes apart at the seams; awards nothing for beauty | `gpt-5.4` |

Two to a vendor is the whole point of the arrangement. Disagreement is the
measurement here — the share of pairs where vendors split on the same two
images — and a vendor needs more than one voice before a split means anything.
They are given genuinely different things to care about for the same reason:
six prompts that say the same thing on six models is one opinion, six times.

Six agents propose: Bernard tightens, Dolores breaks, Akecheta removes, Akane
moves colour, Clementine yields, Felix works the brush itself.

And **System**, which is nobody. Eight of every thirty-two proposals are a
seeded mutation with no model in the loop at all, judged in the same tournament
under the same rules. It is the control group — what the six have to beat, and
a standing check on whether the agents are searching or just spending.

Every verdict kept in `runs/` carries who said it, on which model, when, and the
vendor's own request id. Where vendors disagreed on a pair, the disagreement is
kept rather than averaged away; it is usually the most interesting thing in the
file.

---

## Two generators

Both draw the same cloth: panels clipped by ribbons, per-edge offsets, a
Gaussian drape field, a rounded outline — geometry derived by hand over many
sessions and frozen since. What differs is what gets laid inside the cells.

- **Model 1** dyes them: colour fields drawn from the probability distribution
  read out of a real painted study, up to four studies per brief, any layer free
  to show any one of them.
- **Model 2** rules them: short ink bars from a small library, five stacked
  layers, each taking a share of the cells and laying them one way.

They are not two copies of a similar idea. The cloth is literally the same
functions — `src/engine2/` imports them from `src/engine/` — because two copies
of frozen hand-derived maths is two things free to drift apart.

---

## What the cloth will not do

The first real shift produced round-one compositions that no cloth makes: a fold
at a shallow angle, an overhang past nothing, drape sitting at zero. The range an
agent may propose in is now the range real stretched cloth occupies, and it moves
with the physical canvas — 60×80cm fixes a single vertical ribbon, 100×100cm
allows up to three, and a 120×90cm canvas is the same composition as 60×80cm
painted on its side.

The agents are told why, not only clamped. A brushstroke covers proportionally
less of a bigger canvas, and that is worth knowing rather than merely enforcing.

---

## RubensJournal

[rubens-pearl.vercel.app](https://rubens-pearl.vercel.app) is the public feed.

A brief is composed on the site — canvas size, up to four reference photographs,
the instruction — and a shift runs live: each variant appears the moment it
renders, and the judges' verdicts arrive underneath as each vendor actually
answers, not batched at the end. Thirty-two images are proposed once, then the
shift's own ranking is halved four times, 32 → 16 → 8 → 4 → 2.

Judging used to be something to hide until it was finished, the whole record
appearing at once. This is the opposite, and the reason the site exists.

The site never runs the shift itself. A shift is real compute against real APIs,
so it runs in GitHub Actions, dispatched by the site, writing to Supabase as it
goes.

---

## What is in this repository

| | |
|---|---|
| `generator/` | The two generators. Interface only — each imports its engine. |
| `src/engine/` | Model 1's drawing code, so the browser and the command line render identically. |
| `src/engine2/` | Model 2's ink bars. The cloth is imported from `src/engine/`, never copied. |
| `src/syndicate/` | The agents: proposal, rendering, pairwise judging, ranking, cost. |
| `site/` | RubensJournal. Static Next.js, reads Supabase with the anon key. |
| `runs/` | Every shift, kept whole: proposals, renders, verdicts, disagreements. |
| `studies/` | The hand-painted colour studies the palettes are read from. |
| `canvases/` | For finished paintings and their deviation reports. Empty — nothing has been painted from a shift yet. |

`runs/` is the point. A run that cannot be reproduced cannot be published, and
publishing the runs is the entire project.

---

## Running it

Node 20+, an Anthropic key, an xAI key, an OpenAI key, and a Supabase project.
`docs/SPEC.md` is the contract; `CLAUDE.md` is how to work in here.

The generators are single HTML files that import their engine as ES modules, so
they are served, not opened from disk:

```bash
npm i
npm run dev          # then /generator/ or /generator/index2.html
```

A shift:

```bash
node src/syndicate/run.js --brief-id <uuid> --publish
```

It runs one real round: thirty-two proposals, rendered, then a pairwise
tournament — forty-eight pairs, six judges, 288 real verdicts. Every call goes
out on the ordinary endpoint, pooled, and the round takes tens of seconds.

A second mode is kept for unattended volume: `judging.useBatchApi` sends the
same work through the vendors' batch queues at half the price and a 24-hour SLA.
It is not the default and should not become it — a shift is fast because it is
watched.

There is a hard spend cap in `config/syndicate.json`. It is not there to be
raised when something doesn't fit.

---

## Method, honestly stated

The agents do not invent the mechanics. They search a space I built. Every
structural idea in the generators — the ribbon deformation, the cell-bounded
dye, the layer stack — came from the hand and the eye, not from a model.

The judges see a rendered image at the size of a postcard. They read
composition, proportion and colour distribution well. They are blind to impasto,
to the ridge a loaded brush leaves, to what the surface does in raking light.
That is the boundary of the instrument, and it is why a human still paints the
result.

---

Uccle, Belgium. 2026.
