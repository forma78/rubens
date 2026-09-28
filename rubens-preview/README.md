# RUBENS · Brush Preview v0.1.2

A prototype that previews brush strokes for Motor Brush. Draw a path, pick
eight drops of paint, see what you will get, export an SVG. Three tabs:

- **Create** — draw and preview (called Paint until 2026-09-27). Does not
  touch the hardware. **🖨 Open Job** opens the Job tab.
- **Calibration** — the machine from above, live; jog the axes, set home,
  record where the canvas lies. Drives the axes through the machine bridge.
- **Job** — the drawing as the machine will run it, played on screen with
  percent and minutes; writes `job.json`. **⚡️ Do Job** runs it on the
  machine through `rubens.py` — once the pass firmware is flashed.

The design is a draft.

Decisions and the work plan are in **`HANDOFF.md`**; the spec for the whole
of RUBENS is **`../Rubens_v2.md`**.

## Run

```
cd ~/Rubens/rubens-preview
python3 rubens.py
```

Open http://localhost:8766, or double-click `start.command`. `rubens.py`
serves the pages and passes a short list of machine commands to the bridge
(`RAIL-drawing_machine/bridge.py`, port 8765): the ping, the look, the axes
and the axis zero — not the arm. Calibration needs the bridge running; Paint
and Job work without it. The pages must be served over http: the code is ES
modules, and browsers do not load them from `file://`.

## Tests

```
cd ~/Rubens/rubens-preview
node --test
python3 -m unittest discover -s test -p '*_test.py'
```

No packages to install. Tested with Node 25 and Python 3.14. The Python
tests run the job runner of `rubens.py` against a fake board: no bridge, no
machine.

## Default drawing

On first open (or with the "house" button on the left) the app loads
`default.svg` from this folder. To make it yours: draw, Export SVG, save the
file here as `default.svg`. No file — the built-in demo opens. The current
drawing is kept in the browser between reloads anyway.

## Files

| file | what |
|---|---|
| `index.html` | the Create tab, English UI |
| `calibration.html` | the Calibration tab |
| `job.html` | the Job tab |
| `rubens.py` | the server on 8766: pages, machine commands to the bridge, `calibration.json` and `job.json` |
| `calibration.json` | where the canvas lies on the machine, written by the Calibration tab |
| `job.json` | the job in mm, in the order it runs, written by the Job tab (not in git) |
| `style.css` | Braun style, `#EDEAE4` / `#EB7A25`, as MELNICOMM |
| `src/` | the code as ES modules, no libraries, no build step — see `HANDOFF.md`, section 4 |
| `test/` | tests for the geometry, paint math, CNC plan, the job and its clock, the machine model, SVG files |
| `package.json` | only tells Node that `.js` files are modules, for the tests |

## Units

The document is in pt, **1:1 scale with the canvas**: 1 pt = 25.4/72 =
0.35278 mm. A 60 × 80 cm artboard is 1700.8 × 2267.7 pt. Stroke 1–500 pt;
500 pt = 176.4 mm.

Stroke sets the trace width in the preview and in the paint math.
The brush (Flat 8 / Flat 12) only sets the texture for now: bristle density
and small gaps between lanes. If the stroke is far from the real brush width,
the panel says so and offers "Match brush".

## Drawing

- **Gesture (G).** Press and drag slowly. Hold the mouse still for 0.35 s and
  the piece straightens: a line (angle snapped to 15°) or an arc (sweep
  snapped to 45°, so clean 90° and 180°). The next arc continues the previous
  segment tangentially. Release — the stroke is done. Shift — line only,
  Alt — arc only.
- **Pen (P).** Click — a point, straight segments. `A` or Alt-click — a
  tangent arc. Enter / double-click — finish.
- **Select (V).** Click — select a stroke and edit its settings; drag — move it.

The path is stored as lines and arcs only. No Béziers anywhere.

### Editing anchors

A selected stroke shows its anchors as white squares. Works in any tool.

- Click a square — it turns blue; drag — the point moves.
- Shift-click adds or removes points. Drag any selected one — the whole group
  moves. A segment between two selected points moves as a whole, keeping its
  shape.
- Arrow keys move selected points by 1 mm, with Shift by 10 mm.
- Esc or a click elsewhere clears the point selection.

