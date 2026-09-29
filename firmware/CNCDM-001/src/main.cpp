// The machine's pendant firmware plus the RUBENS pass (since 2026-09-27; the
// draft and its history are in the archived machine repo, drafts/rubens-pass).
// Tested on the machine: a 50 × 50 square in pencil four times over, the
// carriage back in its corner to the hundredth.
//
// The pendant: two axes and the arm. Plus the RUBENS pass: the board leads
// the tip along a chain of lines and arcs, X and Y together, without stopping
// at smooth joints.
//
// Commands come over USB, one a line:
//   X <n>     the X axis at level n, -20 to 20, zero stops it
//   Y <n>     the same for Y, n from -9 to 9
//   J <j> <g> joint j (1 shoulder, 2 elbow, 3 wrist) to g degrees from its zero
//   Z         the arm's zero here: the pose it stands in becomes zero, nothing moves
//   S         stop both axes, braking (the arm is left alone, it holds its pose)
//   K         stop both axes at once, no braking
//   O <X|Y> [n]  the axis zero here: the carriage stands, its place becomes zero.
//             With n — its place becomes the coordinate n (in steps)
//   P         ping (the watchdog); the reply says where the axes are: ok P X <steps> Y <steps>
//   V         the look: is there 12 V, do the servos answer. Moves nothing
//
// The RUBENS pass. Coordinates are machine mm from the axis zeros (both are
// needed); a piece starts where the one before ends (or where the carriage is):
//   F <mm/s>  pass speed for L and A, 20 by default
//   T <mm/s>  travel speed for M, 100 by default
//   L <x> <y>                a line to the point
//   A <cx> <cy> <x> <y> <±1> an arc round the centre to the angle of the point; +1 from +X to +Y
//   M <x> <y>                travel in a straight line, stopping at both ends
//   G         go along what is queued; more can be sent on the way
// The reply to a piece is "ok L n", n being how many more fit the queue (16 pieces).
// A piece past a wall is refused: "край". While a path runs, the ping adds
// "путь n", and X, Y, J and O are refused. S brakes without leaving the
// path; K stops at once; the watchdog brakes like S.
//
// Level n = n × 10 mm/s on both axes. X has a 20-tooth pulley, 80 steps a
// mm: a level is n × 800 steps/s, the very 800 steps of the 10 mm step of
// the drawing. Y has a 60-tooth pulley, 26.667 steps a mm: a level is
// n × 266.667 steps/s (2026-09-27; before, Y ran three times as fast).
//
// No limit switches. Until an axis zero is taken with O, the coordinate is
// unknown: the ping says "?" instead of a number, and there are no walls.
// After O the axis has its walls WALL_MIN and WALL_MAX: the carriage brakes
// ahead and stops at the edge, and goes no further towards it.
//
// The rail and the arm never move together: a command to the arm stops both
// axes first. Travel, stop, sweep, stop.
//
// Each joint's zero is the pose it stood in when the first command came,
// plus its offset from JOINT_OFFSET. The limits come not from measurements
// but from caution and from what the sweep needs.

#include <Arduino.h>
#include <FastAccelStepper.h>
#include <SCServo.h>
#include "path.h"

static const int X_DIR = 27, X_STEP = 16;
static const int Y_DIR = 5,  Y_STEP = 4;

// One level = 10 mm/s, in millihertz, so that Y needs no rounding.
// Index 0 is X (800 steps/s), 1 is Y (266.667 steps/s).
static const uint32_t LEVEL_MHZ[2]    = { 800000, 266667 };
static const int      X_LEVEL_MAX     = 20;      // 200 mm/s, raised 2026-09-23
static const int      Y_LEVEL_MAX     = 9;       // 90 mm/s
static const uint32_t ACCEL           = 20000;   // steps/s²: 250 mm/s² on X, 750 mm/s² on Y
static const uint32_t WATCHDOG_MS     = 1500;    // silent longer than this — stop

