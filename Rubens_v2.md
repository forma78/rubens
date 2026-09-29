# Rubens_v2.md

Spec for **RUBENS**, second version. Written 2026-09-27.

It replaces `RUBENS.md` of 2026-09-22, which lived in `~/RAIL-drawing_machine`
and was deleted on 2026-09-27: a lot had changed and the old text started to
mislead.

| where | what |
|---|---|
| `Rubens_v2.md` | this file: what RUBENS is, decisions, the contract with the machine |
| `rubens-preview/` | the app: Create, Calibration and Job tabs, and `rubens.py` |
| `rubens-preview/HANDOFF.md` | the to-do list for the app |
| `rubens-preview/README.md` | how to run and use the app |
| `images_CNC_drawing_machine/` | photos of the machine and the arm drawing, 2026-09-27 |
| `~/RAIL-drawing_machine/` | the machine, local only and in Russian: `README.md` (hardware, pins), `RAIL.md` (X axis), `CLAUDE.md` (firmware rules) |

Hardware numbers and firmware rules live in the machine repo and are not
repeated here. If this file and `HANDOFF.md` disagree, the later entry wins.

Decisions Claude made as technical lead are marked *Claude's decision*.
Any of them can be undone with one word.

Everything in this repo is in English: documents, code comments, commit
messages (decided 2026-09-27). The app UI was English from the start.

---

## 1. What changed since RUBENS.md

| in RUBENS.md | now |
|---|---|
| Input: SVG from Illustrator | Strokes are drawn in the app itself, on the Create tab. A foreign SVG still opens, but is broken into short straight lines |
| Curves are cut into short straight lines; every segment starts and ends at zero speed | Tried and disliked. The path is lines and arcs only, corners are rounded, a pass runs without stops |
| Layer = one tool, one colour, one pass | A stroke of width W = eight passes of one brush, each pass with its own drop of paint |
| Strokes are sorted for short travel moves | For the brush, stroke order = drawing order: it decides what lands on top of what while wet. *Claude's decision* |
| A standalone program on the Mac | A browser page with three tabs, Create, Calibration and Job, plus a Python process that runs the job (section 6) |
| Brush 3–5 mm | Round, decided 2026-09-28 (a Raphael No. 4). The trace width is measured, not assumed |
| `U` lifts the tool with a spare servo, ID 4 | The wrist J3 swings the brush off the canvas sideways, like a broom (section 4.5) |

Unchanged from RUBENS.md:

- RUBENS is not firmware and does not replace it. GRBL is rejected.
  Coordinated X and Y motion is our own, on top of `FastAccelStepper`.
- The Mac thinks, the board executes.
- The bridge `bridge.py` owns the serial port; RUBENS reaches the hardware
  through it over HTTP.
- During a pass the arm holds its pose and the axes draw.
- The machine does not move until a person has seen what it will do. A dry
  run on a new format is mandatory.
- Numbers that are not in any datasheet come only from measurement.

---

## 2. What it is

RUBENS is the second project on the Motor Brush machine (machine
`CLAUDE.md`, section "Two projects on one machine"). A person draws strokes and picks
paint; the machine drives the brush across the canvas. Paint is squeezed onto
the canvas beforehand, the brush spreads it. The arm holds its pose for the
whole layer; the X and Y axes do the drawing.

---

## 3. Three tabs

**Create** (called Paint until 2026-09-27, renamed by the owner) — the
creative tab. Strokes, a palette of eight drops, width, mixing, paint
preview, SVG and PNG export. **🖨 Open Job** — a black button on it, opens
the Job tab.

**Calibration** — the machine from above, live: jog, home, where the canvas
lies (added 2026-09-27; `CALIBRATION.md`).

**Job** — the technical tab. The canvas seen from above:

