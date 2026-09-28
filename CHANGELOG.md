# Changelog

RUBENS, the software for CNCDM-001, the Motor Brush drawing machine.
Newest first. Machine measurements are in [`CALIBRATION.md`](CALIBRATION.md).

---

## Unreleased

- **Rams look.** Neutral grey keys; the chosen one is pressed and marked with
  an orange dot; "• STOP", "•• HARD STOP". The Job tab's progress is a grey
  LCD in a niche: the percent in two seven-segment cells (the tens faint
  below 10 %, a third cell only at 100), the time left and the total, a bar
  of sticks. The Create tab's Stroke section keeps its look.
- **Arm jog** on the Calibration tab: shoulder, elbow, wrist, as on the
  MELNICOMM pendant. The arm always moves in RUBENS's degrees from its
  working pose (calibration.json), from where the servos really are —
  whatever zero the board took at power-on — and the whole arm holds from
  a job's start. The brush can no longer be swung to 180° by a restart.
- **Brush: 2 or 4 trips a lane** on the Job tab, 4 by default: up, down, up,
  down, a quarter lane apart — 32 trips, 5.5 mm apart on a 500 pt stroke.
  The first canvas had 2 trips 11 mm apart and the round No. 4 left canvas
  between them. The 2.8 mm turns run at 26 mm/s whatever the pass speed.
- **Pass speed ×1 / ×2 / ×4 / ×10** on the Job tab (20, 40, 80, 200 mm/s),
  so the paint does not dry before the brush is back. Tight arcs are slowed
  to √(250 mm/s² · r) — the 5.5 mm turns of Brush run at 37 mm/s — because
  the board limits the acceleration along the path, not across it. After a
  pause a pass keeps its slow turns.
- **Round 10 mm** on the Create tab, the brush on the machine (a Raphael
  No. 4), and the default for new strokes. Its 10 mm and its texture are a
  guess until the first paint photos. The brush note counts 16 trips when
  the Job tab is on Brush.
- **A job ends at home**, like a 3D printer: after the last pass the brush
  swings off and the carriage travels to the bottom left corner inside the
  walls (X 0.1, Y 0.1 mm), not left over the middle of the canvas.

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