// The RUBENS pass. A 20 ms tick: in a tick each axis gets its own steps for
// one and the same time (moveTimed), so X and Y go together.
static const float    STEPS_PER_MM[2] = { 80.0f, 3200.0f / 120.0f };  // X 20 teeth, Y 60
static const uint32_t SLICE_MS        = 20;
static const uint32_t SLICE_TICKS     = 16000000UL / 1000 * SLICE_MS;   // TICKS_PER_S on the ESP32
static const float    PATH_ACCEL      = 250.0f;  // mm/s²
// Entries in a motor's queue (32 in all); no more are added past this: for a
// slow axis (a step rarer than every 4 ms) the library puts one tick in up to
// 8 entries, and there must always be room for it — or "busy" (2026-09-27, at 28).
static const uint8_t  QUEUE_ROOM      = 24;
static const uint8_t  SLICES_AHEAD    = 6;       // ticks ahead in a motor's queue (120 ms)
// The runaway watchdog: during a path an axis count cannot go past a wall by
// more than the reserve to the stop plus 2 mm. If it does, the motor steps on
// its own: stop at once. On 2026-09-27 such a Y runaway rattled against the
// stop, and only K could stop it.
static const int32_t  RUNAWAY_STEPS[2] = { 12 * 80, 12 * 3200 / 120 };
static const uint32_t STOP_WAIT_MS     = 1500;    // S did not bring the path to a stop — K

static const int      S_RXD    = 18;             // servo bus, receive
static const int      S_TXD    = 19;             // servo bus, transmit
static const uint32_t BUS_BAUD = 1000000;        // 1 Mbaud, or the servos are silent

static const int     JOINTS      = 3;
static const uint8_t JOINT_ID[JOINTS] = { 1, 2, 3 };   // shoulder, elbow, wrist
static const float   TICKS_PER_DEG = 4096.0f / 360.0f; // 11.378 ticks a degree
static const uint16_t MOVE_SPEED = 600;          // ticks/s, about 53°/s
static const uint8_t  MOVE_ACC   = 30;

// Each joint has its own sign, limit and offset of zero.
// The drawing: `servo direction.png` (images_CNC_drawing_machine/).
//
// The shoulder is mounted face down, its disc up: its right comes out minus
// by itself. The sign −1 was meant to straighten that, right plus everywhere
// — on the machine its minus still goes right, and RUBENS turns it round
// (rubens.py, TURN; 2026-09-29).
// The elbow is mounted face up, nothing to straighten.
// The wrist reads like a clock face: minus is anticlockwise, plus clockwise.
//
// The wrist has the full ±90° here: it works as a broom, and a short sweep
// does not spread paint over the canvas. Since 2026-09-30 a USB camera on
// the holder takes the plus side past +10°; RUBENS refuses those moves
// (rubens.py, REACH) — put this limit to −90…+10 at the next flash.
//
// The +5° offset of the shoulder and the elbow is a pose handy for
// debugging. It goes right, the straightened way.
static const int8_t  JOINT_SIGN[JOINTS]   = { -1, +1, +1 };
static const int16_t JOINT_LIMIT[JOINTS]  = { 45, 45, 90 };
static const int16_t JOINT_OFFSET[JOINTS] = { +5, +5,  0 };

// The walls in steps from the axis zero. Index 0 is X (80 steps = 1 mm),
// 1 is Y (26.667 steps = 1 mm). NO_WALL — no wall on that side yet.
//
// The owner's decision of 2026-09-27, like the reserve in a fuel tank: zero
// is where the wall is, and the reserve up to the stop is already minus.
// Home is the bottom left corner: X down to its stop, Y left to its stop, on
// level 1, stop at the first sound. There X = −756 (−9.45 mm) and Y = −222
// (−8.3 mm) are set: that is where the stops were marked on 2026-09-27, when
// zero was taken at the walls.
//   X bottom  0 steps      = 0.0 mm, the stop at −9.45
//   X top     +69200 steps = +865.0 mm, the owner's decision of 2026-09-27:
//             the stop at +870 (on the right, one knock at the 870 wall), a
//             5 mm reserve. The morning's measure on the left gave the stop at
//             +860.55 (ping 873.0 less three knocks of 0.8 mm) — check the top
//             left at level 1. The same evening it was +850.0, +860.0, +870.0
//   Y left    0 steps      = 0.0 mm, the stop at −8.3
//   Y right   +15160 steps = +568.5 mm, the stop at +578.55 (ping 590.55 less
//             five knocks at the stop, 2.4 mm each). Y travel between the stops 586.9 mm
static const int32_t NO_WALL_MIN = INT32_MIN / 2;
static const int32_t NO_WALL_MAX = INT32_MAX / 2;
static const int32_t WALL_MIN[2] = { 0, 0 };
static const int32_t WALL_MAX[2] = { +69200, +15160 };

