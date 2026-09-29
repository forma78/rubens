# CNCDM-001 — the board, its firmware and its wiring

CNCDM-001 is the Motor Brush drawing machine RUBENS runs: a carriage on two
stepper axes, X and Y, and on it a three-joint arm of serial bus servos that
holds the brush. This folder is the firmware of its board and what is known
about the hardware. It moved here on 2026-09-29 from the machine's own
repository, `forma78/CNCDM-001` (archived, read-only): its history, the
first "broom" plans and the old MELNICOMM pendant are there.

Machine measurements — stops, walls, pulleys, the canvas, the arm poses —
are in [`../../CALIBRATION.md`](../../CALIBRATION.md). RUBENS talks to this
board on USB from `../../rubens-preview/rubens.py`.

---

## The firmware

| file | what |
|---|---|
| `src/main.cpp` | axes, walls, the watchdog, the arm, the serial commands |
| `src/path.h` | the path planner: pieces of path (lines, arcs, travel), a 20 ms tick |
| `lib/SCServo/` | Feetech's servo library ([NOTICE](lib/SCServo/NOTICE.md)) |
| `test_host/path_test.cpp` | the planner's test, on the Mac, no board |

This is the firmware on the board since 2026-09-27. Built from this folder
on 2026-09-30, its comments translated into English, it gives the same image
as the build in the old repository: only the ELF's hash in the header and
the image checksum differ (they hold the build paths); the code with the
comments taken out is the same, line for line.

Its replies stay Russian, as it was written, and RUBENS reads them ("край",
"очередь полна", "путь", "нет нуля осей"…): changing a reply means a new
flash and changing `rubens.py` and `src/machine.js` with it.

**Rules the code keeps — break one and it shows on the canvas or burns:**

- The loop is cooperative on `millis()`; the planner's **20 ms tick** is not
  to be touched: anything that steals a few ms shows as a tremor.
- **No STEP pulses from `loop()`.** Only FastAccelStepper, which sends them
  through the ESP32's RMT and MCPWM. The servo bus is not touched by it.
- **Servo bus:** SCServo, class `SMS_STS`, `Serial1` at 1 Mbaud, every move
  one `SyncWritePosEx` packet for all joints.
- **The arm and the rail never move together.** `J` stops both axes first;
  while a path runs, `X`, `Y`, `J` and `O` are refused.
- **The watchdog** stops the axes after 1.5 s without a command or a ping.
  It never touches the arm: a servo holds its pose, and dropping it onto the
  canvas on a timeout is not allowed. STOP and HARD STOP stop X and Y only.
- **800 steps per 10 mm on X** — a whole number on purpose: the error does
  not add up over a hundred strokes.
- No GRBL: it replaces the whole firmware and knows nothing of the servo bus.

## Serial commands

