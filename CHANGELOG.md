# Changelog

RUBENS, the software for CNCDM-001, the Motor Brush drawing machine.
Newest first. Machine measurements are in [`CALIBRATION.md`](CALIBRATION.md).

## Unreleased

- **The wrist's zero is the brush upright.** It was 9.4° off since
  2026-09-28. The camera's limit, +10°, is counted from upright; brush off
  is the same pose as before, and now reads −54°. The Calibration tab no
  longer saves the arm zero it loaded along with the canvas corners.
- **Library**, a fourth tab after Job: every drawing saved with **💾 SAVE**
  on the Create tab, newest first, with its painted preview, format and
  strokes. SAVE (where "Editing · New stroke" was) makes a new drawing each
  time, named by the date and time — "2026-09-30 01:15", "(2)" for a second
  one in the same minute — and never writes over an older one. A click opens
  a drawing on the Create tab, ready for the Job tab; the red × moves it to
  `library/.deleted/` after asking. The drawings stay on this Mac, not in
  git.

---

## Update 30-09-2026 · v0.1.3

The first paintings, and what they taught: the brush now stays on the
canvas from the first trip of a stroke to the last, the arm reaches the
edges of the 70 cm canvas, and everything for the machine lives in this one
repository. A USB camera on the brush holder sets a new limit to the wrist.

### Painting (Job tab)