FastAccelStepperEngine engine = FastAccelStepperEngine();
FastAccelStepper *sx = NULL;
FastAccelStepper *sy = NULL;
SMS_STS st;

static bool   axisZero[2] = { false, false };  // zero taken with O
static int8_t axisDir[2]  = { 0, 0 };          // where it was told to go: +1, −1, 0
static bool   axisEdge[2] = { false, false };  // stands at a wall

static FastAccelStepper *axisOf(int a) { return a == 0 ? sx : sy; }
static bool wallsOn(int a) { return axisZero[a]; }

static uint32_t lastRx   = 0;
static bool     stopped  = true;
static char     buf[64];   // "A cx cy x y ±1" is longer than 32
static int      bufLen   = 0;

static int32_t zeroTick[JOINTS] = { -1, -1, -1 };   // -1 — zero not taken yet
static int16_t targetDeg[JOINTS] = { 0, 0, 0 };

static path::Planner planner(PATH_ACCEL);
static bool     pathOn     = false;     // G given, the path runs
static bool     pathFirst  = false;     // the first tick: fill the queues, then let them go at once
static bool     pathStopping = false;   // S or the watchdog: braking along the path, no new pieces taken
static bool     pathDraining = false;   // the last tick is given, the motors run out their queues
static long     cmdSteps[2] = { 0, 0 }; // where they have been told to go, steps
static int32_t  carry[2]    = { 0, 0 }; // time short in the last tick, ticks
static float    paintMMs   = 20.0f;
static float    travelMMs  = 100.0f;
static uint32_t underruns  = 0;         // a motor's queue ran empty on the move
static uint32_t pathFaults = 0;         // a path stopped by a queue fault or the runaway watchdog
static uint32_t stopAt     = 0;         // when S came during a path
static uint32_t retries    = 0;         // a motor answered "busy" or "pause for a change of direction"
// A tick not yet taken by both axes: each axis's steps, which have taken it,
// since when it is waited for, and the pauses for a change of direction.
static long     sliceSteps[2]   = { 0, 0 };
static bool     slicePending[2] = { false, false };
static bool     sliceMore       = true;
static uint32_t sliceSince      = 0;
static uint32_t dirPause[2]     = { 0, 0 };
static const uint32_t SLICE_STALL_MS = 100;   // a tick not taken for so long — a fault
static char     lastFault[40] = "нет";  // why the last path fault, for the look V

// False if the axis is against a wall: no further towards it, away from it gladly.
static bool drive(int a, int level) {
  FastAccelStepper *s = axisOf(a);
  if (s == NULL) return true;
  if (level == 0) { s->stopMove(); axisDir[a] = 0; return true; }

  if (wallsOn(a)) {
    int32_t p = s->getCurrentPosition();
    if ((level > 0 && p >= WALL_MAX[a]) || (level < 0 && p <= WALL_MIN[a])) {
      axisEdge[a] = true;
      return false;
    }
  }

  stopped = false;
  axisDir[a]  = level > 0 ? 1 : -1;
  axisEdge[a] = false;
  s->setSpeedInMilliHz((uint32_t)abs(level) * LEVEL_MHZ[a]);
  if (level > 0) s->runForward();
  else           s->runBackward();
  return true;
}

static void stopAll() {
  if (pathOn) {                                  // brake along the path, still sending ticks
    if (!pathStopping) { planner.stopSoon(); pathStopping = true; stopAt = millis(); }
    return;
  }
  // pieces are queued but there was no G — drop them, so the next G does not run them
  if (planner.running() && sx && sy)
    planner.clear(sx->getCurrentPosition() / STEPS_PER_MM[0], sy->getCurrentPosition() / STEPS_PER_MM[1]);
  if (sx) sx->stopMove();
  if (sy) sy->stopMove();
  axisDir[0] = axisDir[1] = 0;
  stopped = true;
}

