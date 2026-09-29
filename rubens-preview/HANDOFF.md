# HANDOFF — RUBENS Brush Preview

Written for Claude working on this app. First version 2026-09-27, after the
first session. What the app is and how to use it is in `README.md` next to
this file. This file is about decisions already made and what to do next.

Machine context: `README.md`, `RAIL.md`, `CLAUDE.md` in the machine repo
(`~/RAIL-drawing_machine`, in Russian; the machine is CNCDM-001, under git
since 2026-09-28, private on GitHub as `forma78/CNCDM-001`). The spec for RUBENS is
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
  **The Stroke panel shows whole mm of one lane** (1…22 mm, the field, the
  slider, ±1 mm), with a mm | pt switch, mm by default; no pt and no
  fractions in mm. Decided 2026-09-29 (the owner: "20 mm each lane, 25, 30").
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
- **Brush mode: every lane in 2, 4 or 8 trips on the canvas** (Job tab), the
  brush down within a lane, a lane / trips apart about its centre line. The
  first canvas (2026-09-28) had 2 trips, 11 mm apart, and the round No. 4
  left canvas between them; the owner: no thicker brush, **4 trips a lane**
  (the default). Decided 2026-09-28. **8 trips** added 2026-09-29 after a
  day of tests: the lane stays as wide, the trips go twice as dense (2.75 mm
  on a 500 pt stroke); the owner chose that over wider lanes at 5.5 mm.
- **Lines may cross and overlap** — it is painting (the owner, 2026-09-27,
  with an Illustrator example). Loops of the centre line cross by nature.
- **Where the rounding does not fit ("!") the inner passes meet in a sharp
  point**, like an offset path in Illustrator; so do the inner passes at a
  kink under 0.5°. Before, a straight bridge ran backwards there and the
  passes criss-crossed. This is not the rejected "inner pass is cut" variant
  above: the centre line is still rounded everywhere; cutting is only the
  fallback where the rounding cannot fit. Decided 2026-09-27.

---

## 3. To do, most important first

### 3.0. Turn on / Turn off and the arm zero — TODAY, before the power-off

Decided 2026-09-28. The morning's trouble (`../CALIBRATION.md`, 2026-09-28):
the firmware takes each joint's zero from the pose it stands in at the first
command after power-on; every job ends with the brush off (+90°), so the next
morning +90° becomes 0. The owner: no hand-fixed numbers in the firmware
("filing submarine parts by hand"); the servos see their own pose, so use it.

- **The arm zero is calibration, like the canvas corners:** raw servo poses
  (4096 per turn) in `calibration.json`, dated, in git. Now: J3 on the canvas
  (0°) 1489, shoulder 2501, elbow 1759. An "Arm zero here" button on the
  Calibration tab reads new ones from the servos (brush or holder changed).
- **Firmware, one change, flashed once with the owner:** a command "the zero
  of joint j is raw pose n", and no arm motion at all until it came (as the
  axes go nowhere near a wall without a zero). The "pose at the first
  command" rule goes. Draft in `RAIL-drawing_machine/drafts/`, host test,
  flash together, test in the air.
- **Turn off** (replaces the single "Shut down" of the morning; `rubens.py`
  class `Park` is its X/Y part, tested): HARD STOP → J3 to +90° → the
  carriage stands → X/Y saved → "switch off the 12 V".
- **Turn on** (after the 12 V is on): the arm zero from `calibration.json`
  goes to the board → shoulder and elbow hold; if the arm was moved, the
  servos show it and RUBENS brings it back to the working pose → J3 +90° →
  X/Y restored (the place is good for one zero only) → walls on. No drive to
  the stops.
- **Measure tomorrow morning:** the stepper click at power-on (up to two full
  steps: 0.4 mm on X, 1.2 mm on Y) — Turn on, then the tip to a corner of
  the blue frame.
- Stops first, as always: Turn off is a HARD STOP before anything else, and
  STOP / HARD STOP stay reachable during Turn on.

### 3.1. Take the brush off and travel back after every pass — REQUIRED

**Status 2026-09-27:** the plan does it (`cncPlan`: every pass bottom to top
with the option on, a snake with the option off; `job.js`: paint, travel and
turn steps in machine order), CNC Trace shows direction, travel and turns,
the preview puts fresh paint at the lower end. The toggle is "Brush off after
each pass" in the Brush panel. **Left:** the preview lane by lane (in a snake
it still follows lane 1), and `data-kind` in Export CNC (`job.json` from the
Job tab already has the kinds). The owner has not looked at it yet.

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

### 3.2. Brush: round — decided 2026-09-28

A flat brush must stay across the direction of travel at all times. On bends
it would have to turn with the line, otherwise it runs sideways and the trace
narrows almost to nothing.

Nothing on the arm can turn it (confirmed 2026-09-27): J3 swings the brush
sideways instead of turning it about the vertical axis, and the shoulder and
elbow move the tip when they rotate. **The owner chose a round brush**
(2026-09-28, a Raphael No. 4, `../CALIBRATION.md`), which needs no turning.

