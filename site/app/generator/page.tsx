import { Chrome } from "@/components/chrome";

// The two generators, where a reader can actually open them. They live at
// the repository root and are copied into public/ at build time by
// scripts/stage-generators.mjs — see that file for why they are not
// committed here. The thumbnails are real renders by the engines
// themselves, made in the same pass.
//
// They open in their own tab rather than in a frame here: each one is a
// three-column instrument that wants the whole window, and squeezing it
// into 700px of a feed page would make it look broken rather than
// available.
const MODELS = [
  {
    n: 1,
    href: "/gen/index.html",
    thumb: "/gen/thumb-1.png",
    title: "Model 1 — dyed cloth",
    lede: "Colour fields, read out of a real painted study.",
    body:
      "A study is analysed for stroke direction and its pure colours recovered in CIE Lab, and the gradient is " +
      "kept as a probability of each colour at every point along the stroke. The generator lays synthetic " +
      "strokes by drawing from that probability, so the boundaries interlock in the same combed fingers a brush " +
      "leaves. A brief can carry up to four studies, and any of the five layers may show any one of them.",
    engine: "src/engine",
  },
  {
    n: 2,
    href: "/gen/index2.html",
    thumb: "/gen/thumb-2.png",
    title: "Model 2 — ruled cloth",
    lede: "Short ink bars from a small library, five stacked layers.",
    body:
      "The same cloth, ruled instead of dyed. Each layer takes a share of the cells and lays its bars one way; " +
      "whatever it leaves falls through to the layer beneath. One shared brush governs pitch, weight, length, " +
      "jitter and shade across all of them, and the fifth layer lays bars across the ribbons themselves.",
    engine: "src/engine2",
  },
];

export default function GeneratorPage() {
  return (
    <Chrome active="generator" crumb="rubens-pearl / generator">
      <h1 className="page-title">Generator</h1>
      <div className="run-meta">
        Two parametric models. The agents do not invent these — they search the space these open.
      </div>

      <div className="archive-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: 18 }}>
        {MODELS.map((m) => (
          <div className="panel" key={m.n}>
            <div className="panel-head">
              <span>{m.title}</span>
              <span className="panel-note">{m.engine}</span>
            </div>
            <div className="panel-body">
              <a href={m.href} target="_blank" rel="noreferrer">
                <img
                  src={m.thumb}
                  alt={`A render from model ${m.n}`}
                  style={{ display: "block", width: "100%", height: "auto", border: "1px solid var(--hairline)" }}
                />
              </a>
              <p style={{ margin: "12px 0 8px", fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>{m.lede}</p>
              <p style={{ margin: "0 0 12px", fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                {m.body}
              </p>
              <a href={m.href} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700 }}>
                Open model {m.n} →
              </a>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head">The cloth is the same cloth</div>
        <div className="panel-body">
          <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.6 }}>
            Panels clipped by ribbons, per-edge offsets, a Gaussian drape field, a rounded outline — that geometry
            was derived by hand over many sessions and has been frozen since. Both models draw it, and not as two
            similar implementations: <span className="mono">src/engine2</span> imports those functions from{" "}
            <span className="mono">src/engine</span> rather than keeping a copy. Two copies of frozen hand-derived
            maths is two things free to drift apart.
          </p>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            What differs is only what gets laid inside the cells. Every state either one can be put into renders to
            byte-identical SVG in the browser and on the command line — that is what makes a shift reproducible, and
            a run that cannot be reproduced is not published.
          </p>
        </div>
      </div>
    </Chrome>
  );
}