One per line, 115200 baud. RUBENS sends them through `rubens.py`
(`board_line`: the pages' addresses → these lines).

| command | what it does |
|---|---|
| `P` | ping for the watchdog; the reply says where the axes are: `ok P X <steps>[ край] Y <steps>[ край][ путь <n>]` |
| `V` | the look: who answers on the servo bus, their poses, the bus voltage. Moves nothing |
| `X <-20..20>`, `Y <-9..9>` | jog an axis at a level, 0 stops it; a level is 10 mm/s |
| `S` | stop both axes, braking; on a path it brakes along the line |
| `K` | stop both axes at once, no braking |
| `O <X\|Y> [n]` | the carriage's place becomes the axis zero, or the coordinate `n` in steps. The carriage does not move |
| `J <1..3> <deg>` | a joint to so many degrees from its zero (whole degrees) |
| `Z` | the arm's zero where it stands, all three joints. Nothing moves |
| `F <mm/s>`, `T <mm/s>` | pass and travel speed for the path (20 and 100 by default, 1…200) |
| `L <x> <y>` | a piece of path: a line to the point, machine mm |
| `A <cx> <cy> <x> <y> <±1>` | an arc round the centre to the angle of the point; +1 turns from +X to +Y |
| `M <x> <y>` | travel in a straight line, stopping at both ends |
| `G` | go along the queued pieces (up to 16); more can be sent on the way |

On a path, X and Y move together, 250 mm/s² along the path; the speed does
not drop at a smooth joint and drops to zero at a kink over 10° and at a
travel. A piece past a wall is refused ("край"). Without an axis zero the
ping says `?` and the walls are off.

## Build and flash

PlatformIO: `espressif32@7.1.2`, board `esp32dev`, framework `arduino`;
FastAccelStepper pinned at 1.3.4 (why: `platformio.ini`).

    cd firmware/CNCDM-001
    pio run                     # build
    c++ -std=c++17 -O1 -o /tmp/path_test test_host/path_test.cpp && /tmp/path_test

**Flash only together with the owner**, and so:

1. Note where the carriage stands (the Calibration tab), or save the place
   with Turn off (`/shutdown`).
2. Stop `rubens.py`: it holds the serial port, and the upload cannot get it.
3. `pio run -t upload`. The port is a mask, `/dev/cu.usbserial-*`; the
   speed 115200 (at 460800 the CP2102N gave "Corrupt data"). No driver is
   needed on macOS. The board flashes on USB alone, without the 12 V — the
   safe way to try code.
4. Start `rubens.py`. The board has forgotten the axis zero; the carriage
   has not moved: put the place back (`/restore`), or find home at the stops
   and Set home on the Calibration tab.
5. Then in the air, then with a pencil, then paint.

## The board

**Waveshare General Driver for Robots Rev 1.2, ESP32-WROOM-32UE**, with
this firmware (the stock Waveshare one is not used). Two Type-C ports:
**USB** is the ESP32 — commands and flashing; **LiDAR** is a separate
UART↔USB bridge, not connected to the ESP32, not used.

USB powers the logic only; the motors and the servos live on the 12 V.

### Pins

All on one header in the middle row of the board, top to bottom:

| pin | what | wire |
|---|---|---|
| `IO27` | X DIR | orange |
| `IO16` | X STEP | grey |
| `GND` | ground | violet |
| `3V3` | driver logic (VDD), MS1 and MS2 | brown |
| `IO5` | Y DIR | orange |
| `IO4` | Y STEP | grey |
| `5V` | not used | — |
| `GND` | not used | — |

- `EN` of both drivers is on ground: the motors are always powered and the
  carriage cannot be pushed by hand. If EN is ever wanted, `IO25` and `IO26`
  are free.
- `GPIO16` is free only because the WROOM module has no PSRAM; on a WROVER
  it is taken.
- The board's own: `IO18`, `IO19` — the servo bus (`Serial1`, 1 Mbaud);
  `IO32`, `IO33` — its I2C, with the OLED and the power monitor.
- An old note had `STEP → 27, DIR → 16, EN → 5`: that was a one-driver
  layout. Wrong now.

### Axes

| | X | Y |
|---|---|---|
| motor | NEMA17 STEPPERONLINE, 45 N·cm, 1.5 A | the same |
| driver | MKS TMC2209 V2.0, 1/16 microstep | the same |
| belt | GT2, 6 mm | GT2, 6 mm |
| pulley | 20 teeth, 40 mm a turn | **60 teeth**, 120 mm a turn |
| steps per mm | 80 | 3200 / 120 = 26.667 |
| plus is | towards the top of the picture (`DIR` turned round, 2026-09-23) | to the right, looking from the bottom of the picture |

Motor, from its label: holding torque 0.45 N·m, 1.50 A, 2.30 Ω, 4.40 mH,
1.8° a step, 0.28 kg. Coils: black A+ → 2B, green A− → 2A, red B+ → 1A,
blue B− → 1B. A motor turning the wrong way is fixed by inverting `DIR` in
the firmware, not by the wires.

**The drivers** run standalone. 1/16 needs **both MS1 and MS2 pulled to
3.3 V** (both low is 1/8 on a TMC2209, unlike a DRV8825). **SPREAD floats
and must float**: that is StealthChop, the quiet mode the TMC2209 was
chosen for; pulled to 3.3 V it becomes SpreadCycle and the machine howls.
VREF is the factory setting, not measured (the decision of 2026-09-20):
turn it only on symptoms — a hot motor: less; lost steps: more; small
fractions of a turn, a ceramic screwdriver. Lost steps show first on the
fastest move: lower the speed before touching VREF. A heatsink on each
driver; a 100 µF 35 V low-ESR capacitor right at each (long leg to VMOT).

The drivers sit on a breadboard across its groove: driver A in rows 1–8,
B in rows 20–27; signal side `EN, MS1, MS2, SPREAD, UART, NC, STEP, DIR`,
power side `VMOT, GND, 2B, 2A, 1A, 1B, VDD, GND`. The 3.3 V is one node in
row 15, a wire to each MS and each VDD. Colours: violet ground, yellow
12 V, brown 3.3 V, orange DIR, grey STEP (some grey is ground too, for
want of violet wires); white and red only from the power socket to the
board's terminal.

### The arm

| id | joint | servo | limit | offset of zero | sign in the firmware |
|---|---|---|---|---|---|
| 1 | shoulder | ST3215, 30 kg·cm | ±45° | +5° | −1 |
| 2 | elbow | ST3215-HS, 20 kg·cm | ±45° | +5° | +1 |
| 3 | wrist (J3) | ST3235, aluminium | ±90° (RUBENS: −90…+10°) | 0 | +1 |

- **The wrist: never past +10°.** A USB camera on the holder is in the way
  on the plus side (2026-09-30); the brush leaves the canvas at −54°
  (degrees from the brush upright, RUBENS's zero since 2026-09-30). The
  firmware's limit is still ±90°: RUBENS refuses the rest (`rubens.py`,
  `REACH`). When the firmware is flashed next, its wrist limit goes to
  −90…+10° too.
- 777 on the bus is the family, not the model: an ST3215 and an ST3215-HS
  answer alike. The factory ids 16, 17, 13 were set to 1, 2, 3.
- The shoulder is mounted face down. The firmware's −1 was meant to make
  its right plus, like the elbow's; on the machine its minus goes right.
  RUBENS turns it round (`rubens.py`, `TURN`), 2026-09-29; when the
  firmware is flashed next, its sign goes right and `TURN` goes to +1.
- A joint's zero is its pose at the first command after power-on, plus the
  offset; `Z` rewrites all three where they stand. RUBENS keeps its own
  zero (the working pose, raw servo poses in `calibration.json`) and never
  sends an absolute angle.
- The limits are caution, not measured. Speed 600 ticks/s (~53°/s),
  acceleration 30.
- An ST3215 holds its shaft as soon as it has power: do not turn the arm by
  hand then.
- Bus voltage: 11.8–12.0 V with the motors off, 11.5 V with both NEMA17
  holding.
- **The whole bus silent at once is the ground, not the servos:** the
  servos' black wire must reach the ESP32's ground (2026-09-22).

### Power

12 V 5 A, the Waveshare supply. Along the red wire: socket → **master
switch** → a tee: one branch to the board's terminal, one to the 12 V rail
of the breadboard. The master switch turns the machine on and off. **The
board's own switch stays ON**: it sits after the tee, and off with the 12 V
on would leave the drivers with VMOT and no VDD.

**The LEDs say nothing about the 12 V**: all three light from the USB
cable alone. The one check to trust is the look, `V` (`/machine/look`):
the servos do not run on USB, so if they answer, the 12 V is there.

## Rules that would cost money

- Never connect or disconnect a motor with the power on.
- 12 V on a driver's VDD kills it at once: 3.3 V only there.
- The master switch, not the board's switch.
- A heatsink on every driver; the capacitor right at it, short legs.
- SPREAD floats.
- Checking the link moves nothing only with `P` and `V`: the board answers
  without the 12 V too, so a reply does not say whether something will move
  (2026-09-21: two "test" commands moved the axis and the shoulder).

## Decided — do not propose again

| rejected | why |
|---|---|
| ball screw SFU1605 | 5 mm a turn: 4.5 min a metre, 1.5 kg of spinning steel |
| rack and pinion | comes in 500 mm pieces; the joint gives a jerk every pass |
| 10 mm belt | the pulleys are for 6 mm |
| ST3235 as the rail drive | a splined horn, no shaft; nothing mounts on it |
| DRV8825 | howls, worst at 10–30 rpm |
| MGN12 carriage | no leverage against roll; a V-slot wheel carriage is used |
| GRBL | replaces the firmware, knows nothing of the servo bus |

Closed loop (MKS SERVO42D) is postponed, not rejected: it replaces a driver,
the mechanics stay.

## Photos

In [`../../images_CNC_drawing_machine/`](../../images_CNC_drawing_machine/):
`ESP32-WROOM-32UE.png`, `Driver_board.png`, `TMC2209_v2.png`,
`driver_with_TMC2209.jpeg`, `driver_with_TMC2209-back.jpeg`,
`RAIL_ESP32_TMC2209_2026-09-20.png` (the wiring), `Nema17.png`,
`2xNema_17.jpeg`, `RAIL-drawing_machine_20-9-2026.jpeg`,
`servo direction.png` (the joints' directions on the pendant).
