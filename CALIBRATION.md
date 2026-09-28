# Calibration log

Measurements of the machine, newest first. Each entry keeps the date, what
was measured, how, and what it changed. Numbers here are the source for
`rubens-preview/src/machine.js` and for the walls in the machine firmware
(`RAIL-drawing_machine/src/main.cpp`); change them together.

**Machine: CNCDM-001.** Its firmware, bridge and docs are in
`~/RAIL-drawing_machine`, under git since 2026-09-28 and private on GitHub as
`forma78/CNCDM-001`. A second machine gets its own name and its own log.

---

## 2026-09-28 — first paint

### Set-up

- **Brush: round** — the owner's decision (Rubens_v2.md, section 4.8). Raphael,
  No. 4; printed on the handle, as the owner read it: "804 kaerell (s) 304. 4".
  Diameter about 10 mm — to confirm whether that is the hair or the ferrule.
  The real trace width is measured on the canvas.
- **Holder:** the same spring clamp as for the pencil. The owner: the springs
  "wander like drunk sailors on a deck" — the tip floats sideways too freely.
  Watch what that does to repeatability with the brush.
- **The canvas is 100 × 70 cm, not 60 × 80.** The owner laid a 1000 × 700 mm
  canvas and drew a 600 × 800 mm frame on it with a blue pencil, on purpose:
  during the tests the pencil and the pen roll over canvas everywhere in the
  work area and never drop off an edge. The canvas corners recorded on
  2026-09-27 are the corners of that frame. It has not moved; no new
  calibration.

### The arm after the first night (morning)

- **J3 took the wrong zero.** The firmware takes each joint's zero from the
  pose it stands in at the first command after power-on. The job of the night
  ended with the brush off (+90°) and the wrist stood so all night, so this
  morning +90° became 0: "Brush off" swung the pencil to +180°. The servos
  read their pose after a power-off (an absolute sensor, 4096 per turn,
  1024 = 90°): J3 read 2513, so the zero of the evening was 1489.
- **Fixed without flashing:** J3 −90 brought the pencil to 1490 (the real
  0°, on the canvas); the board was then reset over the serial line (RTS, as
  the flasher does), which also cleared a home set at the wrong stop; the
  first J3 command after the reset took the zero at 1490; +90° is 2513.
- **Raw poses to keep:** J3 on the canvas (0°) **1489**, off (+90°) **2513**.
  Shoulder (J1) **2501** and elbow (J2) **1759** as they stood overnight after
  the pencil job.
- **Shoulder and elbow do not hold until they get a command.** After the
  reset only J3 was commanded; the shoulder drifted 2501 → 2492 during a
  wrist swing and to about 2500 during homing. Held with J1 −5 and J2 −5
  (with the +5° offset that is "hold where you are"): 2499 and 1757. On the
  way J1 once went to 2511, a degree off: the command was worked out from a
  reading taken before homing had moved the shoulder again. Read the pose
  right before any arm command.
- **To do, firmware, with the owner:** the three zeros as fixed raw numbers
  instead of "the pose at the first command", and the shoulder and elbow
  holding from power-on.
- The home of the morning was first set with X at the wrong stop (the X
  slider moved right, which is up, instead of left, which is down to the
  beam); after the reset it was set again at the right stops.

### The pencil job again: two runner faults (evening)

- **A false runaway at home.** ⚡️ Do Job from home stopped at once with
  "runaway: X at −9.4 mm": the runner's line was 5 mm past a wall, and home
  lies 9.45 / 8.3 mm past the walls, at the stops. It sent a HARD STOP;
  nothing moved. The line is now the board's own, 12 mm (the reserve plus
  2 mm).
- **X stuck after that HARD STOP**, as known since 2026-09-27. On the next
  run the X count never left −9.45; Y ran to 569.5 mm (15186 steps, at the
  right wall, **no knock** — the owner). The board stopped each path itself
  (3 faults, "такт не берётся", 34 968 retries); the runner took each stop
  for the end of a block, lowered the pencil and ran on along Y only, until
  an arc started from the wrong place and ran past a wall ("край A"). Pencil
  lines near the bottom edge, at X ≈ −9.45. Now every move block must end
  within 1 mm of where it should, or the runner sends a HARD STOP and says
  so — before the brush can go down.
- The board was reset over the serial line with J3 on the canvas (1487), so
  its zero came back right; +90° reads 2509. The shoulder drifted again
  while the wrist swung (2499 → 2494) and holds at 2494, 0.4° off the pose
  of the night; the elbow holds at 1757.
- **The pencil job ran through again** after the fixes: 53 blocks, 15.8 m,
  done, 0 faults.
- **Pause works on the machine** — the owner tested it with the pencil the
  same evening (brake on the line, pencil off, back on, the line goes on).
- **Next: the brush.** The round Raphael No. 4 in the same clamp, the job in
  Brush mode (every lane there and back).

### The first canvas in paint (late evening)

"Это наш первый холст!" — the owner and his wife. Photos
`images_CNC_drawing_machine/photo_2026-09-28 22.08.30.jpeg` and
`22.08.33.jpeg` (at an angle, no ruler).

