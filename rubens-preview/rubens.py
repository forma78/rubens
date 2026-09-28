#!/usr/bin/env python3
"""RUBENS server: serves this folder on http://localhost:8766 and talks to
the machine through its bridge (Rubens_v2.md, section 6).

- Static files: the Create page (index.html), Calibration (calibration.html)
  and Job (job.html).
- /machine/<command> goes to the machine bridge (RAIL-drawing_machine,
  bridge.py, port 8765), which stays the only owner of the serial port.
  Only the commands in PASS get through: the ping, the look, the axes, and
  the axis zero. The arm is not among them.
- /calibration and /job: GET returns calibration.json / job.json, PUT saves
  it. The Job tab writes job.json — the job in mm, in the order it runs.
- /arm: GET the arm in RUBENS's degrees (0° = the working pose); POST
  /arm?j=<joint>&d=<deg> moves one joint there (class Arm). /brush/off and
  /brush/on go through it too.
- /park (GET), POST /shutdown and /restore: the place where the carriage
  stood when the motors were shut down, put back after power-on (class Park).
- /run: the runner (class Runner) — GET is its state; POST starts the machine
  blocks of job.json, or the blocks in its body (a calibration run); POST /run/stop brakes along the path, /run/kill stops at
  once; /run/pause and /run/continue pause a run and go on from the same point. POST /brush/off and /brush/on swing the wrist to +90° or back to 0°
  (only the wrist, only these two, not while a job runs — the owner asked for
  them on the Job tab, 2026-09-27). It needs the firmware and bridge from
  RAIL-drawing_machine/drafts/rubens-pass (not flashed yet); until then a
  start fails on the first path command and nothing moves.

Run:  python3 rubens.py
Listens on this Mac only: the machine is driven from here, not from the
network.
"""

import json
import math
import os
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8766
BRIDGE = "http://127.0.0.1:8765"
FILES = {"/calibration": os.path.join(HERE, "calibration.json"), "/job": os.path.join(HERE, "job.json")}
PARK_FILE = os.path.join(HERE, "park.json")   # class Park; written by rubens.py only
PASS = {"/ping", "/look", "/cmd", "/origin/x", "/origin/y"}
STEPS_PER_MM = (80.0, 3200.0 / 120.0)   # X, Y — the same as src/machine.js
# The walls in mm (src/machine.js, the firmware). A carriage counted more
# than RUNAWAY_MM past one means the board is sending steps it should not:
# the runner stops the motors at once (2026-09-27: the watchdog could not,
# because the runner kept pinging while the Y motor ground on the stop).
# The line is the board's own (RUNAWAY_STEPS in the firmware): the reserve up
# to the stop plus 2 mm. Home itself lies in the reserve, at X −9.45 and
# Y −8.3; with 5 mm here the runner took home for a runaway (2026-09-28).
WALLS_MM = ((0.0, 865.0), (0.0, 15160 / (3200.0 / 120.0)))
RUNAWAY_MM = 12.0
# After every move block the carriage must stand where the block ends. The
# board stops a path by itself on a fault (a motor that does not take a
# slice); the runner used to take that for the end of the block and went on,
# brush down, from the wrong place (2026-09-28: X stuck after a HARD STOP,
# three passes ran along Y only). An arc's end is recomputed by the board
# from its start radius, a tenth of a mm at most.
ARRIVAL_MM = 1.0

# What the board answers, in the words of the Job tab.
BOARD_WORDS = [
    (re.compile(r"^край ([A-Z])"), "past a wall"),
    (re.compile(r"такт не берётся"), "a motor does not take the path (restart the board)"),
    (re.compile(r"нет нуля осей"), "no zero on the axes"),
    (re.compile(r"тормозим"), "the board is braking"),
    (re.compile(r"едет, сначала стоп"), "the carriage is moving: stop it first"),
    (re.compile(r"очередь полна"), "the path queue is full"),
    (re.compile(r"очередь пуста"), "nothing to run"),
    (re.compile(r"скорость"), "speed out of 1…200 mm/s"),
]


def in_english(reply):
    for pat, words in BOARD_WORDS:
        if pat.search(reply or ""):
            return words
    return reply