// Stop at once: no braking, the motor stands dead. The carriage may carry
// on and turn the belt a tooth or two, and then the coordinate parts from
// the iron. In doubt, take the zero again.
static void killAll() {
  if (sx) sx->forceStop();
  if (sy) sy->forceStop();
  if (pathOn || planner.running()) {
    pathOn = false; pathStopping = false; pathDraining = false;
    slicePending[0] = slicePending[1] = false;
    planner.clear(sx ? sx->getCurrentPosition() / STEPS_PER_MM[0] : 0,
                  sy ? sy->getCurrentPosition() / STEPS_PER_MM[1] : 0);
  }
  axisDir[0] = axisDir[1] = 0;
  stopped = true;
}

// The walls. The braking distance is known ahead: as soon as the place of
// stopping reaches the edge, brake, and stop at it, not past it.
static void guardWalls() {
  for (int a = 0; a < 2; a++) {
    FastAccelStepper *s = axisOf(a);
    if (s == NULL || axisDir[a] == 0 || !wallsOn(a)) continue;

    int32_t p = s->getCurrentPosition();
    int32_t v = s->getCurrentSpeedInMilliHz();
    int32_t d = (int32_t)s->stepsToStop();
    if ((axisDir[a] > 0 && v > 0 && p + d >= WALL_MAX[a]) ||
        (axisDir[a] < 0 && v < 0 && p - d <= WALL_MIN[a])) {
      s->stopMove();
      axisDir[a]  = 0;
      axisEdge[a] = true;
    }
  }
}

// The axis zero here. Only standing: on the move the step count is not done.
// With a number — "the carriage stands at coordinate n": so the zero
// survives a flash of the firmware, as long as nobody touched the carriage.
static void zeroAxis(const char *line) {
  const char *p = line + 1;
  while (*p == ' ') p++;
  int a = (*p == 'X' || *p == 'x') ? 0 : (*p == 'Y' || *p == 'y') ? 1 : -1;
  if (a < 0) { Serial.println("? ось"); return; }
  long at = atol(p + 1);

  FastAccelStepper *s = axisOf(a);
  if (s == NULL) { Serial.println("? нет оси"); return; }
  if (s->isRunning()) { Serial.println("? едет, сначала стоп"); return; }

  s->setCurrentPosition((int32_t)at);
  axisZero[a] = true;
  axisEdge[a] = false;
  Serial.printf("ok O %c %ld\n", a == 0 ? 'X' : 'Y', at);
}

// The ping also says where the axes are. "?" — no zero, no coordinate.
// "край" — the axis stands at a wall.
static void ping() {
  char out[80];
  int  n = snprintf(out, sizeof(out), "ok P");
  for (int a = 0; a < 2; a++) {
    FastAccelStepper *s = axisOf(a);
    const char *name = a == 0 ? "X" : "Y";
    if (s == NULL || !axisZero[a]) {
      n += snprintf(out + n, sizeof(out) - n, " %s ?", name);
    } else {
      n += snprintf(out + n, sizeof(out) - n, " %s %ld%s", name,
                    (long)s->getCurrentPosition(), axisEdge[a] ? " край" : "");
    }
  }
  if (pathOn) n += snprintf(out + n, sizeof(out) - n, " путь %d", planner.count());
  Serial.println(out);
}

// The zero is taken from the pose the servo stands in now. Without the 12 V
// the servo does not answer: then the zero stays untaken and the arm does not move.
static bool takeZero(int j) {
  if (zeroTick[j] >= 0) return true;
  int pos = st.ReadPos(JOINT_ID[j]);
  if (pos < 0) return false;
  zeroTick[j] = pos;
  Serial.printf("ноль сустава %d: %d\n", JOINT_ID[j], pos);
  return true;
}