- the canvas with the machine's work area on top of it;
- the plan: passes in order, travel moves dashed, refill stops;
- checks before start (section 4.6);
- while running: where the brush is now (from the board's ping reply),
  which pass is running, what is already painted;
- **percent done and minutes left, like a 3D printer.** Before start, an
  estimate for the whole job;
- buttons: dry run, start, pause, "continue" after a refill, **STOP** and
  **HARD STOP** — two separate buttons, as on the MELNICOMM pendant;
- **⚡️ Do Job** — starts the job on the machine (the owner's name for it,
  from Mafia Wars).

**Percent is measured along the painted passes:** how many millimetres are
painted out of the total. Travel moves and pauses do not count, otherwise the
number would freeze while the person adds paint. *Claude's decision.*

**Minutes come from the plan:** the length of every pass and travel move,
speed, acceleration, brush swings. Refill pauses are not in the estimate —
only the person knows how long they take. After every run the estimate is
compared with reality and corrected: measure, compare, fix.

The UI is in English. Braun style, `#EDEAE4` / `#EB7A25`, as on the MELNICOMM
pendant.

---

## 4. Strokes and passes

### 4.1. Path

Straight lines (`L`) and circular arcs (`A`) only, no Béziers anywhere. The
document is in pt at 1:1 scale with the canvas, 1 pt = 25.4/72 mm.
Stroke 1–500 pt; the Create tab shows it in whole mm of one lane (1…22 mm)
unless switched to pt.

### 4.2. Eight passes

A line of width W is eight passes of one brush, W/8 apart. Pass i runs
parallel to the centre line at an offset of ((i + 0.5)/8 − 0.5) × W. For a
12 mm brush with no gaps, W = 96 mm = 272 pt.

The centre line is the motors' path and paints nothing; there is no ninth
drop. An empty palette slot means no pass. Lane numbers are tied to an edge of
the line, not to the direction of travel.

### 4.3. Rounded corners

Every kink of the centre line becomes an arc of radius W/2 + inner radius
(10 mm by default, a field in the Brush panel). Passes are exact parallel
copies: straight lines stay straight, corners become concentric arcs, nothing
crosses. The preview is drawn along the same centre line.

### 4.4. A smooth pass, no stops

The tangent is continuous along the whole pass. The machine stops only at the
ends of a pass.

**Small kinks stay.** A joint where the direction changes by less than 0.5°
is not rounded. The machine takes it on the move, barely slowing down. This is
painting, not a technical drawing: if such a joint shows, it is texture.
*Claude's decision, 2026-09-27.*

**At spots marked "!"** the rounding did not fit, and the inner passes meet
in a sharp point, like an offset path in Illustrator. The machine slows to
zero there and carries on, as at any corner. The Job tab shows such spots but
does not block the start. *Claude's decision.*

**Lines may cross and overlap** — this is painting (the owner, 2026-09-27).

### 4.5. Order, and taking the brush off the canvas

**Taking the brush off after every pass is an option, on by default.**

- Passes paint from the bottom of the picture to the top. The bottom is at
  the beam, where the person stands; the top is the far end of the frame
  (section 7). A pass starts at the lower end of the stroke and runs to the
  upper end; a stroke drawn top-down is painted in reverse. A stroke that
  wanders up and down is painted from whichever end is lower. Ends at the same
  height — the drawing direction.
- After a pass the brush leaves the canvas (`U 1`), the machine travels to the
  start of the next pass, the brush comes back (`U 0`). Travel is a straight
  line, one command: if both ends are inside the work area, so is the line.
  *Claude's decision.*

**How the brush leaves the canvas.** Not straight up as on a pen plotter.
The wrist J3 swings the brush sideways like a clock hand, up to 90°, like a
broom (confirmed 2026-09-27). Turned 90°, the stick lies flat and the tip is in
the air.

While the spring holds the tip on the canvas, the swing drags the tip
sideways across the neighbouring lanes. The length of that mark is L·sin θ,
where L is the distance from the J3 axis to the tip and θ is the angle at
which the tip leaves the canvas: L·(1 − cos θ) = how far the spring is
compressed. The same mark appears when the brush comes back down.
*Example only, not measured:* L = 100 mm and 5 mm of compression give
θ = 18.2° and a mark of about 31 mm — more than two lanes at a 12 mm pitch.

*Claude's proposal:* swing towards the lanes not painted yet, so the next
passes paint over the mark. J3 can swing either way (±90°), so RUBENS picks
the side for every pass. The last pass of a stroke has no unpainted
neighbours: its mark goes either outside the stroke or back over painted
lanes. That is the owner's call (section 9).

**Option off** — passes run as a snake, direction alternates, the
bottom-to-top rule does not apply. The move from the end of one pass to the
start of the next is a semicircle with a diameter equal to the pass pitch:
radius 6 mm at a 12 mm pitch. The brush stays down and leaves a rounded end.
Decided 2026-09-27.

Strokes go in drawing order; within a stroke, passes 1 → 8.

### 4.6. Checks before start

The start (⚡️ Do Job) does not run while the machine has no zero, or while
the board cannot run a path yet; nothing moves, not even the brush.

**Past the walls the machine does not paint** — the owner's decision,
2026-09-27, replacing Claude's earlier "lock the start while the tip would
leave the work area": "it is not a laser printer; I built a machine that
does not stumble on this". Every pass is cut at the walls; where a stroke
comes back inside, a new pass starts (brush off, travel, brush on). What is
left out is shown on the Job tab, for the record. The edge of the canvas is
not a limit: inside the walls the brush paints past it.

Spots marked "!" are only shown (section 4.4).

### 4.7. Paint

- Neighbouring passes mix — and that is fine, it is a feature.
- Do not model drying and do not warn about it: the paint has a retarder,
  acrylic stays wet up to 12 hours.
- Brushes are not washed: there are several, four are enough. The person
  stands next to the machine, swaps brushes and squeezes paint at the same
  time. No washing station.
- **Refill and brush change are a pause.** The machine takes the brush off the
  canvas, stops and waits for "continue" on the Job tab. The firmware needs no
  new command for this: RUBENS simply does not send the next one. Pencil marks
  for the drops are an option for a trial run.
- Paint use follows the formula in `rubens-preview/README.md`. The 0.3 mm
  film and 25 % kept in the brush are guesses until calibrated (section 8).

### 4.8. The brush

**Round** — decided by the owner 2026-09-28 (a Raphael No. 4, see
`CALIBRATION.md`). A flat brush would have to stay across the direction
of travel and turn with the line on bends. Nothing on the arm can do that:
the shoulder and elbow rotate about vertical axes but move the tip when they
do, and J3 swings the brush sideways instead of turning it about the vertical
(section 7). A round brush needs no turning.

---

## 5. The file for the machine

Export CNC is the contract between the Create tab and whatever runs the job.
How it works from now on (v0.1 still exports the old way; the rework is in
`HANDOFF.md`):

- **Units are mm.** `viewBox` in mm, one unit = 1 mm. Steps (80 per mm) are
  computed by RUBENS at run time: steps belong to the machine, not the
  drawing. *Claude's decision.*
- **Geometry is `M`, `L`, `A` only.** Nothing is cut into straight lines.
- **Everything in execution order.** Each element has `data-kind`: `paint`,
  `travel` or `stop`. `U 1` and `U 0` follow from the change `paint` →
  `travel` and back. *Claude's decision.*
- **Per pass:** `data-lane` (lane number), `data-color` (reference only),
  `data-dir` (with or against the drawing direction), length, drops.
- **All lines are black, 1 mm** — a pencil path. The machine does not need
  colour.
- Drop marks are a separate group, optional.

The process that runs the job gets the same plan as JSON. The SVG stays for
viewing and for a pencil run.

---

## 6. How RUBENS talks to the machine

**Three processes on the Mac:**

| what | port | does |
|---|---|---|
| `bridge.py` | 8765 | as now: the only owner of the serial port, the MELNICOMM pendant |
| `rubens.py` (to come) | 8766 | serves the Rubens page instead of `python3 -m http.server`, takes the plan, runs the job, talks to the bridge |
| the browser page | — | draws, shows progress, has the buttons |

**The job is run by `rubens.py`, not by the page.** The system may throttle
a background browser tab, and the board's watchdog stops the axes after 1.5 s
of silence. A job must not depend on whether the tab is in front. The page
and `rubens.py` share one port, so no cross-origin setup is needed.
*Claude's decision.*

**Where the brush is.** The ping `P` already reports the axes:
`ok P X <steps> Y <steps>`. `rubens.py` pings, the Job tab draws the brush.

**The bridge gets** a pass-through endpoint, as planned in RUBENS.md: take a
command over HTTP, write it to the port, return the board's reply.

**Firmware:**

- `P`, `V`, `S`, `K`, `O`, `J`, `Z` — exist.
- `M <x> <y>` — to a point, absolute position in whole steps. For travel
  moves it can work as in RUBENS.md: from zero speed to zero speed.
- **A painting pass runs without stopping at line/arc joints.** *Claude's
  decision, 2026-09-27; a draft, not flashed yet*
  (`RAIL-drawing_machine/drafts/rubens-pass/`): the host sends a chain of
  pieces in machine mm — `L x y`, `A cx cy x y ±1`, travel `M x y` — into a
  queue of 16 on the board, then `G`; more pieces can follow on the move. The
  board moves the tip along the chain on a 20 ms clock with a trapezoid speed
  (250 mm/s²), always able to stop at the end of what it has; no slowdown at
  smooth joints, a stop at a kink over 10° and around every travel move. Each
  tick both axes get their own steps for the same time (`moveTimed` in
  FastAccelStepper), so lines stay straight and arcs round although the axes
  have different steps per mm. Walls are checked when a piece is queued. S
  brakes along the path, K stops at once, the watchdog brakes like S; while a
  path runs, X, Y, J and O are refused. The planner is tested on the Mac.
- `U <0|1>` — brush on / off the canvas. Done by J3 swinging sideways
  (confirmed 2026-09-27); the fourth servo is not needed for this. `U` moves
  J3 between 0° and ±90°; RUBENS picks the side for each pass (section 4.5).

The firmware's iron rules are in the machine's `CLAUDE.md` and do not change:
STEP only through `FastAccelStepper`, do not touch the 20 ms tick, do not
touch `Serial1`, an arm command stops the axes first. Anything that moves the
hardware happens only with the person's knowledge. The only ways to check the
link are `P` and `V`.

---

## 7. Coordinates and work area

**The brush tip paints, but the machine moves the carriage.** Tip = carriage
+ the arm's reach. The arm holds still for the whole layer, so the reach is a
constant vector and the whole plan is simply shifted by it.

**Zero is taken at the brush tip.** Arm in the working pose, brush lowered
onto the mark at the canvas corner, tell the machine "this is (0, 0)". The
reach is accounted for by itself; link lengths are not needed for this.
*Claude's decision.* The arm geometry is needed to draw the tip's work area
before zero is taken, and if the pose changes between layers.

**Axes, stops and walls — measured 2026-09-27** (full log:
`CALIBRATION.md`). X runs along the long side, plus to the top of the
picture; Y across, plus to the right. X: 20-tooth pulley, 80 steps per mm.
Y: 60-tooth pulley, 26.667 steps per mm. The owner's decision: **zero is
where the walls are, and the reserve up to each stop is minus**, like the
reserve in a fuel tank. X: walls 0 … 850.0 mm, stops −9.45 and +860.55 (870 mm
of travel on the left). Y: walls 0 … 568.5 mm, left stop −8.3; the right stop
is to be confirmed (probably near 569.5, then the right wall moves to about
559.5). Home is the bottom left corner, both stops, set from the Calibration
page. A 100 cm side does not fit along X.

**The machine from the photos of 2026-09-27** (`images_CNC_drawing_machine/`):

- a gantry: a frame of aluminium profile on legs, the canvas lies inside.
  A beam spans the frame (belt, idler at the far end); the arm sits at its
  right end and reaches out over the canvas;
- long lines both ways and diagonals on the canvas: both axes seem to move
  together already;
- the shoulder and elbow rotate about vertical axes: the arm moves parallel
  to the canvas;
- **J3, the wrist (WRIST on the pendant), swings the holder sideways like a
  clock hand, up to 90°, like a broom** (confirmed 2026-09-27). Stick straight
  down — it paints; turned 90° — it lies flat, tip in the air;
- a spring-loaded holder: the stick is pressed down softly. These are the
  "3 cm of soft travel" planned in `RAIL.md`;
- the holder has a gel pen and a purple marker for now; no brush yet.

**The arm drawing ("Lapa")** — `images_CNC_drawing_machine/arm-lapa-drawing.jpeg`,
drawn 2026-09-27. Top view, arm stretched straight across the beam:

| what | mm |
|---|---|
| shoulder axis → elbow axis | 120 |
| shoulder axis → stick axis | 210 |
| elbow axis → stick axis | 90 (= 210 − 120) |
| stick axis → beam edge on the canvas side | 170 |
| shoulder axis → the same beam edge | 40 (= 210 − 170) |
| beam width | 45 |
| shoulder block along the beam | 55 |
| part on the other side of the beam | 230 |

- **The straight arm is zero on the pendant:** shoulder 0°, elbow 0°
  (confirmed 2026-09-27).
- **The 230 mm part** is the old leg of the RoArm-M3 Pro. It holds the three
  motors with screws and helps keep the centre. It does not affect the
  kinematics.

So in the straight pose the tip is 210 mm from the shoulder axis, across the
beam, and 170 mm ahead of its edge. If the stick is not vertical the tip
moves away from the stick axis — one more reason to take zero at the tip.

**Bottom and top of the picture** — shown on the annotated photo of
2026-09-27. Bottom: the near end of the frame, at the beam, where the person
stands. Top: the far end. Bottom-to-top runs along the long side of the frame,
and the arm points the same way. `RAIL.md` puts X along the long side; the
owner's note of 2026-09-27 called it Y — to settle (section 9). Which way is
plus along that axis is not recorded.

**The bottom strip of the canvas** (confirmed 2026-09-27): the beam cannot go
past the bottom edge of the canvas — the rails are too short. The tip is never
closer to the bottom than 170 mm ahead of the beam edge, so with the arm
straight **the bottom 170 mm of the canvas are out of reach.** The Job tab
shows that strip. Ways out, later: move the canvas towards the top if there is
travel for it, or bend the arm for a layer. With the shoulder at 45° and the
elbow at 45° the tip is 44.9 mm ahead of the beam edge (and 174.9 mm to the
side): 120·cos 45° + 90·cos 90° = 84.9 mm from the shoulder axis, minus 40.

**Material** (from RUBENS.md, not revisited): the commercial format is paper
60 × 80 cm at 190 €, canvas is the next stage. The sheet is clamped outside
the work area and must not shift between layers: if it shifts, registration
is lost.

---

## 8. Measure by hand. Do not guess

**Repeatability over accuracy** — the owner, 2026-09-27, after four pencil
squares that came out 48 × 45 mm instead of 50 × 50 and lay exactly on each
other: "we are not making architectural drawings; these errors are a plus;
what matters is the trace itself — the brush follows the pencil line, and it
matches perfectly". A few mm of absolute error are accepted; the line must
repeat. Calibration work goes into repeatability first.

Until a number is measured, the field in the app is marked as a guess and no
plausible value is filled in.

- **Paint film and how much stays in the brush.** Now 0.3 mm and 25 % —
  guesses. Squeeze a known volume, paint, measure the clean trace, photograph
  from above, fit.
- **The real trace width of the brush.** It sets the pass pitch: no gaps
  means W = 8 × trace width.
- **How the trace changes towards the end of a stroke.** If it shows, it is
  texture and worth using on purpose.
- **L, from the J3 axis to the brush tip, and how far the spring is
  compressed in the working pose.** Together they give the length of the swing
  mark (section 4.5).
- **J3 angle for "on the canvas"** — is the stick vertical at 0°?
- ~~**Y travel**~~ — measured 2026-09-27 (`CALIBRATION.md`); the right stop
  still to confirm.
- **Arm pose** in which the brush sits right in the middle of the field.
- **Pass speed** at which the brush lays paint evenly, and the acceleration
  that does not shake it at a line/arc joint.
- **Time.** After every run: estimate against reality, correct the time model.

---

## 9. Open questions

1. **The swing mark (section 4.5).** A feature, or something to hide? And for
   the last pass of a stroke: mark outside the stroke, or back over painted
   lanes?
2. **Axes.** Which axis runs along the long side of the frame, bottom to top
   of the picture: X (as in `RAIL.md`) or Y? Which way is plus?
3. ~~**How the board runs a smooth pass** (section 6)~~ — decided
   2026-09-27, a draft to flash and test together with the owner.
4. ~~**Flat or round brush.**~~ — round, the owner 2026-09-28 (section 4.8).
5. **Manual mode on the Create tab:** is the dry tail intended texture (then no
   refills) or should it refill (then the preview shows fresh paint after each
   refill)?
6. **MOLOTOW hatching** from RUBENS.md — Illustrator SVG, layers, cutting by
   paint budget, "how many tones": still planned or not?
7. **Zero without end stops** — the procedure (from RUBENS.md, still valid).
8. **The bottom strip** — move the canvas, or bend the arm for the bottom
   layer (section 7).

---

## 10. Work order

1. ~~git in `~/Rubens`~~ — done 2026-09-27, public at `github.com/forma78/rubens`.
2. ~~Split `app.js` into modules, comments in English, geometry tests~~ —
   done 2026-09-27 (`rubens-preview/src/`, `rubens-preview/test/`).
3. The screen must not lie: refills show in the preview; "Drops" and CNC Trace
   show the same drops.
4. Bottom-to-top passes, the swing off the canvas, the snake with a semicircle
   (section 4.5) — the plan and CNC Trace done 2026-09-27; the preview lane by
   lane left.
5. The file for the machine as in section 5 — `job.json` from the Job tab
   (mm, execution order, kinds) done 2026-09-27; the SVG export left.
6. ~~Job tab with an on-screen run: the plan plays on screen, percent,
   minutes. The hardware is not touched~~ — first version 2026-09-27.
7. `rubens.py`: the page, the job, the bridge. The brush on screen from the
   ping — serves the pages and passes the axis commands since 2026-09-27
   (Calibration tab); running the job left.
8. Firmware: the smooth pass, `U`.
9. Dry run, the first stroke, calibration from photos.

---

## 11. How to work

The owner is an artist and designer. No jargon; concrete names and numbers,
not "roughly". Catches inaccuracies, typographic ones included. Expands ideas
fast — check that an improvement does not replace the original idea. If you
got something wrong, say so at once.

Since 2026-09-27 Claude is the technical lead: decides technical questions
and announces every decision, never silently. Anything that changes the
picture, the person's workflow or the hardware gets asked first.