- **The brush no longer leaves the canvas in the middle of a stroke.** The
  first paintings showed every lift: the wrist swings the wet brush off and
  on like a broom and leaves a sideways mark. In Brush mode all trips of a
  stroke are one line, whatever "Brush off after each pass" says (that
  toggle is Pencil's and greys out in Brush); the brush leaves the canvas
  only between strokes, at the start and the end of a job, and on Pause.
- **2, 4 or 8 trips a lane**, 4 by default: up, down, up, down, spread
  evenly across the lane — 16, 32 or 64 trips a stroke; on a 500 pt stroke
  11, 5.5 or 2.75 mm apart.
- **A straight step, no semicircle.** A trip ends, the brush steps straight
  across to the next one and comes straight back: a round brush with long
  enough bristles needs no turn. Pencil's snake keeps its semicircles.
- **At a wall the brush runs along it.** Where a stroke goes past the
  machine's reach, the brush stays down and runs along the wall until the
  stroke comes back. Before, the pass was cut there and the brush went off
  and on — the marks on the painting of 2026-09-29.
- **The plan shows the canvas and the walls**: the 60 × 80 cm edge dashed,
  its corners named TL, TR, BR, BL as on the Calibration tab; the walls
  dotted once the canvas is placed.
- **Pass speed ×1 / ×2 / ×4 / ×10** (20, 40, 80, 200 mm/s), so the paint
  does not dry before the brush is back. Tight arcs are slowed to
  √(250 mm/s² · r): the board limits the acceleration along the path, not
  across it.
- **The percent moves through a stroke.** A Brush stroke is one block of
  hundreds of pieces; the runner used to count what was painted only once it
  had sent them all. It now counts from the board's queue all along.
- **A job ends at home**, like a 3D printer: the brush off, the carriage in
  the bottom left corner inside the walls.

### Create tab

- **Stroke in mm, up to 800 pt.** Stroke shows whole mm of one lane — 1 to
  35 mm; the field, the slider and ± step a millimetre; below, the trace of
  eight lanes in whole mm. A mm | pt switch brings the pt back. The limit is
  800 pt (282 mm), up from 500.
- **Round 10 mm**, the brush on the machine (a Raphael No. 4), is the
  default for new strokes. Its 10 mm and texture are a guess until paint
  photos are measured.
- "Match brush" is offered only when the stroke it asks for fits the limit.

### Machine and safety

- **The wrist never goes past +10°.** A USB camera sits on the brush
  holder, on the wrist's plus side. The brush leaves the canvas at −45°
  instead of +90°; RUBENS refuses any wrist move past +10° — from the
  Calibration tab, Brush off, Pause or a job — and a job.json saved before
  does not start: save it again.
- **Arm jog** on the Calibration tab: shoulder, elbow, wrist. The arm moves
  in RUBENS's degrees from its working pose, from where the servos really
  are, whatever zero the board took at power-on; a restart can no longer
  swing the brush to 180°. **Plus is the brush to the right** for the
  shoulder too, as for the elbow.
- **One program, one address.** `rubens.py` talks to the board on USB
  itself; the bridge on port 8765 and its MELNICOMM pendant are gone.
- **Rams look.** Neutral grey keys; the chosen one pressed and marked with
  an orange dot; "• STOP", "•• HARD STOP". The Job tab's progress is a grey
  LCD: the percent in seven segments, the time left and the total, a bar of
  sticks.

### Repository

- **The firmware is here**, `firmware/CNCDM-001/`, with a README on the
  board, pins, drivers, power and serial commands. Its comments are in
  English now; built here it gives the same image as the one on the board.
- Photos: the boards and motors, the paintings of 2026-09-29, the camera.
- The machine's first repository, `forma78/CNCDM-001`, is archived.

### Calibration log

- The paintings of 2026-09-29: the brush's marks at the walls and between
  lanes, where it went off and on.
- The arm turned brings the tip to the canvas edges: shoulder +15.5°, elbow
  +14.9° to the right, −14.7° and −14.9° to the left.
- The camera, and the wrist's new brush-off pose, −45°.

### Next

- The arm's side poses in a job: one pose a stroke, their shift measured
  with a pencil mark — so the whole 70 cm is painted.
- The arm zero in the firmware, Turn on / Turn off, and the wrist's +10° in
  the firmware too — one flash, together with the owner.

---

## Update 28-09-2026 · v0.1.2

The first day of work on the machine rather than on its screws: the first
pencil job ran through, and the software learned what the machine needs
before paint.

### Job tab

- **Pencil / Brush.** In Brush mode every lane is painted there and back
  without leaving the canvas: up a quarter of the lane to one side of its
  centre line, a semicircle at the top, down a quarter to the other side. The
  brush trace is narrower than a lane, so the two trips split it. Between
  lanes the Create tab's "Brush off after each pass" still decides: the brush
  leaves the canvas, or the whole stroke is one line. Pencil is one trip per
  lane, as before.
- **❚❚ Pause / ▶ Continue.** On a pass the machine brakes on its line, the
  brush leaves the canvas and the machine waits — to sharpen a pencil or
  squeeze paint. Continue brings the brush back to the same point and goes on
  from there: nothing is skipped or drawn twice. Space pauses; only a click
  continues. STOP and HARD STOP work while paused. Tested on the machine
  with a pencil the same evening.
- **The progress is the machine's.** While a job runs, the big percent, the
  bar and the marker on the plan follow the machine. The on-screen play,
  its scrub and its speeds are gone.

### Safety

- **The carriage must arrive.** After every travel and every pass the runner
  checks that the carriage stands where the block ends, within 1 mm; if not,
  it sends HARD STOP and says where the carriage is. The brush never goes
  down in the wrong place. (A motor that stopped taking the path had let
  three passes run along one axis only.)
- **A stop from any tab ends the job.** STOP and HARD STOP on the
  Calibration tab used to stop the motors but not the job.
- **The runaway line is the board's own**, 12 mm past a wall. Home lies in
  the reserve past the walls and was taken for a runaway.
- Messages from the board reach the Job tab in English.

### Machine

- **The carriage place survives the power-off** (server side): Turn off saves
  where the carriage stands, Turn on puts it back once — no drive to the
  stops. The buttons come with the arm zero below.
- The Calibration tab says how to find home after power-on.
- The machine is named **CNCDM-001**; its firmware and bridge live in a
  private repository of that name, so a second machine gets its own.

### Calibration log

- The first pencil job: eight passes, 15.8 m, through on the first try.
- The canvas is 100 × 70 cm; the 60 × 80 cm "canvas" of the calibration is a
  frame drawn on it in blue pencil.
- The wrist (J3) took its zero from the brush-off pose after the night: why,
  how it was put right, and the raw servo poses to keep.
- The brush is round: a Raphael No. 4.

### Repository

- MIT License for the code and the documents. The photos and drawings stay
  © Theo Sumkin, all rights reserved.

### Next

- The arm zero as calibration read from the servos, one firmware command to
  take it, and **Turn on / Turn off** buttons.
- The first strokes in paint.

---

## 27-09-2026 · v0.1

The first version: the Create tab (lines and arcs, eight lanes, the paint
preview, SVG export), the Calibration tab (the machine from above, jog, home,
the canvas corners) and the Job tab (the plan, `job.json`, ⚡️ Do Job through
`rubens.py`). The first calibration of the machine with a pencil.