// The arm moves in one packet for the whole bus, even if one joint moved.
static void moveArm() {
  uint8_t ids[JOINTS];
  s16     pos[JOINTS];
  u16     spd[JOINTS];
  u8      acc[JOINTS];
  int     n = 0;

  for (int j = 0; j < JOINTS; j++) {
    if (zeroTick[j] < 0) continue;

    long tick = zeroTick[j] + lroundf(JOINT_SIGN[j] *
                (targetDeg[j] + JOINT_OFFSET[j]) * TICKS_PER_DEG);

    // An STS counts its position 0…4095 and round. Stop at the end rather
    // than jump over it by half a turn.
    if (tick < 0)    tick = 0;
    if (tick > 4095) tick = 4095;

    ids[n] = JOINT_ID[j];
    pos[n] = (s16)tick;
    spd[n] = MOVE_SPEED;
    acc[n] = MOVE_ACC;
    n++;
  }
  if (n) st.SyncWritePosEx(ids, n, pos, spd, acc);
}

// The zero here. The arm does not move: no pose is commanded, the point of
// reference is rewritten to the pose it already stands in. JOINT_OFFSET is
// taken off, or the joint would jerk by those degrees right after.
static void reZero() {
  stopAll();

  int done = 0;
  for (int j = 0; j < JOINTS; j++) {
    int raw = st.ReadPos(JOINT_ID[j]);
    if (raw < 0) continue;
    zeroTick[j]  = raw - lroundf(JOINT_SIGN[j] * JOINT_OFFSET[j] * TICKS_PER_DEG);
    targetDeg[j] = 0;
    done++;
  }
  Serial.printf("ok Z %d\n", done);
}

static void handleJoint(const char *line) {
  int j = 0, deg = 0;
  if (sscanf(line + 1, "%d %d", &j, &deg) != 2) { Serial.println("?"); return; }
  if (j < 1 || j > JOINTS) { Serial.println("? сустав"); return; }

  const int16_t lim = JOINT_LIMIT[j - 1];
  if (deg >  lim) deg =  lim;
  if (deg < -lim) deg = -lim;

  // The rail and the arm do not move together.
  stopAll();

  if (!takeZero(j - 1)) { Serial.printf("нет серво %d\n", j); return; }

  targetDeg[j - 1] = deg;
  moveArm();
  Serial.printf("ok J %d %d\n", j, deg);
}

// The look, nothing moves. The servos run on the 12 V only, on USB they are
// dead, so an answer at all proves the board has power. The servos serve as
// a voltmeter too: ReadVoltage gives tenths of a volt.
//
// The reply is one line: the host keeps only the board's last line.
static void report() {
  char out[320];
  int  n = snprintf(out, sizeof(out), "ok V | X %s, Y %s | путь: пусто %lu, повторов %lu, сбоев %lu, последний: %s",
                    sx ? sx->driverTypeString() : "НЕТ", sy ? sy->driverTypeString() : "НЕТ",
                    (unsigned long)underruns, (unsigned long)retries, (unsigned long)pathFaults, lastFault);

  for (int j = 0; j < JOINTS; j++) {
    if (n < 0 || n >= (int)sizeof(out)) break;

    int pos = st.ReadPos(JOINT_ID[j]);
    if (pos < 0) {
      n += snprintf(out + n, sizeof(out) - n, " | %d: молчит", JOINT_ID[j]);
      continue;
    }
    int v = st.ReadVoltage(JOINT_ID[j]);
    int t = st.ReadTemper(JOINT_ID[j]);
    n += snprintf(out + n, sizeof(out) - n, " | %d: поза %d, %d,%d В, %d °C",
                  JOINT_ID[j], pos, v / 10, v % 10, t);
  }
  Serial.println(out);
}

// ---------- the RUBENS pass ----------

static bool bothZero() { return sx && sy && axisZero[0] && axisZero[1]; }

// A point inside the walls, mm. Where there is no wall or no zero — not checked.
static bool inside(float x, float y) {
  const float p[2] = { x, y };
  for (int a = 0; a < 2; a++) {
    if (!wallsOn(a)) continue;
    long st = lroundf(p[a] * STEPS_PER_MM[a]);
    if (st < WALL_MIN[a] || st > WALL_MAX[a]) return false;
  }
  return true;
}