A line simply follows its point. An arc keeps its sweep: a semicircle stays a
semicircle, only its radius and rotation change. Tangency with the neighbour
may break — at that joint the brush turns on the spot. With Snap on, the
point snaps to a 10 mm grid.

## CNC Trace

The **CNC Trace** button (key `C`) shows how the machine will actually move.
The line on screen is not one pass but eight: the 12 mm brush goes eight
times, shifted each time. Pass i runs parallel to the centre line at
`((i + 0.5) / 8 − 0.5) × trace width`; the pitch between passes is
stroke / 8. Pass 1 is the left edge looking along the drawing direction.

For passes to lie edge to edge, stroke must be 8 × brush width: 96 mm =
272 pt for 12 mm, 64 mm = 181 pt for 8 mm. The Brush panel says whether there
are gaps or overlaps and offers a button to match.

**Corners.** The centre line (your Path) is the motors' path; all passes are
measured from it, four on one side, four on the other. Every kink of the
centre line is rounded with an arc of radius `W/2 + Inner corner radius`
(10 mm by default, a field in the Brush panel). All eight passes are then
parallel copies of the rounded centre line: lines stay lines, corners become
concentric arcs. The inner edge of the trace goes round the corner at a 10 mm
radius, the outer edge at W + 10 mm. Nothing crosses anywhere. The paint
preview uses the same rounded centre line — what is on screen is what goes on
the canvas. Your anchors stay sharp; the rounding is computed on top.

If a corner is too tight to fit the rounding (short segments on either side)
or an arc of the drawing is smaller than W/2, CNC Trace shows a red "!" there
and the panel shows a warning. Fix: open the corner, lengthen the segments or
make the line thinner.

CNC Trace shows the centre line dashed. It paints nothing — there is no ninth
drop.

The circles on the passes are where to squeeze paint. A big numbered one is
the start of a pass, small ones are refills along the way. Their number is
paint per pass / Max drop (1 ml per drop by default); refills are spread
evenly along the pass. In Manual mode — a drop of the given volume, a refill
every time it runs out. The "CNC passes" table gives length, drop count and ml
for every pass of the selected stroke.

**Export CNC** writes a separate SVG for the machine:

- All lines are black, 1 mm — a pencil path. The pass colour is reference
  only, in `data-color`.
- group `passes` — passes in order: stroke by stroke, 1 → 8 within a stroke,
  all in the drawing direction. Exact `M`, `L`, `A`: lines and arcs, no
  polylines. Each has `data-lane`, `data-color`, `data-length-mm`,
  `data-drops`, `data-drop-ml`. An empty palette slot means no pass.
- group `drop-marks` — Ø 6 mm circles at the drop points, each with
  `data-ml`. This is for a pencil run: the machine marks the canvas first, you
  squeeze paint at the marks, then mount the brush.

The order "pencil → paint → brush" and a pencil run over the `passes`
themselves are chosen in RUBENS: the file carries both groups. This export is
v0.1; the new contract is in `../Rubens_v2.md`, section 5.

## Paint model

Eight drops across the brush; lane 1 is the left edge looking along the
travel direction. Neighbouring lanes mix at their border (Mix); the mixing is
"pigment-like": a geometric mean in linear RGB, so yellow and blue give a
greenish colour, not grey.

Per drop:

```
ml = path length (mm) × lane width (mm) × film (mm) × (1 + kept in brush) / 1000
```

The 0.3 mm film and 25 % kept in the brush are **assumptions, not
measurements.** The first test must calibrate them (`../Rubens_v2.md`,
section 8): squeeze a known volume, paint, measure the length of the clean
trace, fit "Film".

In Manual mode you set ml per drop, and the preview shows where the brush
runs dry (the dry tail).

## SVG

- `width`/`height` in mm, `viewBox` in pt.
- One `<g>` per stroke, one `<path>` inside, made of `M`, `L`, `A` only.
  Arcs over 180° are split in two.
- The group's `data-*`: palette, eight HEX colours, brush, mix, ml per drop,
  length.
- `<metadata id="rubens-state">` holds the full state: the app's own file
  opens back exactly. A foreign SVG (Illustrator) is broken into short
  straight lines.

## Later

- Breaking the line: brush off the canvas (`U 1`), travel, brush back — within
  one load of paint.
- Brush width as a physical parameter, not only a texture.
- Stroke order and time estimate (`../Rubens_v2.md`, sections 3 and 4.5).
