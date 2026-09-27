# Calibration log

Measurements of the machine, newest first. Each entry keeps the date, what
was measured, how, and what it changed. Numbers here are the source for
`rubens-preview/src/machine.js` and for the walls in the machine firmware
(`RAIL-drawing_machine/src/main.cpp`); change them together.

---

## 2026-09-27 — first calibration, with a pencil

**Set-up.** A mechanical pencil in the new spring clamp: the clamp lets the
pencil float left–right and forward–back, so it never stands rigid at 90° and
cannot pierce a sagging canvas (the floor is uneven, the canvas can sag in the
middle). Canvas 60 × 80 cm lying with its long side along the frame, bottom of
the picture at the beam. Arm straight (pendant zero), not moved during the
session. Photos: `images_CNC_drawing_machine/photo_2026-09-27 15.17.41.jpeg`
(the clamp), `photo_2026-09-27 15.17.43.jpeg` (the canvas on the machine).

Measured with the MELNICOMM pendant and, from the afternoon on, the new
Calibration page (`rubens-preview/calibration.html`); positions read with the
ping `P`, which moves nothing.

### Axes

| | X | Y |
|---|---|---|
| runs | along the long side of the frame | across it |
| plus | towards the top of the picture | to the right, looking from the bottom |
| drive | GT2 6 mm, **20-tooth** pulley | GT2 6 mm, **60-tooth** pulley |
| steps per mm | 80 | 3200 / 120 = **26.667** |
| one pendant level | 10 mm/s = 800 steps/s | 10 mm/s = 266.667 steps/s |
| one knock at a stop | 4 full steps = 0.8 mm | 4 full steps = 2.4 mm |

- **Y has a 60-tooth pulley**, not the 20-tooth one the machine's `RAIL.md`
  listed. Until today the firmware and the pendant treated Y like X: the
  pendant showed Y in mm three times too small, and one level drove Y at
  30 mm/s instead of 10. Fixed today in the firmware (speed per axis) and on
  the pendant page (mm per axis).
- **Steps per mm are taken from the construction, not the ruler.** With the
  spring clamp the tip lags behind the carriage (below), so a ruler measures
  the scale plus the lag. Over 533 mm the ruler and the ping differed by
  8.7 mm; that is the lag, twice.

### Stops and walls

The owner's decision: **zero is where the walls are; the reserve up to each
stop is minus** — like the reserve in a fuel tank. Every wall is about 10 mm
off its stop; the board brakes before a wall and stops at it.

| | stop, mm | wall, mm | wall, steps |
|---|---|---|---|
| X bottom | −9.45 | 0.0 | 0 |
| X top | +870 (one knock at the 870 wall, on the right) | +865.0 | +69200 |
| Y left | −8.3 | 0.0 | 0 |
| Y right | about +569.5 — **to confirm** | +568.5 — **to move** | +15160 |

- **X travel between the stops: 870 mm** on the left side. At the top stop
  the ping read 873.0 mm from the bottom stop; three knocks at 0.8 mm = 2.4 mm
  were counted but not travelled, so 870.6; the owner's ear said 870.
- **Y right stop: not settled.** The ping at the right stop read 590.55 mm
  and five knocks were heard; 5 × 2.4 = 12 mm was taken off (578.55). Driving
  back left then knocked at the left wall, which means about 21 mm had been
  lost at the right stop, not 12. So the right stop is probably near 569.5 mm
  and the right wall (568.5) must move to about 559.5. Next session: re-take
  Y at the left stop, find the right stop with one knock only.
- **Top wall moved to 870.0 — the owner's decision** (850.0, then 860.0,
  then 870.0 the same evening). At 850 the carriage stood at 851.0 on the
  right, and the owner saw about 10 cm more to the stop there. On the left the
  stop had been measured at 860.55 (three knocks). Claude advised against
  going past it: the beam is one piece, and if its left end is blocked at
  860.55, a wall at 870 lets the motor push on and may rack the gantry. The
  owner looked at the machine and kept 870. On the next run up, on the right
  (Y 570.4), there was one knock — at the stop or from the acceleration, not
  certain. **Settled: the top stop is 870, the wall 865** — the owner's
  compromise, the fuel-tank reserve of 5 mm. Still to check: the top on the
  left on level 1, since the morning measurement put a stop there at 860.55.
  After that knock the X count may be off by up to 0.8 mm; the next home at
  power-on clears it.
