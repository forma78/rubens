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
| X top (measured on the left) | +860.55 | +850.0 | +68000 |
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
- **Top right, to check.** The very first X zero was taken at the top right,
  where the carriage stopped 5–6 cm below the top stop on the left. Either
  something is in the way there (a bracket, the motor, a cable) or the count
  was off. Measure the top stop on the right once the walls are settled.

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
- Walls: `WALL_MIN = { 0, 0 }`, `WALL_MAX = { +68000, +15160 }`.
- The pendant page (`web/index.html`): `STEPS_PER_MM = { x: 80, y: 26.667 }`.