// A piece inside the walls: its end, and for an arc also its extreme points
// along the axes. The start is not checked: it is where the carriage already
// stands (or the end of the piece before, checked already). At a wall, after
// braking, the carriage stands a little past it, in the reserve, and home is
// in the reserve too; going inside from there is allowed.
static bool insideSeg(const path::Seg &g) {
  if (!inside(g.x1, g.y1)) return false;
  if (g.kind != 'A') return true;
  const float TAU = 6.2831853f;
  for (int k = 0; k < 4; k++) {
    float a = k * TAU / 4;
    float d = g.sweep > 0 ? fmodf(a - g.a0 + 2 * TAU, TAU) : fmodf(g.a0 - a + 2 * TAU, TAU);
    if (d < fabsf(g.sweep) && !inside(g.cx + g.r * cosf(a), g.cy + g.r * sinf(a))) return false;
  }
  return true;
}

static void handlePath(char c, const char *line) {
  const char *p = line + 1;
  if (c == 'F' || c == 'T') {
    float v = strtof(p, NULL);
    if (!(v >= 1 && v <= 200)) { Serial.println("? скорость 1…200 мм/с"); return; }
    if (c == 'F') paintMMs = v; else travelMMs = v;
    Serial.printf("ok %c %.1f\n", c, v);
    return;
  }
  if (c == 'G') {
    if (!planner.running()) { Serial.println("? очередь пуста"); return; }
    if (!pathOn) {
      pathOn = true; pathFirst = true; pathStopping = false; pathDraining = false; stopped = false;
      slicePending[0] = slicePending[1] = false; dirPause[0] = dirPause[1] = 0;
      cmdSteps[0] = sx->getCurrentPosition(); cmdSteps[1] = sy->getCurrentPosition();
      carry[0] = carry[1] = 0;
    }
    Serial.println("ok G");
    return;
  }
  // L, A, M — a piece into the queue
  if (!bothZero()) { Serial.println("? нет нуля осей"); return; }
  if (pathStopping) { Serial.println("? тормозим"); return; }
  if (!pathOn && (sx->isRunning() || sy->isRunning())) { Serial.println("? едет, сначала стоп"); return; }
  if (!planner.running())
    planner.setHere(sx->getCurrentPosition() / STEPS_PER_MM[0], sy->getCurrentPosition() / STEPS_PER_MM[1]);

  float v[5]; int n = 0;
  while (n < 5) { char *e; float f = strtof(p, &e); if (e == p) break; v[n++] = f; p = e; }
  const float x0 = planner.endX(), y0 = planner.endY();
  path::Seg g;
  if ((c == 'L' || c == 'M') && n == 2)
    g = path::line(x0, y0, v[0], v[1], c == 'L' ? paintMMs : travelMMs, c);
  else if (c == 'A' && n == 5 && (v[4] == 1 || v[4] == -1))
    g = path::arc(x0, y0, v[0], v[1], v[2], v[3], (int)v[4], paintMMs);
  else { Serial.println("?"); return; }

  if (g.len < 0.001f) { Serial.printf("ok %c %d\n", c, planner.room()); return; }   // an empty piece
  if (!insideSeg(g))   { Serial.printf("край %c\n", c); return; }
  if (!planner.push(g)) { Serial.println("? очередь полна"); return; }
  Serial.printf("ok %c %d\n", c, planner.room());
}

// The path's tick. While the motors' queues hold fewer ticks ahead than
// wanted, the next one goes in: the path's point → each axis's steps →
// moveTimed for one and the same time. Time short (whole ticks) carries over
// to that axis's next tick.
// The board writes no line unasked: the host keeps only the last line; that
// the path has ended shows in the ping.
// A path fault: stop at once and say why. A line unasked is the exception:
// whoever pings sees it, and the host keeps it.
static void pathFault(const char *why, int code) {
  killAll();
  pathFaults++;
  snprintf(lastFault, sizeof(lastFault), "%s %d", why, code);
  Serial.printf("? путь: %s %d\n", why, code);
}