- **Top right: nothing in the way.** The very first X zero was taken at the
  top right, where the carriage seemed to stop 5–6 cm below the top stop on
  the left. Later, with the walls in place, the carriage went up on the right
  (Y 570.4) to the top wall without a knock and stood at X 851.0. So nothing
  is in the way up to there; the early stop in the morning was a count gone
  wrong after knocks, not an obstacle.

### The canvas on the machine (evening)

Recorded on the Calibration tab (`rubens-preview/calibration.json`), paper
format 60 × 80 cm. The tip went to each corner of the canvas; the sides are
past the Y walls, so those corners were recorded at the wall with a ruler
offset (15 mm on each side), the top ones 10 mm below the edge with ↑ 10.

| corner | X, mm | Y, mm |
|---|---|---|
| top left | 827.9 | −16.0 |
| top right | 827.9 | 584.6 |
| bottom right | 26.3 | 584.1 |
| bottom left | 26.3 | −16.0 |

- Size 600.1 × 801.6 mm (nominal 600 × 800), diagonals 1001.3 and 1001.6
  (nominal 1000.0); the four corners fit one straight grid within 0.13 mm.
  The canvas lies square to the axes (0.04°).
- Out of reach: 16.0 mm on the left and 16.1 mm on the right; the full
  height is inside.
- On the way the owner recorded the walls instead of the canvas (866.9 ×
  571.9) and once typed offsets 25 + 20 for what is 15 + 15. Both would have
  stretched a job; the pages now flag any edge more than 1.5 % off the format.
- **The canvas moved once when touched.** Clamp it outside the work area
  before any run: a canvas that moves loses the registration with the
  machine, and layers stop matching (Rubens_v2.md, section 7).
- The Y scale was checked with a pencil line and a ruler: it matches
  26.667 steps per mm.

### The first path run: pencil squares (night)

The pass firmware draft (`RAIL-drawing_machine/drafts/rubens-pass/`) and the
bridge patch were put in; the first path found a bug at once — a piece that
starts past a wall was refused, and a parked carriage always stands a little
past its wall — fixed and flashed again. Then a 50 × 50 mm square at
X 200–250, Y 200–250, at 10 mm/s, four times in the same place.

- **The carriage:** every run 20.0–20.5 s, back at X 200.00 / Y 200.00 to the
  hundredth; sides straight to the hundredth in the counter.
- **On the canvas, by ruler:** about 48 mm along X and 45 mm along Y. The
  scale is right (checked earlier on a long Y line), so the tip lags behind
  the carriage by a few mm: about 2 mm along X, along the arm, where only the
  clamp springs give, and about 5 mm along Y, across the arm, where the
  shoulder and elbow give as well. Photos: `images_CNC_drawing_machine/`
  `photo_2026-09-27 22.19.57.jpeg` (square and ruler), `22.20.01` (the
  holder), `22.20.28` (the pencil leaning in the ring of the clamp).
- **Repeatability:** the first square (after a travel move) and the second
  (after the brush went off and on in the corner) did not coincide; the third
  and the fourth, with the same history as the second, lay on it so exactly
  that the owner did not see the fourth had been drawn. **Same history, same
  line.** In a RUBENS job every pass has the same history (brush off, travel,
  brush on, bottom to top), so the lag is one constant shift, not a wobble.
- **The holder, open:** the pencil leans in a ring much wider than it and
  the side springs let it go sideways. The idea to discuss: soft along the
  pencil (so it cannot pierce a sagging canvas), stiff sideways — a tube the
  pencil slides in, a light spring or a weight on top. The owner's concern:
  a stiff holder would tear the canvas; the answer is that pressure comes
  from the spring along the axis, not from stiffness sideways.

### The first job run: a runaway on Y (late night)

⚡️ Do Job with the owner's drawing. The first travel at 100 mm/s had stopped
near its end with "moveTimed 4" (the motor queue not ready: X ran out of
queued slices); the firmware was changed to retry such a slice instead of
stopping, and the same travel then ran four times cleanly. The first real
pass — diagonal, 54 mm along X and 25 mm along Y, 20 mm/s — went wrong: at
about 8 mm/s along Y the library puts every step into the queue as several
entries, the Y queue ran dry, and a slice that had been added in part was
added again on retry — over and over (1 751 137 retries). The Y count ran to
827.4 mm; the carriage cannot go past about 578, so it drove into the right
stop. The owner stopped it; nothing else moved.

