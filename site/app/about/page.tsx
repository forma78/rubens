import { Chrome } from "@/components/chrome";

// Built from README.md directly (design_handoff's About screen) — the
// text below is copied, not paraphrased, so it can't drift from the real
// project narrative the way a summary would.
export default function AboutPage() {
  return (
    <Chrome active="about" crumb="rubens-pearl / about">
      <div className="layout-with-sidebar">
        <div className="panel">
          <div className="panel-body editorial">
            <h1>Rubens Syndicate</h1>
            <p className="lede">Acrylic on canvas, composed by an algorithm written from my own brushwork.</p>

            <h2>The loop</h2>
            <p>
              I paint a colour study by hand: many dense parallel lines of one pure colour, laid in a single
              direction. One clean colour over an area, then another beside it, then another. Together they read
              as a gradient, but nothing is mixed — at arm&apos;s length the colours are separate touching lines, a
              raster made of paint.
            </p>
            <p>
              That technique is not applied to the algorithm. The algorithm was derived from it. A study is
              analysed: the direction of the strokes is measured, the pure colours are recovered by k-means in
              CIE Lab, and the gradient is stored not as a ramp but as a probability of each pure colour at every
              point along the stroke. The generator then lays synthetic strokes by drawing from that probability —
              so the boundaries interlock in the same combed fingers my brush leaves.
            </p>
            <p>
              A syndicate of agents searches the space that generator opens. It proposes compositions, renders
              them, argues about them across three model vendors, and ranks them by forced pairwise choice. I am
              the art director: I pick one.
            </p>
            <p>
              Then I paint it by hand, and it stops obeying. The tape edge runs straight where the cell is
              curved, the impasto stands up off the surface, a colour goes somewhere the model did not ask for.
              That divergence is measured too — the finished canvas is photographed and pushed back through the
              same analyser, and the delta between sketch and painting is published with the work.
            </p>
            <p>
              <em>Hand teaches the algorithm. Algorithm proposes to the hand.</em>
            </p>

            <hr />
            <h2>Update 1 — a third vendor</h2>
            <p>
              The syndicate started with two model vendors, Anthropic and xAI, each judging the other&apos;s
              proposals so disagreement meant something. It is now three — OpenAI joined both sides, generating
              and judging. Three independent opinions land on an unusual finalist more often than two do, and
              disagreement across three reads more like a jury than a coin flip. It costs more per shift. That is
              a deliberate trade, not an oversight — the syndicate searches, I still paint, and a canvas sold pays
              that back.
            </p>

            <hr />
            <h2>Update 2 — names, and cloth that behaves like cloth</h2>
            <p>
              Every judge and every generator now has a name instead of a role id — Ford, Maeve, Arnold and
              Angela judge; Bernard, Dolores, Akecheta, Akane, Clementine and Felix propose. FINAL.md attributes
              each verdict to whoever said it. The point isn&apos;t decoration: a jury of models arguing under real
              names, in the open, is more interesting to watch than a table of scores, and this repository is
              meant to be watched, not only read.
            </p>
            <p>
              The generators also learned what canvas they&apos;re actually sketching for. Round one of the first
              real shift produced compositions no cloth makes — a fold at a shallow angle, an overhang past
              nothing, drape sitting at zero. The range an agent may propose in is now the range real stretched
              cloth occupies, and it changes with the physical canvas: 60×80cm fixes a single vertical ribbon,
              100×100cm allows up to three, and a 120×90cm canvas is the same composition as 60×80cm, painted on
              its side.
            </p>

            <hr />
            <h2>Update 3 — RubensJournal</h2>
            <p>
              Judging used to be treated as something to hide until it was finished — the whole record appeared
              at once, only once every vendor had finished. RubensJournal makes it the opposite: the point.
            </p>
            <p>
              RubensJournal is a public feed. A brief is created on the site — pick a canvas size, attach a
              reference photograph, write the instruction — and a shift runs, live: each variant appears the
              moment it renders, and the named judges&apos; verdicts trickle in underneath it as each vendor
              actually returns them, not batched at the end of the round.
            </p>
            <p>
              The site itself stays static — it never runs the shift. A shift is real compute against real, slow
              APIs, so it runs in GitHub Actions, dispatched by the site, writing to Supabase as it goes.
            </p>

            <hr />
            <h2>Update 4 — two speeds</h2>
            <p>
              A shift used to take between one and three hours — every judge call went through the vendors&apos;
              batch APIs, queues with a 24-hour SLA, polled one vendor after another. Live shift mode
              (<code className="mono">judging.useBatchApi: false</code>, the default) puts every call on the
              ordinary endpoint, pooled, so a round takes seconds rather than the sum of three queues. Night
              shift, the original batch path, is kept for large unattended runs where the discount is worth the
              wait.
            </p>

            <hr />
            <h2>Update 5 — a brief can carry up to four references</h2>
            <p>
              A brief now carries references, 1–4 entries, one per colour layer it wants to override; a slot it
              leaves out keeps the generator&apos;s own built-in study for that layer. A generator agent can
              propose moving a study from one layer to another, which it never could before.
            </p>

            <hr />
            <h2>What is in this repository</h2>
            <table className="repo-map">
              <tbody>
                <tr>
                  <td>generator/</td>
                  <td>The parametric generator. One HTML file, no build, no dependencies.</td>
                </tr>
                <tr>
                  <td>src/engine/</td>
                  <td>The same drawing code as a library, so the browser and the command line render identically.</td>
                </tr>
                <tr>
                  <td>src/syndicate/</td>
                  <td>The agents: proposal, rendering, pairwise judging, ranking.</td>
                </tr>
                <tr>
                  <td>runs/</td>
                  <td>Every shift, kept whole: proposals, renders, verdicts, disagreements.</td>
                </tr>
                <tr>
                  <td>studies/</td>
                  <td>The hand-painted colour studies the palettes are read from.</td>
                </tr>
                <tr>
                  <td>canvases/</td>
                  <td>Finished paintings and their deviation reports.</td>
                </tr>
              </tbody>
            </table>

            <hr />
            <h2>Method, honestly stated</h2>
            <p>
              The agents do not invent the mechanics. They search a space I built. Every structural idea in the
              generator — the ribbon deformation, the cell-bounded dye, the layer stack — came from the hand and
              the eye, not from a model.
            </p>
            <p>
              The judges see a rendered image at the size of a postcard. They read composition, proportion and
              colour distribution well. They are blind to impasto, to the ridge a loaded brush leaves, to what
              the surface does in raking light. That is the boundary of the instrument, and it is why a human
              still paints the result.
            </p>

            <hr />
            <p style={{ textAlign: "left", fontStyle: "italic" }}>Uccle, Belgium. 2026.</p>
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="panel-head">The repository</div>
            <div className="panel-body">
              <div className="stat-row">
                <span className="k">repo</span>
                <span className="mono">forma78/rubens</span>
              </div>
              <div className="stat-row">
                <span className="k">branch</span>
                <span className="mono">main</span>
              </div>
              <div className="stat-row">
                <span className="k">licence</span>
                <span className="mono">MIT</span>
              </div>
              <p style={{ marginTop: 10 }}>
                <a href="https://github.com/forma78/rubens" target="_blank" rel="noreferrer">
                  github.com/forma78/rubens
                </a>
                <br />
                <a href="https://rubens-pearl.vercel.app">rubens-pearl.vercel.app</a>
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">Running a shift</div>
            <div className="panel-body">
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-2)" }}>
                Live shift — ordinary endpoints, pooled, minutes. Night shift — batch APIs, cheaper, hours. Set by{" "}
                <span className="mono">judging.useBatchApi</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Chrome>
  );
}
