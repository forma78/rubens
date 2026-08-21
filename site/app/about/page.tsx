import { Chrome } from "@/components/chrome";

// Built from README.md, and kept in step with it deliberately rather than
// paraphrased — the narrative is the artist's, not a summary of it.
//
// What this page is NOT any more (2026-08-21): the repository's changelog.
// It used to carry "Update 1" through "Update 5", each one explaining a
// change out of a state no visitor ever saw, plus config keys and a note
// about 429s. That is writing for the one person who already knew all of
// it. A visitor arrives wanting to know what they are looking at.
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
              them, argues about them, and ranks them by forced pairwise choice. I am the art director: I pick
              one.
            </p>
            <p>
              Then I paint it by hand, and it stops obeying. The tape edge runs straight where the cell is
              curved, the impasto stands up off the surface, a colour goes somewhere the model did not ask for.
              That divergence is measured too — the finished canvas is photographed and pushed back through the
              same analyser, and the delta between sketch and painting is published with the work.
            </p>
            <p style={{ fontStyle: "italic" }}>Hand teaches the algorithm. Algorithm proposes to the hand.</p>

            <h2>Who argues</h2>
            <p>
              Six judges. Two to a vendor, and each one is a single persona pinned to a single model — not a role
              replayed across whatever happens to be cheap that week. <strong>Ford</strong> reads mass, and
              whether the thing holds a wall from four metres. <strong>Maeve</strong> reads the hand, and whether
              it could hang in a series. <strong>Arnold</strong> reads craft: proportion, and colour placed
              rather than distributed. <strong>Hector</strong> reads colour and nothing else — heat, and whether
              it was decided or merely arrived at. <strong>Angela</strong> is eight years old and nobody has told
              her what art is. <strong>Stubbs</strong> looks for what comes apart at the seams, and awards
              nothing for beauty.
            </p>
            <p>
              Two to a vendor is the whole point of the arrangement. Disagreement is the measurement here — the
              share of pairs where two vendors split on the same two images — and a vendor needs more than one
              voice before a split means anything. They are given genuinely different things to care about for
              the same reason: six prompts that say the same thing on six models is one opinion, six times.
            </p>
            <p>
              Six agents propose. Bernard tightens, Dolores breaks, Akecheta removes, Akane moves colour,
              Clementine yields, Felix works the brush itself.
            </p>
            <p>
              And <strong>System</strong>, which is nobody. Eight of every thirty-two proposals are a seeded
              mutation with no model in the loop at all, judged in the same tournament under the same rules. It
              is the control group — what the six have to beat, and a standing check on whether the agents are
              searching or just spending.
            </p>

            <h2>What you are watching</h2>
            <p>
              A shift is a real spend, live. Thirty-two images are proposed once and rendered; each one appears
              the moment it exists. Then the judges argue, and their verdicts arrive underneath as each vendor
              actually answers, not batched at the end. The shift&apos;s own ranking is then halved four times —
              32 to 16 to 8 to 4 to 2 — so what you are reading down the page is one field narrowing, not five
              separate rounds of fresh work.
            </p>
            <p>
              Every verdict is real. Where the vendors disagreed on a pair, the disagreement is kept rather than
              averaged away; it is usually the most interesting thing in the record. Nothing here is a
              placeholder — if a call failed, the failure is what got written down.
            </p>

            <h2>What the cloth will not do</h2>
            <p>
              The first real shift produced compositions no cloth makes: a fold at a shallow angle, an overhang
              past nothing, drape sitting at zero. The range an agent may propose in is now the range real
              stretched cloth occupies, and it moves with the physical canvas — 60×80cm fixes a single vertical
              ribbon, 100×100cm allows up to three, and a 120×90cm canvas is the same composition as 60×80cm
              painted on its side. The agents are told why, not only clamped.
            </p>

            <h2>Method, honestly stated</h2>
            <p>
              The agents do not invent the mechanics. They search a space I built. Every structural idea in the
              generators — the ribbon deformation, the cell-bounded dye, the layer stack — came from the hand and
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
            <div className="panel-head">One shift, in numbers</div>
            <div className="panel-body">
              <div className="stat-row">
                <span className="k">proposals</span>
                <span className="mono">32</span>
              </div>
              <div className="stat-row">
                <span className="k">of those, no model</span>
                <span className="mono">8</span>
              </div>
              <div className="stat-row">
                <span className="k">pairs judged</span>
                <span className="mono">48</span>
              </div>
              <div className="stat-row">
                <span className="k">judges</span>
                <span className="mono">6</span>
              </div>
              <div className="stat-row">
                <span className="k">real verdicts</span>
                <span className="mono">288</span>
              </div>
              <p style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                Every one of them kept, with who said it and on which model.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Chrome>
  );
}