In the UI, Flat 8 / Flat 12 is only the preview texture for now. Left: a round
brush gets its own texture profile, fitted from the first paint photos
(section 3.4), not invented.

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

Measured 2026-09-27 (`../CALIBRATION.md`): X walls 0 … 865 mm, Y walls
0 … 568.5 mm (the right Y stop still to confirm). Zero is at the walls, home
is the bottom left corner. The Calibration tab records the canvas corners and
reports the strips out of reach. Left: draw the work area over the artboard
on the Create tab and warn when a stroke leaves it.

### 3.6. Code

- ~~Split `app.js` into modules~~ — done 2026-09-27: `src/`, see section 4.
  Comments are in English.
- ~~Automated geometry tests~~ — done 2026-09-27: `node --test` in
  `rubens-preview/`. The main one: the passes of one stroke keep their lane
  spacing, so they never cross; for a loop they cross only where the centre
  line crosses itself. Also: every pass is smooth, paint math, the drop plan,
  gesture fitting, both SVG files.
- Fix the SVG as the contract with RUBENS: groups, `data-*`, units — mm
  (`Rubens_v2.md`, section 5).

### 3.7. Small things

- Delete a single point (now ⌫ deletes the whole stroke).
- Closed shapes: start and finish are just two ends now, drops at the joint.
- Reverse a stroke's direction.
- `default.svg`: the user will save a drawing next to `index.html`.

### 3.8a. Small inconsistencies at tight corners — after v0.1

The owner saw small inconsistencies at tight corners on 2026-09-27 and chose
to keep v0.1 as it is and come back later. Screenshots:
`images_CNC_drawing_machine/tight-corners-1.png` and `tight-corners-2.png`.
Ask the owner what exactly to look at before changing anything.

### 3.8. Job tab and the ⚡️ Do Job button

The second tab is technical: top view, the pass plan, where the brush is now,
percent done and minutes left, like a 3D printer. The ⚡️ Do Job button on the
Create tab switches to it. How it works and in what order to build it —
`Rubens_v2.md`, sections 3, 4.6, 6 and 10.

**Status 2026-09-27, first version:** `job.html` reads the drawing the Paint
tab keeps in the browser, plays the job on screen (percent by painted length,
minutes left, ×1…×300) with an editable time model (estimates), and writes
`job.json` through `rubens.py`. With three canvas corners recorded on the
Calibration tab, the Machine section turns the job into what the board runs
(`jobToMachine` in `machine.js`: brush off / travel / brush on / pass blocks,
`L`, `A`, `M`, `G` in machine mm), cut at the walls — past them nothing is painted, the owner's decision — and reports what is left out; they go
into `job.json` as `machine.blocks`. **Left:** the view of the job on the
machine, the brush from the ping, `rubens.py` running the blocks — after the
firmware draft (`RAIL-drawing_machine/drafts/rubens-pass/`) is tested.

---

## 4. How it is built (short)

| module | what |
|---|---|
| `src/config.js` | units, formats, brush profiles, default palettes |
| `src/util.js` | vectors, angles, number formatting, seeded random |
| `src/color.js` | sRGB ↔ linear, HEX, pigment-like mixing |
| `src/geometry.js` | `L` and `A` segments, points, tangents, `samplePath`; anchor editing (an arc keeps its sweep); SVG path data |
| `src/gesture.js` | `fitSegment`: mouse trail → line (15° step) or arc (sweep to 45°), tangent continuation |
| `src/fillet.js` | `filleted(p, cornerR)` — centre line with arcs at kinks; `offsetSegs` — a parallel copy |
| `src/paint.js` | paint math: lengths, ml, clean reach, bead size |
| `src/cnc.js` | `cncPlan(p, colors, paint)`: passes, lengths, drops; `cncSvg` — the machine file |
| `src/job.js` | `jobSteps`: paint / travel / turn in machine order; `jobTimeline`, `jobAt` — the job on a clock; `jobFile` — `job.json` |
| `src/machine.js` | the machine: steps per mm, stops, walls, home, the ping; the canvas from its corners; `jobToMachine` — the job as board commands |
| `src/svg.js` | `drawingSvg` — the drawing with its full state in `<metadata id="rubens-state">`; `simplify` for foreign SVG |
| `src/render.js` | stamp strips (brush cross-section, pigment mixing, dry brush) and painting on a canvas |
| `src/app.js` | the Create tab: state, input, panels, CNC Trace on screen, export and import |
| `src/calibration.js` | the Calibration tab |
| `src/jobpage.js` | the Job tab |
| `test/` | `node --test`; `test/shapes.js` builds the test strokes |

Everything except `render.js` and the three page modules runs without a browser, so the
tests import it in Node. The pure modules never read the page state: the
paint settings and colours are passed in as arguments.

State lives in `localStorage` (`rubens.v01`); undo history is JSON snapshots.

---

## 5. How to talk

As in the machine's `CLAUDE.md`: the user is a designer and artist. No jargon,
concrete names and numbers, not "roughly". Catches inaccuracies, typographic
ones included. Expands ideas fast — check that an improvement does not replace
the original idea. If you got something wrong, say so at once.