def block_end(cmds):
    """Where a move block leaves the carriage, in mm: the end of its last
    piece (L x y, M x y, A cx cy x y ±1), or None if it has no pieces."""
    for c in reversed(cmds):
        p = c.split()
        if p[0] in ("L", "M") and len(p) == 3:
            return float(p[1]), float(p[2])
        if p[0] == "A" and len(p) == 6:
            return float(p[3]), float(p[4])
    return None
# Runs were off on 2026-09-27 after a diagonal pass ran the Y axis away;
# on again the same night once the pass core ran on FastAccelStepper 1.3.4
# and passed the air tests (CALIBRATION.md). Set to False to lock them.
RUNS_ENABLED = True


# The arm (RAIL-drawing_machine/src/main.cpp: JOINT_ID, JOINT_SIGN,
# JOINT_LIMIT): servo id, sign, limit in degrees. The same signs as the
# MELNICOMM pendant (images_CNC_drawing_machine/servo direction.png: shoulder
# minus — to the right, elbow plus — to the right, wrist minus left, plus right).
JOINTS = {"shoulder": (1, -1, 45), "elbow": (2, +1, 45), "wrist": (3, +1, 90)}
TICKS_PER_DEG = 4096 / 360
# The working pose, raw servo poses (4096 a turn). calibration.json "arm" is
# the one in use; this is its copy for when the file has none. 2026-09-28,
# late: the owner set the arm to the middle of the field with the handles —
# the elbow 24.6° from the pose of the evening before (2501 · 1759 · 1489).
ARM_ZERO = {"shoulder": 2498, "elbow": 2039, "wrist": 1492}


def parse_look(text):
    """'ok V | … | 1: поза 2499, 11,3 В, 31 °C | 2: …' → {1: 2499, 2: …}"""
    return {int(j): int(p) for j, p in re.findall(r"(\d): поза (\d+)", text or "")}


class ArmError(Exception):
    pass


class Arm:
    """The arm in RUBENS's own degrees: 0° is the working pose (ARM_ZERO).

    The firmware takes a joint's zero from wherever it stands at the first
    command after power-on; twice on 2026-09-28 that sent the brush to 180°.
    The servos read their own pose, so RUBENS never sends the firmware an
    absolute angle: it reads where the joint really is, sets the firmware's
    zero there (Z — nothing moves, the other joints hold where they are) and
    sends the difference, in steps within the joint's limit. Whatever zero the
    board took, the arm goes where RUBENS says. Servos cannot be stopped by
    STOP; a move takes up to about 2 s (MOVE_SPEED, ~53°/s).
    """

    def __init__(self, send, zero=lambda: ARM_ZERO, sleep=time.sleep):
        self.send, self.zero, self.sleep = send, zero, sleep
        self.lock = threading.Lock()

    def angles(self):
        raw, z = parse_look(self.send("/look")), self.zero()
        out = {}
        for k, (jid, sign, _) in JOINTS.items():
            out[k] = None if jid not in raw else round(sign * (raw[jid] - z[k]) / TICKS_PER_DEG, 1)
        return out, raw

    def move_to(self, joint, deg):
        jid, sign, lim = JOINTS[joint]
        deg = max(-lim, min(lim, deg))
        with self.lock:
            for _ in range(6):
                ang, raw = self.angles()
                if ang[joint] is None:
                    raise ArmError(f"the {joint} does not answer: is the 12 V on?")
                d = deg - ang[joint]
                step = max(-lim, min(lim, round(d)))
                if abs(d) < 0.6 or step == 0:
                    return ang[joint]
                r = self.send("/zero")
                if not r.startswith("ok Z"):
                    raise ArmError(f"arm zero: {in_english(r)}")
                r = self.send(f"/servo?j={joint}&d={step}")
                if not r.startswith("ok J"):
                    raise ArmError(f"{joint}: {in_english(r)}")
                self._settle(jid, raw[jid] + sign * step * TICKS_PER_DEG)
            raise ArmError(f"the {joint} does not get to {deg}°")

    def hold(self):
        # After power-on the shoulder and elbow hold only once commanded
        # (2026-09-28: the shoulder was dragged 67°). Z moves nothing, and a
        # zero step of the wrist then makes the board send all three poses.
        with self.lock:
            r = self.send("/zero")
            if not r.startswith("ok Z"):
                raise ArmError(f"arm zero: {in_english(r)}")
            r = self.send("/servo?j=wrist&d=0")
            if not r.startswith("ok J"):
                raise ArmError(f"wrist: {in_english(r)}")

    def _settle(self, jid, target):
        # until the servo is there, or stands still (held back by something)
        last, t = None, 0.0
        while t < 4.0:
            self.sleep(0.15)
            t += 0.15
            p = parse_look(self.send("/look")).get(jid)
            if p is None:
                return
            if abs(p - target) <= 6 or (last is not None and abs(p - last) <= 1 and t > 0.6):
                return
            last = p