static void pathTick() {
  if (!pathOn) return;
  FastAccelStepper *s[2] = { sx, sy };
  // The runaway watchdog: the count cannot go past a wall by more than the reserve.
  for (int a = 0; a < 2; a++) {
    int32_t p = s[a]->getCurrentPosition();
    if (p < WALL_MIN[a] - RUNAWAY_STEPS[a] || p > WALL_MAX[a] + RUNAWAY_STEPS[a]) {
      pathFault(a == 0 ? "побег X" : "побег Y", (int)p);
      return;
    }
  }
  // S did not bring the path to a stop in reasonable time — stop at once.
  if (pathStopping && millis() - stopAt > STOP_WAIT_MS) { pathFault("S не остановил", 0); return; }
  // The path ends when the motors have got there, not when the last tick is
  // given: until then the ping keeps "путь", and the arm and the jog wait.
  if (pathDraining) {
    if (!sx->isRunning() && !sy->isRunning()) {
      pathOn = false; pathDraining = false; pathStopping = false; stopped = true;
    }
    return;
  }
  // Add ticks while both axes hold fewer than SLICES_AHEAD ahead.
  // Since FastAccelStepper 1.2.8 moveTimed() queues a tick atomically: all
  // of it or nothing. So "busy", "not ready" and "pause for a change of
  // direction" mean: the same tick again (the pause counted in the axis's
  // time), and only on the axis that has not taken it. The plan waits until
  // both have. A tick not taken for longer than SLICE_STALL_MS, and any
  // error — stop at once.
  for (int n = 0; n < 8; n++) {
    if (!slicePending[0] && !slicePending[1]) {
      if (sx->ticksInQueue() >= SLICES_AHEAD * SLICE_TICKS || sy->ticksInQueue() >= SLICES_AHEAD * SLICE_TICKS ||
          sx->queueEntries() >= QUEUE_ROOM || sy->queueEntries() >= QUEUE_ROOM) return;
      float x, y;
      sliceMore = planner.step(SLICE_MS / 1000.0f, &x, &y);
      const long t[2] = { lroundf(x * STEPS_PER_MM[0]), lroundf(y * STEPS_PER_MM[1]) };
      for (int a = 0; a < 2; a++) {
        sliceSteps[a] = t[a] - cmdSteps[a];
        cmdSteps[a] = t[a];
        slicePending[a] = true;
      }
      sliceSince = millis();
    }
    for (int a = 0; a < 2; a++) {
      for (int k = 0; k < 4 && slicePending[a]; k++) {
        int32_t w = (int32_t)SLICE_TICKS + carry[a];
        uint32_t want = w > (int32_t)(SLICE_TICKS / 2) ? (uint32_t)w : SLICE_TICKS / 2, got = 0;
        MoveTimedResultCode r = s[a]->moveTimed((int16_t)sliceSteps[a], want, &got, !pathFirst);
        if (r == MoveTimedResultCode::DirChangePauseInjected || r == MoveTimedResultCode::DirPin2msPauseAdded) {
          dirPause[a] += got; retries++;           // the pause went in, the tick not yet: again at once
          continue;
        }
        if (r == MOVE_TIMED_OK || r == MOVE_TIMED_EMPTY) {
          if (r == MOVE_TIMED_EMPTY && !pathFirst) underruns++;
          carry[a] = (int32_t)want - (int32_t)(got + dirPause[a]);
          dirPause[a] = 0;
          slicePending[a] = false;
          break;
        }
        if ((int8_t)r > 0) { retries++; break; }   // busy, not ready: on the next round
        pathFault(a == 0 ? "moveTimed X" : "moveTimed Y", (int)(int8_t)r);
        return;
      }
    }
    if (slicePending[0] || slicePending[1]) {
      if (millis() - sliceSince > SLICE_STALL_MS) pathFault("такт не берётся", slicePending[0] ? 0 : 1);
      return;
    }
    if (pathFirst) {               // both queues are full — let them go at once
      sx->moveTimed(0, 0, NULL, true);
      sy->moveTimed(0, 0, NULL, true);
      pathFirst = false;
    }
    if (!sliceMore) { pathDraining = true; return; }
  }
}

