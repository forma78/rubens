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

## Update, 2026-08-17 — a third vendor

The syndicate started with two model vendors, Anthropic and xAI, each judging
the other's proposals so disagreement meant something. It is now three —
OpenAI joined both sides, generating and judging. Three independent opinions
land on an unusual finalist more often than two do, and disagreement across
three reads more like a jury than a coin flip. It costs more per shift. That
is a deliberate trade, not an oversight — the syndicate searches, I still
paint, and a canvas sold pays that back.

---

## Update, 2026-08-18 — names, and cloth that behaves like cloth

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