def parse_ping(text):
    """'ok P X <steps>[ край] Y <steps>[ край][ путь <n>]' → dict, or None.
    x, y are None without a zero; path is None when no path is running."""
    m = re.match(r"^ok P X (\S+)(?: край)? Y (\S+)(?: край)?(?: путь (\d+))?", text or "")
    if not m:
        return None
    num = lambda v: None if v == "?" else int(v)
    return {"x": num(m.group(1)), "y": num(m.group(2)),
            "path": None if m.group(3) is None else int(m.group(3))}


class Abort(Exception):
    pass


LIVE = ("running", "stopping", "pausing", "paused")   # a run the page must not start over
SWING_DEG = 90                                          # brush off: the wrist to +90° (src/machine.js)
ON_PATH_MM = 0.5                                        # a braked carriage stands on its path


def _near_line(q, a, b):
    ab = (b[0] - a[0], b[1] - a[1])
    L2 = ab[0] ** 2 + ab[1] ** 2
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / L2))
    return math.hypot(q[0] - a[0] - ab[0] * t, q[1] - a[1] - ab[1] * t)


def _near_arc(q, a, c, b, turn):
    # the board's arc: radius from its start, from the start angle to the
    # end's angle, turning from +X towards +Y when turn > 0
    r = math.hypot(a[0] - c[0], a[1] - c[1])
    a0, a1, aq = (math.atan2(p[1] - c[1], p[0] - c[0]) for p in (a, b, q))
    TAU = 2 * math.pi
    sweep = (a1 - a0) % TAU if turn > 0 else -((a0 - a1) % TAU)
    along = (aq - a0) % TAU if turn > 0 else (a0 - aq) % TAU
    if along <= abs(sweep):
        return abs(math.hypot(q[0] - c[0], q[1] - c[1]) - r)
    return min(math.hypot(q[0] - a[0], q[1] - a[1]), math.hypot(q[0] - b[0], q[1] - b[1]))


def rest_of(cmds, j):
    """A move block's commands from its piece j on, with the speed in force
    at that piece first: speeds change inside a pass (a tight arc slower),
    and a pass that goes on after a pause must keep them."""
    rest, speed, k = [], None, -1
    for c in cmds:
        if c == "G":
            continue
        if c[0] in "FT":
            if k < j:
                speed = c
            else:
                rest.append(c)
            continue
        k += 1
        if k >= j:
            rest.append(c)
    return ([speed] if speed else []) + rest + ["G"]


def piece_at(start, path, here, first=0):
    """Which piece of a path (L, M, A commands, the first starting at
    `start`) the carriage stands on, from piece `first` on — where a braked
    pass goes on from. None if it is on none of them."""
    at = start
    for j, c in enumerate(path):
        p = c.split()
        if p[0] in ("L", "M"):
            end = (float(p[1]), float(p[2]))
            d = _near_line(here, at, end)
        else:
            end = (float(p[3]), float(p[4]))
            d = _near_arc(here, at, (float(p[1]), float(p[2])), end, int(p[5]))
        if j >= first and d <= ON_PATH_MM:
            return j
        at = end
    return None