static void handle(const char *line) {
  lastRx = millis();

  char c = line[0];
  if (c == 'S' || c == 's') { stopAll(); Serial.println("ok S"); return; }
  if (c == 'K' || c == 'k') { killAll(); Serial.println("ok K"); return; }
  if (c == 'P' || c == 'p') { ping(); return; }
  if (pathOn && (c == 'O' || c == 'o')) { Serial.println("? идёт путь, сначала S"); return; }
  if (c == 'O' || c == 'o') { zeroAxis(line); return; }
  if (c == 'V' || c == 'v') { report(); return; }
  if (strchr("FfTtLlAaMmGg", c)) { handlePath((char)toupper(c), line); return; }
  // While a path runs: no jog, no arm, no zeros. S first.
  if (pathOn && strchr("XxYyJjOo", c)) { Serial.println("? идёт путь, сначала S"); return; }
  if (c == 'J' || c == 'j') { handleJoint(line); return; }
  if (c == 'Z' || c == 'z') { reZero(); return; }

  if (c == 'X' || c == 'x' || c == 'Y' || c == 'y') {
    int level = atoi(line + 1);
    const int lim = (c == 'X' || c == 'x') ? X_LEVEL_MAX : Y_LEVEL_MAX;
    if (level >  lim) level =  lim;
    if (level < -lim) level = -lim;

    const int  a    = (c == 'X' || c == 'x') ? 0 : 1;
    const char name = a == 0 ? 'X' : 'Y';
    if (drive(a, level)) Serial.printf("ok %c %d\n", name, level);
    else                 Serial.printf("край %c\n", name);
    return;
  }

  Serial.println("?");
}

void setup() {
  Serial.begin(115200);
  delay(300);

  engine.init();

  // The step driver is MCPWM/PCNT on purpose: everything was tested on it,
  // and it was fixed in FastAccelStepper 1.3.x; RMT counts steps on the move
  // more coarsely.
  sx = engine.stepperConnectToPin(X_STEP, DRIVER_MCPWM_PCNT);
  // X's DIR is turned round since 2026-09-23: without it plus drove the
  // carriage back. Now plus is forward, and the step count grows forward.
  // The wires were not touched.
  if (sx) { sx->setDirectionPin(X_DIR, false); sx->setAcceleration(ACCEL); }

  sy = engine.stepperConnectToPin(Y_STEP, DRIVER_MCPWM_PCNT);
  if (sy) { sy->setDirectionPin(Y_DIR); sy->setAcceleration(ACCEL); }

  Serial1.begin(BUS_BAUD, SERIAL_8N1, S_RXD, S_TXD);
  st.pSerial = &Serial1;
  delay(200);

  lastRx = millis();

  Serial.println();
  Serial.println("Motor Brush — пульт машины");
  Serial.printf("X: STEP %d DIR %d  %s %s\n", X_STEP, X_DIR, sx ? "готов" : "НЕ ПОДКЛЮЧЁН", sx ? sx->driverTypeString() : "");
  Serial.printf("Y: STEP %d DIR %d  %s %s\n", Y_STEP, Y_DIR, sy ? "готов" : "НЕ ПОДКЛЮЧЁН", sy ? sy->driverTypeString() : "");
  Serial.printf("рука: шина на %d и %d\n", S_RXD, S_TXD);
  for (int j = 0; j < JOINTS; j++) {
    Serial.printf("  ID %d: знак %+d, предел +-%d, ноль смещён на %+d\n",
                  JOINT_ID[j], JOINT_SIGN[j], JOINT_LIMIT[j], JOINT_OFFSET[j]);
  }
  Serial.println("команды: X <-20..20>, Y <-9..9>, J <1..3> <град>, Z — ноль руки, O <X|Y> — ноль оси, S — стоп, K — резкий стоп");
  Serial.println("проход: F/T <мм/с>, L x y, A cx cy x y ±1, M x y, G — поехали");
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (bufLen) { buf[bufLen] = 0; handle(buf); bufLen = 0; }
    } else if (bufLen < (int)sizeof(buf) - 1) {
      buf[bufLen++] = ch;
    }
  }

  // The watchdog: the browser closed, the cable pulled, the page hung — the
  // motors must not be left running on their own. The watchdog leaves the
  // arm alone: a servo holds its pose, and dropping it onto the canvas is
  // not allowed.
  pathTick();
  guardWalls();

  if (!stopped && !pathStopping && millis() - lastRx > WATCHDOG_MS) {
    stopAll();
    Serial.println("стоп по сторожу");
  }
}