- **The job:** the stroke of the pencil job, Brush mode, 500 pt (176.4 mm,
  lanes 22.05 mm), brush off between lanes, **40 mm/s (×2)**. From
  `job.json`: all 16 trips lie **11.02 mm** apart (stroke / 16), the turns
  have a radius of 5.51 mm — the plan is as designed.
- **Canvas shows between every two trips.** The paint trace of the round
  No. 4 is narrower than the 11 mm between trips. By the proportion of paint
  to gap in the photos, roughly 6–7 mm — **an estimate, to measure with a
  ruler**. The "about 10 mm" of the brush was not its trace. The pencil
  lines of the pencil job (the lane centres) show in the gap between a lane's
  two trips, which lie 5.5 mm to each side of them: the geometry is where it
  should be.
- **Paint lies in ridges** where the drops were: thick yellow and red stay
  as raised lines and blobs the brush pushed along instead of spreading.
- The owner, before this run: ×1 (20 mm/s) is too slow, the paint dries;
  asked for ×4.
- Afterwards a new run was stopped at block 2 of 110 with the brush on the
  canvas, at X 0.1, Y 549.2.
- **The brush swung to 180° (late).** The board had been restarted with the
  wrist at +90° and took its zero there; the next job's "brush off" sent it to
  raw 3535 (179.8° from the working pose) and nearly broke the brush. The
  shoulder, never commanded since the restart, did not hold and was dragged
  to raw 1742 (66.7° off), the elbow to 1678 (7.1°). Carriage at X −1.05,
  Y −8.3. From here RUBENS moves the arm only in its own degrees from the
  working pose (rubens.py, class Arm): it reads where a joint is, sets the
  board's zero there and sends the difference — the board's zero no longer
  matters. The Calibration tab has the three handles for it.
- **A new working pose of the arm (just before midnight).** The owner set the
  arm to the middle of the field with the new handles: **shoulder 2498,
  elbow 2039, wrist 1492** (raw, 4096 a turn) — the elbow 24.6° from the pose
  of the evening before (2501 · 1759 · 1489), shoulder and wrist within
  0.3°. Kept in `rubens-preview/calibration.json` "arm" (dated), not in the
  firmware: RUBENS moves the arm from where the servos really are, so the
  arm comes back to this pose after any power-on. **The canvas corners were
  recorded with the old pose:** with the elbow turned, the tip stands
  elsewhere relative to the carriage — record the corners again before the
  next job.
- **The owner's answers:** a thicker brush is out; the trips go closer —
  **4 trips a lane**, 5.5 mm apart on a 500 pt stroke, 32 trips in all. The
  paint: made liquid, it now stays wet for about 12 hours.

### The first job with 4 trips: X stalled and lost 200 mm going up (midnight)

Photos `images_CNC_drawing_machine/photo_2026-09-28 23.33.36 brush.jpeg`,
the same with the return marked in green by the owner (`… brush 2.jpeg`), the
pencil under it (`23.33.33`, `23.33.35`, `23.33.37 pencil.jpeg`), and the Job
tab at the stop (`Screenshot 2026-09-28 Rubens.png`).

- **The job:** the same stroke, Brush mode, 4 trips a lane, brush off between
  lanes, **40 mm/s (×2)**, `job.json` of 23:29. The canvas had been painted
  over (white into pink) and the pencil job run on it; then only Pencil was
  switched to Brush. The owner stopped it during lane 1 (block 3 of 46), on
  its second trip.
- **What the canvas shows.** Trip 1 (up, from the bottom right) lies near the
  pencil to about the point of the teardrop; above it the trace is squashed:
  the big arc at the top right (radius 233 mm, 193.6 mm up) came out as a
  small corner and the top line lies low. Trip 2 (the return, down) is the
  exact shape of the lane, all of it **200 mm too low** — the owner, with a
  ruler.
- **The X motor crackled** on the climb (the owner). It stalled on that arc
  and caught up only as the arc turned towards level and its X speed fell
  (40 mm/s at the start of the arc, 16 mm/s at its end); Y ran on, so the arc
  was painted as a corner. The arc climbs 193.6 mm — the 200 mm lost.
- **The plan was right.** All 46 blocks replayed as the firmware reads arcs
  (`path.h`, radius from the start): every arc ends within 0.3 mm of the job,
  no sweep over 180.2°.
- **The board sent every step.** V after the stop: "пусто 0, повторов 12,
  сбоев 0". Ping: X 19757 (246.96 mm), Y 13582 (509.3 mm) — on the return,
  where the dot on the Job tab stood; the carriage stood 200 mm lower, at the
  bottom of the drawing. The count cannot see a stall, so neither can the
  runner's check that the carriage arrived. X also reported "край" at
  247 mm, probably left from an earlier jog — to check.
- **Unlike the first canvas** (the same stroke, also ×2, geometry right):
  4 trips instead of 2; the new arm pose of 23:05 with all three joints
  holding from the job's start (rubens.py was restarted at 23:05:53 with
  that); liquid paint. Not known yet: the speed and the arm pose of the
  pencil job on this canvas. So ×2 going up is at X's edge, not clearly past
  it.