- The squares never showed it: each side ran along one axis only.
- **Runs are off** in `rubens.py` (`RUNS_ENABLED = False`) until the pass
  core is rebuilt and tested in the air.
- The fix: not `moveTimed` with retries, but the library's main mode — every
  20 ms each axis gets a target and a speed, and lays out its own steps,
  slow ones included. Test in the air first: diagonals at several angles and
  speeds, a slow axis, arcs; the pencil only after that.
- **The same night, the pass core made fail-safe.** No slice is ever
  re-sent: any motor queue answer but "taken" is a HARD STOP with its reason
  kept for `V`; the board stops a runaway itself (a count past a wall by
  more than the reserve plus 2 mm); S that has not stopped a path in 1.5 s
  becomes K. In the air: a travel with X almost still (5 mm over 545) ran
  cleanly once the queue was kept at most 24 of its 32 entries (a slow axis
  needs up to 8 entries a slice); the diagonal of the runaway stopped at once
  with "moveTimed Y 4" — safely, no runaway. Found then: FastAccelStepper
  0.31.8 calls `moveTimed()` "initial and untested"; the registry has 1.3.4
  (2026-09-23). **Next:** read what changed up to 1.3.4 and upgrade if
  `moveTimed` is done there, or build the pass on the library's main mode
  (a speed per axis every 20 ms); then the air tests again, then the pencil.
- **Getting the Y count back.** The owner drove Y left through the noise:
  the carriage met the left stop while the count still read about 240 mm, and
  the count ran down to the wall at 0 with the motor slipping. Stopped there
  at −1.16, the carriage stood in the stop, which is −8.3 by the calibration:
  so the count was 7.14 mm high. It was corrected with `origin/y` at the right
  wall (count 569.96 → 562.84 mm), without moving anything. **Checked:** Y
  left to its wall on level 1 stopped at −1.8 with no knock. The canvas did
  not move; the four canvas corners of the evening were put back from git
  (600.1 × 801.6 mm).

### Home — every time after power-on

1. X down to its stop, level 1, stop at the first sound.
2. Y left to its stop, level 1, stop at the first sound.
3. Set home: X = −9.45 mm (`origin/x?at=-756`), Y = −8.3 mm
   (`origin/y?at=-222`). The Calibration page does both with "Set home…".

### Lessons

- **A knock means the count is wrong.** When the carriage is blocked the
  motor slips but the board keeps counting. Knocks are not all the same size
  and counting them by ear is unreliable (Y: heard five, lost about nine).
  Stop at the first knock; after any knock, take the zero again.
- **Walls must come with their zero.** A wall is a fixed number of steps from
  zero: moving the zero without moving the walls puts a wall in the wrong
  place (once 0.6 mm from a stop). Every change of zero today went together
  with a firmware change of the walls.
- **The tip lags behind the carriage** by a few mm in the direction of travel
  (spring clamp, servo backlash, arm flex). Passes painted in opposite
  directions — the snake — land apart by twice the lag; with the brush off the
  canvas after every pass, all passes go one way and the lag is one constant
  shift. To measure: approach one mark from both sides.
- **The pencil catches the canvas edge.** The canvas on its stretcher is
  thick; driving the pencil off the edge and back can block the carriage. Lift
  the pencil with the wrist (J3) before leaving the canvas.
- Servo bus 11.1–11.2 V with both motors holding (the machine's README gives
  11.5 V as the baseline). Watch it.

### Firmware changes today (`RAIL-drawing_machine/src/main.cpp`)

The machine folder is not under git; the files as they were in the morning
are backed up outside it.

- Speed per axis: `LEVEL_MHZ = { 800000, 266667 }` — one level is 10 mm/s on
  both axes.
- Walls: `WALL_MIN = { 0, 0 }`, `WALL_MAX = { +69200, +15160 }` (the top X wall that evening went 850.0 → 860.0 → 870.0 → 865.0).
- The pendant page (`web/index.html`): `STEPS_PER_MM = { x: 80, y: 26.667 }`.