class Runner:
    """Runs the machine blocks of job.json on the board, through the bridge
    (Rubens_v2.md, section 6: the job is run here, not by the page).

    A block is either {"kind": "arm", "cmd": "J 3 <deg>"} — the wrist swings
    the brush off or onto the canvas — or {"kind": "move", "cmds": [...]}: a
    speed (F or T), path pieces (L, A, M) and G. Pieces go to the board until
    its queue is full; then G, and the rest follow as the queue empties. The
    block is over when the ping no longer says "путь". Every command and ping
    feeds the board's watchdog, so a dead runner stops the axes by itself.

    send(path) -> reply is a GET on the bridge; the tests pass a fake board.
    """

    def __init__(self, send, sleep=time.sleep, swing_s=1.8, arm=None):
        self.send, self.sleep, self.swing_s, self.arm = send, sleep, swing_s, arm
        self.lock = threading.Lock()
        self.state, self.message = "idle", ""
        self.blocks, self.block = [], 0
        self.paint_total = self.painted = 0.0
        self.pos = None                  # last ping: {"x", "y", "path"}
        self.started = None              # time.time() of the last start
        self.brush_on = False
        self._stop = None                # None, "S" or "K"
        self._pause = False              # Pause asked for; Continue clears it

    def status(self):
        with self.lock:
            pct = 100.0 * self.painted / self.paint_total if self.paint_total else 0.0
            pos = self.pos or {}
            mm = lambda a, i: None if pos.get(a) is None else pos[a] / STEPS_PER_MM[i]
            return {"state": self.state, "message": self.message, "block": self.block,
                    "blocks": len(self.blocks), "painted_mm": round(self.painted, 1),
                    "paint_mm": round(self.paint_total, 1), "percent": round(pct, 1),
                    "x_mm": mm("x", 0), "y_mm": mm("y", 1), "brush_on": self.brush_on,
                    "started": self.started}

    def start(self, blocks):
        with self.lock:
            if self.state in LIVE:
                return False, "already running"
            self.blocks, self.block, self.painted = list(blocks), 0, 0.0
            self.paint_total = sum(b.get("paintMM") or 0 for b in blocks if b.get("kind") == "move")
            self.state, self.message, self._stop, self._pause = "running", "", None, False
            self.started = time.time()
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()
        return True, "started"

    def stop(self, hard=False):
        # A stop is never refused and never depends on what the runner thinks
        # is going on: the board always gets it. (2026-09-27: HARD STOP after
        # STOP did nothing, because STOP had already moved the state on.)
        with self.lock:
            if self.state in LIVE:
                self._stop = "K" if hard else "S"
                self.state = "stopping"
        return self.send("/cmd?a=K&n=0" if hard else "/cmd?a=S&n=0")

    def board_stopped(self, hard=False):
        # A STOP or HARD STOP sent to the board by a page, not through the
        # runner (the Calibration tab): the board stops, and the runner must
        # not take the end of the path for the end of a block and send the
        # next one. The command itself goes on to the board as it is.
        with self.lock:
            if self.state in LIVE:
                if hard or self._stop != "K":
                    self._stop = "K" if hard else "S"
                self.state = "stopping"

    def pause(self):
        # Pause (the owner, 2026-09-28: a pencil gone blunt, to be sharpened
        # without starting the job over). On a pass the carriage brakes on
        # its line and the brush leaves the canvas; elsewhere the step in
        # hand ends first. STOP and HARD STOP work while paused.
        with self.lock:
            if self.state != "running":
                return False
            self._pause, self.state = True, "pausing"
        return True

    def resume(self):
        with self.lock:
            if self.state not in ("pausing", "paused"):
                return False
            self._pause, self.state = False, "running"
        return True

    # ---- the run ----
    def run(self):
        try:
            p = self._ping()
            if p is None or p["x"] is None or p["y"] is None:
                raise Abort("no zero on the axes: set home on the Calibration tab")
            # Before anything moves, even the brush: can the board run a path?
            # A speed command changes nothing on the canvas; the pendant
            # firmware and the old bridge do not know it.
            probe = next((c for b in self.blocks if b.get("kind") == "move" for c in b["cmds"][:1]), "T 100")
            r = self._raw(probe)
            if not r.startswith("ok "):
                raise Abort("the board cannot run a path yet (" + r + "): apply bridge.patch and flash "
                            "the pass firmware, RAIL-drawing_machine/drafts/rubens-pass")
            if self.arm:
                try:
                    self.arm.hold()     # nothing moves; the whole arm holds from here on
                except ArmError as e:
                    raise Abort(str(e))
            for i, b in enumerate(self.blocks):
                if self._stop:
                    break
                if self._pause and not self._hold():
                    break
                with self.lock:
                    self.block = i
                if b["kind"] == "arm":
                    self._arm(b["cmd"])
                else:
                    self._move(b)
            with self.lock:
                self.state = "stopped" if self._stop else "done"
                if self._stop and self.brush_on:
                    self.message = "stopped with the brush on the canvas"
        except Abort as e:
            self.send("/cmd?a=S&n=0")
            with self.lock:
                self.state, self.message = "error", str(e)

    def _ping(self):
        p = parse_ping(self.send("/ping"))
        with self.lock:
            self.pos = p
        if p and p["x"] is not None and p["y"] is not None:
            for i, v in enumerate((p["x"], p["y"])):
                lo, hi = WALLS_MM[i]
                mm = v / STEPS_PER_MM[i]
                if mm < lo - RUNAWAY_MM or mm > hi + RUNAWAY_MM:
                    self.send("/cmd?a=K&n=0")
                    raise Abort(f"runaway: {'XY'[i]} at {mm:.1f} mm, past the wall — HARD STOP sent")
        return p

    def _wait(self, seconds):
        # waiting also pings, five times a second, like the pages
        t = 0.0
        while t < seconds and not self._stop:
            self.sleep(0.2)
            t += 0.2
            self._ping()

    def _arm(self, cmd):
        deg = int(cmd.split()[2])
        if self.arm:
            # in RUBENS's degrees, from where the wrist really is (class Arm)
            try:
                self.arm.move_to("wrist", deg)
            except ArmError as e:
                raise Abort(f"{cmd}: {e}")
            self.brush_on = deg == 0
            self._ping()
            return
        r = self.send(f"/servo?j=wrist&d={deg}")
        if not r.startswith("ok J"):
            raise Abort(f"{cmd}: {in_english(r)}")
        self.brush_on = deg == 0
        self._wait(self.swing_s)

    def _raw(self, cmd):
        return self.send("/raw?c=" + quote(cmd))

    def _go(self):
        # False: nothing to run — every piece was too short to queue (a travel
        # to where the carriage already is)
        r = self._raw("G")
        if "очередь пуста" in r:
            return False
        if r != "ok G":
            raise Abort(f"G: {in_english(r)}")
        return True

    def _move(self, b):
        pieces = [c for c in b["cmds"] if c != "G"]
        total = sum(1 for c in pieces if c[0] in "LAM")
        base, share = self.painted, b.get("paintMM") or 0
        # A pass (brush on) can be paused on its line; a travel ends first.
        pausable = self.brush_on and any(c[0] == "F" for c in pieces)
        start = self._here() if pausable else None
        started, sent = False, 0
        for c in pieces:
            while True:
                if self._stop:
                    return self._finish(started)
                if pausable and started and self._pause:
                    return self._brake(b, start, sent, base)
                r = self._raw(c)
                if r.startswith("ok "):
                    break
                if "очередь полна" in r:
                    if not started:
                        started = self._go()
                    self._wait(0.1)
                    continue
                raise Abort(f"{c}: {in_english(r)}")
            if c[0] in "LAM":
                sent += 1
                room = int(r.split()[-1])
                if room == 0 and not started:
                    started = self._go()
        if not started:
            started = self._go()
        if not self._finish(started, base, share, sent, total, pausable):
            return self._brake(b, start, sent, base)
        if not self._stop:
            self._arrived(b)

    def _here(self):
        p = self._ping()
        if p is None or p["x"] is None or p["y"] is None:
            raise Abort("lost the board")
        return p["x"] / STEPS_PER_MM[0], p["y"] / STEPS_PER_MM[1]

    def _brake(self, b, start, sent, base):
        # Pause on a pass: brake on the line (S keeps the X driver well; K may
        # not), find the piece the carriage stands on, hold with the brush off,
        # then run the rest of the pass from right there: a piece sent again
        # from a point on it goes on to its own end.
        queued = (self.pos or {}).get("path") or 0
        self.send("/cmd?a=S&n=0")
        while not self._stop:
            p = self._ping()
            if p is None:
                raise Abort("lost the board")
            if p["path"] is None:
                break
            self.sleep(0.1)
        self._wait(0.4)
        if self._stop:
            return
        path = [c for c in b["cmds"] if c[0] in "LAM"]
        here = self._here()
        j = piece_at(start, path, here, first=max(0, sent - queued - 1))
        if j is None:
            self.send("/cmd?a=K&n=0")
            raise Abort(f"paused off the path, at X {here[0]:.1f} Y {here[1]:.1f}: HARD STOP sent")
        if not self._hold():
            return
        left = max(0.0, (b.get("paintMM") or 0) - (self.painted - base))
        self._move({"kind": "move", "cmds": rest_of(b["cmds"], j), "paintMM": left})

    def _hold(self):
        # Paused: the brush off the canvas, the motors still, the watchdog fed
        # by the pings. Continue puts the brush back as it was.
        was_on = self.brush_on
        if was_on:
            self._arm(f"J 3 {SWING_DEG}")
        with self.lock:
            if self._pause and not self._stop:
                self.state = "paused"
        while self._pause and not self._stop:
            self.sleep(0.2)
            self._ping()
        if self._stop:
            return False
        if was_on:
            self._arm("J 3 0")
        return True

    def _arrived(self, b):
        # Before the next block — above all before the brush goes down — the
        # carriage must be where this one ends.
        end = block_end(b["cmds"])
        if end is None:
            return
        p = self._ping()
        if p is None or p["x"] is None or p["y"] is None:
            raise Abort("lost the board")
        x, y = p["x"] / STEPS_PER_MM[0], p["y"] / STEPS_PER_MM[1]
        if math.hypot(x - end[0], y - end[1]) > ARRIVAL_MM:
            self.send("/cmd?a=K&n=0")
            raise Abort(f"the carriage did not get there: X {x:.1f} Y {y:.1f} mm instead of "
                        f"X {end[0]:.1f} Y {end[1]:.1f}. The board stopped the path itself "
                        "(a restart of the board clears it). HARD STOP sent")

    def _finish(self, started, base=None, share=0, sent=0, total=0, pausable=False):
        # the block is over when the board no longer reports a path; False:
        # a pause came first, the path is still running
        while started:
            p = self._ping()
            if p is None:
                raise Abort("lost the board")
            if p["path"] is None:
                break
            if pausable and self._pause and not self._stop:
                return False
            if base is not None and total:
                with self.lock:
                    self.painted = base + share * max(0, sent - p["path"]) / total
            self.sleep(0.2)
        if started:
            # the flag can drop while the motors still run the last queued
            # slices (older firmware): give them a moment before the arm moves
            self._wait(0.4)
        if base is not None and not self._stop:
            with self.lock:
                self.painted = base + share
        return True


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2)
    os.replace(tmp, path)