- **After the stop** the X count is 200 mm high: the walls stand 200 mm too
  low for the carriage. Home again before anything moves.
- **The count at the stop.** The owner drove X down to its stop and Y left:
  the Calibration tab read **X 152.1 mm** at the stop (it should be −9.45),
  **Y −0.8 mm, at the left wall** (not at the stop). So the X count was
  **161.6 mm high**: no knock at the stop (the owner), so that is the stall.
  X was then set to −9.45 at the stop (`origin/x?at=-756`); the owner
  brought Y to its stop and set home, both axes. The ruler said 200 mm between the return and the pencil. The rest, about
  38 mm, may be the new arm pose: in the photo the brush lies about 4 cm
  below the pencil already before the stall, at the point of the teardrop —
  if the pencil job ran with the pose before 23:05 (asked), the tip now
  stands that much lower relative to the carriage.
- **Next:** measure X's margin going up instead of guessing a speed. Jog X up
  from the bottom at level 2, 3, 4, 5 (20–50 mm/s; a jog has the same
  250 mm/s² as a pass), brush on the canvas and brush off, and listen for the
  crackle; after each, X down to its stop at level 1 and read the count at
  the first knock (loss = count + 9.45 mm). The speed going up follows from
  that.

---

## 2026-09-27 — first calibration, with a pencil

**Set-up.** A mechanical pencil in the new spring clamp: the clamp lets the
pencil float left–right and forward–back, so it never stands rigid at 90° and
cannot pierce a sagging canvas (the floor is uneven, the canvas can sag in the
middle). Canvas 60 × 80 cm lying with its long side along the frame, bottom of
the picture at the beam. *(Correction 2026-09-28: the canvas is 100 × 70 cm
with a 60 × 80 cm frame drawn on it in blue pencil; the "canvas" below is that
frame.)* Arm straight (pendant zero), not moved during the
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
- **FastAccelStepper 1.3.4, the same night.** Its changelog: since 1.2.8
  `moveTimed()` appends a slice atomically (all or nothing, #370), since
  1.3.0 the MCPWM/PCNT step count after a direction change is right. The
  firmware was moved to 1.3.4 (pinned exactly, MCPWM/PCNT chosen by name);
  "busy", "not ready" and "direction-change pause" now retry the same slice
  — safe, since nothing was added — and a slice not taken for 100 ms is a
  HARD STOP. The stop inside a piece was fixed (S had cut only whole pieces
  after the current one, so on a long line it did not brake; and when the
  stop fell on a piece end the plan reported the old end of the queue — a
  host test caught that before the machine did). **Air test, all clean:**
  the runaway diagonal (3.17 s, on target), shallow lines with one axis
  nearly still at 10, 20 and 50 mm/s, a semicircle, S on a long line
  (braked in 0.23 s on the line), a path right after S, a jog. Every path
  ended on its target to the hundredth; faults 0. Runs on again.
- **Known:** after a HARD STOP during a path the X driver of this library
  may stay "not ready" and the next path stops at once ("такт не берётся");
  a board restart clears it. Once, before this was known, the brush was
  lowered after a travel that had not happened: a pencil dot at X 438,
  Y 320. Scripts now check the carriage arrived before the brush goes down.
- **Getting the Y count back.** The owner drove Y left through the noise:
  the carriage met the left stop while the count still read about 240 mm, and
  the count ran down to the wall at 0 with the motor slipping. Stopped there
  at −1.16, the carriage stood in the stop, which is −8.3 by the calibration:
  so the count was 7.14 mm high. It was corrected with `origin/y` at the right
  wall (count 569.96 → 562.84 mm), without moving anything. **Checked:** Y
  left to its wall on level 1 stopped at −1.8 with no knock. The canvas did
  not move; the four canvas corners of the evening were put back from git
  (600.1 × 801.6 mm).

### The first pencil job (just before midnight)

⚡️ Do Job with the pencil, right after the air tests on FastAccelStepper
1.3.4. The owner, the next morning: it ran through on the first try, the
pencil followed the line, nothing strange — "everything came out wonderfully".
No photos.

The job, from `rubens-preview/job.json` as the Job tab wrote it at 23:22 (the
owner confirms it is the one that ran): one stroke of eight passes 22.05 mm
apart (500 pt wide, the widest), 2324 … 1998 mm
each, the brush off and a travel back after every pass; 15.8 m drawn and
5.9 m of travel, 1.5 m cut at the walls; passes at 20 mm/s, travel at
100 mm/s — about 13 min of drawing by the plan. The real time was not
noted; "about 13 minutes, probably", from memory.

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

The machine folder was not under git then (it is since 2026-09-28, `forma78/CNCDM-001`); the files as they were in the morning
are backed up outside it.

- Speed per axis: `LEVEL_MHZ = { 800000, 266667 }` — one level is 10 mm/s on
  both axes.
- Walls: `WALL_MIN = { 0, 0 }`, `WALL_MAX = { +69200, +15160 }` (the top X wall that evening went 850.0 → 860.0 → 870.0 → 865.0).
- The pendant page (`web/index.html`): `STEPS_PER_MM = { x: 80, y: 26.667 }`.
