# HANDOFF — RUBENS Brush Preview

Written for Claude working on this app. First version 2026-09-27, after the
first session. What the app is and how to use it is in `README.md` next to
this file. This file is about decisions already made and what to do next.

Machine context: `README.md`, `RAIL.md`, `CLAUDE.md` in the machine repo
(`~/RAIL-drawing_machine`, local, in Russian). The spec for RUBENS is
`../Rubens_v2.md`; it replaced `RUBENS.md` on 2026-09-27. Read them before
changing anything.

---

## 1. What it is

A localhost prototype: the user draws a path (lines and arcs only), picks
eight drops of paint, sees a preview of the stroke and exports two SVGs — the
line itself and the pass plan for the CNC. The app does not touch the
hardware.

State of v0.1: geometry is solid, the UI is ready for Instagram, the paint
model is invented and **not calibrated**, the machine file has not been run
through firmware yet (the firmware has no `M` and `U` commands yet).

---

## 2. Decided. Do not propose again

- **Everything in English: UI, documents, code comments, commit messages**
  (comments and docs switched from Russian on 2026-09-27). Braun style,
  `#EDEAE4` / `#EB7A25`, as on the MELNICOMM pendant.
- **Path — straight lines (`L`) and arcs (`A`) only.** No Béziers. A hand
  shakes, so the gesture gets straightened.
- **Scale 1:1.** The document is in pt, 1 pt = 25.4/72 mm. Stroke 1–500 pt.
- **Eight brush passes, not one.** A line of width W is 8 passes of one
  brush, W/8 apart. Pass 1 is the left edge looking along the drawing
  direction. For a 12 mm brush with no gaps that gives 96 mm = 272 pt.
- **Corners are rounded on the centre line.** Every kink of the centre line
  becomes an arc of radius W/2 + inner radius (10 mm by default). Passes are
  exact parallel copies and never cross. The preview uses the same centre
  line. The variant "outer pass goes round, inner pass is cut" was rejected:
  passes crossed each other at bends.
- **The centre line is the motors' path and paints nothing.** No ninth drop.
- **Export CNC: all lines black, 1 mm** — a pencil path. The pass colour is
  reference only, in `data-color`. The machine does not need colour.
- **Paint mixes — and that is fine.** Mixing of neighbouring passes is a
  feature.
- **Do not model drying and do not warn about it.** The user has a retarder;
  acrylic can stay wet for 12 hours. No "finish within N minutes" anywhere,
  in code or UI.
- **No brush washing: there are several brushes.** A quick-swap mount, four
  are enough: one runs, the others dry. The user stands next to the machine,
  swaps brushes and squeezes paint. No washing station.
- **A continuous line "like Florian Markus" — rather not.** It gets dirty and
  smeared; the user wants juicy, bright works. Hence item 3.1.
- **The path is smooth, a pass runs without stops.** Cutting curves into
  short straight lines with a stop at every joint was tried and disliked.
- **The snake turns with a semicircle** of radius half the pass pitch: 6 mm
  at a 12 mm pitch. The brush stays down. Decided 2026-09-27.
- **Small kinks (under 0.5°) stay unrounded** — texture, not a defect.
  **Spots marked "!"** are shown on the Job tab but do not block the start;
  the machine slows to zero there. Decided 2026-09-27.

---

## 3. To do, most important first

### 3.1. Take the brush off and travel back after every pass — REQUIRED

The user's words (translated): "after every paint run — bottom to top — the
3DOF around the wrist lifts and the machine travels back idle, as an option".

- **Passes paint from the bottom of the canvas to the top** (clarified with
  the user on 2026-09-27: "bottom to top" is the direction of the passes
  themselves). The bottom of the picture is at the beam, where the user
  stands (`Rubens_v2.md`, section 7). Every pass starts at the lower end of
  the stroke and goes to the upper end. If a stroke was drawn top-down, the
  pass is reversed. A stroke that wanders up and down is painted from the
  lower end. Ends at the same height — keep the drawing direction.
- Hence: start drops and the first refills are at the lower end. Lane order
  does not change physically on reversal: pass 1 stays at the same edge of
  the line, but "left along travel" becomes right — tie the labels in the UI
  and in `data-lane` to the edge of the line, not to the travel direction.
- In v0.1 passes and preview run in the drawing direction. Reverse the preview
  (where paint is fresh, where the brush dries) together with the passes.
- After every pass the brush leaves the canvas (`U 1`), the machine travels
  back idle to the start of the next pass, the brush comes back (`U 0`).
  **The brush does not lift straight up:** the wrist J3 swings it sideways
  like a broom, up to 90° (confirmed 2026-09-27). On the way off and back it
  drags a sideways mark — see `Rubens_v2.md`, section 4.5.