class Park:
    """Where the carriage stood when the motors were shut down, so the zero
    lives through the 12 V going off. The owner, 2026-09-28: the carriage and
    the arm on it do not move at night; the motors wake up where they fell
    asleep. One button before power-off (shut_down), one after power-on
    (restore).

    The place is good for one zero only. Restoring it, setting home at the
    stops, a jog or a job — anything that moves the carriage or sets a zero
    through rubens.py — uses it up, so a place from an older evening is never
    put back after a power-off without Shut down.
    """

    def __init__(self, path, send, sleep=time.sleep):
        self.path, self.send, self.sleep = path, send, sleep

    def read(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def forget(self):
        p = self.read()
        if p and not p.get("used"):
            p["used"] = True
            write_json(self.path, p)

    def shut_down(self, runner):
        # HARD STOP first, whatever is running: a stop is never refused.
        r = runner.stop(hard=True)
        if r == "no bridge":
            return False, "No bridge: the motors were not reached, nothing saved.", None
        prev = None
        for _ in range(15):
            self.sleep(0.2)
            p = parse_ping(self.send("/ping"))
            if p is None:
                return False, "No answer from the board: nothing saved.", None
            if p["x"] is None or p["y"] is None:
                return False, ("Motors stopped. No zero on the axes, so there is nothing to remember: "
                               "after power-on find home at the stops."), None
            if prev and p["path"] is None and (p["x"], p["y"]) == (prev["x"], prev["y"]):
                park = {"x": p["x"], "y": p["y"], "at": time.strftime("%Y-%m-%d %H:%M:%S"), "used": False}
                write_json(self.path, park)
                return True, "Motors stopped, the place is saved. Now switch off the 12 V.", park
            prev = p
        return False, "The carriage does not stand still: nothing saved.", None

    def restore(self):
        park = self.read()
        if not park or park.get("used"):
            return False, "No parked place: find home at the stops.", park
        p = parse_ping(self.send("/ping"))
        if p is None:
            return False, "No answer from the board.", park
        if p["x"] is not None or p["y"] is not None:
            return False, "The board already has a zero: nothing changed.", park
        rx = self.send(f"/origin/x?at={park['x']}")
        ry = self.send(f"/origin/y?at={park['y']}")
        ok_x, ok_y = rx.startswith("ok O"), ry.startswith("ok O")
        if not ok_x and not ok_y:
            return False, f"Not restored ({rx} · {ry}).", park
        park["used"] = True
        write_json(self.path, park)
        if ok_x and ok_y:
            return True, "The parked place is back: the walls are on.", park
        axis = "Y" if ok_x else "X"
        return False, f"Only {'X' if ok_x else 'Y'} restored: find {axis} home at its stop.", park


def bridge_get(path):
    try:
        with urlopen(BRIDGE + path, timeout=3) as r:
            return r.read().decode("utf-8", "replace").strip()
    except HTTPError as e:
        return f"bridge answers {e.code} to {urlparse(path).path}"
    except (URLError, OSError):
        return "no bridge"


def arm_zero():
    try:
        with open(FILES["/calibration"], encoding="utf-8") as f:
            z = json.load(f).get("arm") or {}
        return {k: int(z.get(k, v)) for k, v in ARM_ZERO.items()}
    except (OSError, ValueError, TypeError):
        return dict(ARM_ZERO)


ARM = Arm(bridge_get, arm_zero)
RUNNER = Runner(bridge_get, arm=ARM)
PARK = Park(PARK_FILE, bridge_get)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def log_message(self, *args):
        pass  # the page pings five times a second

    def end_headers(self):
        # Always the files on disk: no stale modules after an edit.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, code, body, ctype="text/plain; charset=utf-8", board=None):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        if board:
            self.send_header("X-Board", board)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path.startswith("/machine/"):
            return self.machine(u)
        if u.path == "/run":
            return self.reply(200, json.dumps(RUNNER.status()), "application/json")
        if u.path == "/park":
            return self.reply(200, json.dumps(PARK.read() or {}), "application/json")
        if u.path == "/arm":
            ang, raw = ARM.angles()
            return self.reply(200, json.dumps({"angles": ang, "raw": raw, "zero": arm_zero()}), "application/json")
        if u.path in FILES:
            if not os.path.exists(FILES[u.path]):
                return self.reply(200, "{}", "application/json")
            with open(FILES[u.path], "rb") as f:
                return self.reply(200, f.read(), "application/json")
        return super().do_GET()

    def machine(self, u):
        cmd = u.path[len("/machine"):]
        if cmd not in PASS:
            return self.reply(403, "not passed to the machine")
        q = parse_qs(u.query)
        if cmd == "/cmd" and q.get("a", [""])[0] in ("S", "K"):
            RUNNER.board_stopped(hard=q["a"][0] == "K")
        if cmd in ("/origin/x", "/origin/y") or (
                cmd == "/cmd" and q.get("a", [""])[0] in ("X", "Y") and q.get("n", ["0"])[0] != "0"):
            PARK.forget()   # a new zero or a jog: the parked place is no longer where the carriage is
        url = BRIDGE + cmd + ("?" + u.query if u.query else "")
        try:
            with urlopen(url, timeout=3) as r:
                return self.reply(200, r.read(), board=r.headers.get("X-Board", "ok"))
        except (URLError, OSError):
            return self.reply(502, "no bridge", board="none")

    def do_POST(self):
        path = urlparse(self.path).path
        if path in ("/brush/off", "/brush/on"):
            if RUNNER.state in LIVE:
                return self.reply(409, "a job is running")
            deg = SWING_DEG if path == "/brush/off" else 0
            try:
                ARM.move_to("wrist", deg)
            except ArmError as e:
                return self.reply(200, str(e))
            RUNNER.brush_on = deg == 0
            return self.reply(200, f"ok J 3 {deg}")
        if path == "/arm":
            # the arm jog of the Calibration tab: a joint to an angle, in
            # RUBENS's degrees (class Arm); not while a job runs
            if RUNNER.state in LIVE:
                return self.reply(409, "a job is running")
            q = parse_qs(urlparse(self.path).query)
            jn = q.get("j", [""])[0]
            if jn not in JOINTS:
                return self.reply(400, "which joint?")
            try:
                got = ARM.move_to(jn, float(q.get("d", ["0"])[0]))
            except (ArmError, ValueError) as e:
                return self.reply(200, json.dumps({"ok": False, "message": str(e)}), "application/json")
            if jn == "wrist":
                RUNNER.brush_on = abs(got) < 1
            return self.reply(200, json.dumps({"ok": True, "angle": got}), "application/json")
        if path == "/run/stop":
            return self.reply(200, RUNNER.stop())
        if path == "/run/kill":
            return self.reply(200, RUNNER.stop(hard=True))
        if path in ("/run/pause", "/run/continue"):
            ok = RUNNER.pause() if path == "/run/pause" else RUNNER.resume()
            return self.reply(200 if ok else 409, "ok" if ok else f"not now: the runner is {RUNNER.state}")
        if path in ("/shutdown", "/restore"):
            ok, msg, park = PARK.shut_down(RUNNER) if path == "/shutdown" else PARK.restore()
            return self.reply(200, json.dumps({"ok": ok, "message": msg, "park": park}), "application/json")
        if path != "/run":
            return self.reply(404, "")
        if not RUNS_ENABLED:
            return self.reply(503, "runs are off: the pass firmware is being fixed after a diagonal pass ran the Y axis away (2026-09-27)")
        # A body {"blocks": [...]} runs those blocks (a calibration run, such
        # a calibration run); no body runs the machine blocks of job.json.
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        try:
            if body:
                blocks = json.loads(body)["blocks"]
            else:
                with open(FILES["/job"], encoding="utf-8") as f:
                    blocks = json.load(f)["machine"]["blocks"]
            if not isinstance(blocks, list) or not blocks:
                raise ValueError
        except (OSError, ValueError, KeyError, TypeError):
            return self.reply(400, "no machine blocks: record the canvas corners, then Save job.json")
        ok, msg = RUNNER.start(blocks)
        if ok:
            PARK.forget()
        return self.reply(200 if ok else 409, msg)

    def do_PUT(self):
        path = FILES.get(urlparse(self.path).path)
        if not path:
            return self.reply(404, "")
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            json.loads(body)
        except ValueError:
            return self.reply(400, "not JSON")
        if path == FILES["/calibration"]:
            # The Calibration tab saves the corners it loaded; one opened
            # before the arm zero was written would drop it. Keep it.
            new = json.loads(body)
            try:
                with open(path, encoding="utf-8") as f:
                    old = json.load(f)
            except (OSError, ValueError):
                old = {}
            if "arm" not in new and "arm" in old:
                new["arm"] = old["arm"]
                body = json.dumps(new, indent=2).encode("utf-8")
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, path)
        return self.reply(200, "saved")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"RUBENS: http://localhost:{PORT}  (machine bridge: {BRIDGE})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