- **This is an option**, a toggle in the UI and a parameter in the export.
  On by default. Off — passes join without leaving the canvas (a continuous
  line): the direction then alternates as a snake, and the bottom-to-top rule
  applies only with the option on. The snake turn is a semicircle (section 2).
- In Export CNC, travel moves get their own kind (`data-kind="travel"`) so
  RUBENS can tell "paint" from "air" (`Rubens_v2.md`, section 5).

### 3.2. Brush: flat or round

A flat brush must stay across the direction of travel at all times. On bends
it would have to turn with the line, otherwise it runs sideways and the trace
narrows almost to nothing.

Nothing on the arm can turn it (confirmed 2026-09-27): J3 swings the brush
sideways instead of turning it about the vertical axis, and the shoulder and
elbow move the tip when they rotate. The user leans towards a **round**
brush, which needs no turning. Wait for the user's decision.

In the UI, Flat 8 / Flat 12 is only the preview texture for now. Rework to
match the decision: a round brush gets its own texture profile.

### 3.3. Pause for brush change and refill

The machine travels to the refill point, takes the brush off the canvas and
waits for a button. The user squeezes paint or swaps the brush, presses —
go. Then pencil marks for the drops are not needed (graphite shows through
white and yellow). Keep the marks as an option for a trial run. The user
decides.

### 3.4. Calibrate the preview from photos

The 0.3 mm film, "25 % stays in the brush", the gaps of the wide brush are
guesses. Photograph the first test strokes from above, fit the texture and
paint-use parameters. Do not fill in plausible numbers without a measurement
(`Rubens_v2.md`, section 8).

### 3.5. Machine work area

X between the walls is 877 mm (−302.0 … +575.0); Y travel is not recorded
yet. A 100 × 100 canvas does not fit along X. With the arm straight, the
bottom 170 mm of the canvas are out of reach (`Rubens_v2.md`, section 7).
Draw the work area over the canvas and warn when a stroke leaves it. Binding
the canvas zero to the machine zero is a separate procedure; there are no end
stops.

### 3.6. Code

- `app.js` is 1246 lines in one file. Split into modules: geometry (segments,
  gesture fitting, rounding, offsets), paint (stamp strips, ml math), CNC
  (plan, export), UI. Translate comments to English along the way.
- Automated geometry tests. The main one: "passes of one stroke do not cross"
  on a set of shapes with sharp corners, zigzags and loops. For a loop the
  axis crosses itself, so passes may cross only near that self-crossing.
- Fix the SVG as the contract with RUBENS: groups, `data-*`, units — mm
  (`Rubens_v2.md`, section 5).

### 3.7. Small things

- Delete a single point (now ⌫ deletes the whole stroke).
- Closed shapes: start and finish are just two ends now, drops at the joint.
- Reverse a stroke's direction.
- `default.svg`: the user will save a drawing next to `index.html`.

### 3.8. Job tab and the ⚡️ Do Job button

The second tab is technical: top view, the pass plan, where the brush is now,
percent done and minutes left, like a 3D printer. The ⚡️ Do Job button on the
Paint tab switches to it. How it works and in what order to build it —
`Rubens_v2.md`, sections 3, 4.6, 6 and 10.

---

## 4. How it is built (short)

| where in `app.js` | what |
|---|---|
| segment geometry | `L` and `A`, points, tangents, `samplePath` |
| gesture fitting | `fitSegment`: mouse trail → line (15° step) or arc (sweep to 45°), tangent continuation |
| anchor editing | anchors, Shift selection; an arc keeps its sweep while edited |
| corner rounding | `filleted(p)` — centre line with arcs at kinks; `offsetSegs` — a parallel copy |
| stamp strips | brush cross-section, pigment mixing, dry brush |
| CNC Trace | `cncPlan(p)`: passes, lengths, drops; `exportCNC` |
| SVG export / import | the app's own file is restored exactly from `<metadata id="rubens-state">` |

The comment headers in `app.js` are still in Russian; they become English with
the module split (item 3.6).

State lives in `localStorage` (`rubens.v01`); undo history is JSON snapshots.

---

## 5. How to talk

As in the machine's `CLAUDE.md`: the user is a designer and artist. No jargon,
concrete names and numbers, not "roughly". Catches inaccuracies, typographic
ones included. Expands ideas fast — check that an improvement does not replace
the original idea. If you got something wrong, say so at once.
