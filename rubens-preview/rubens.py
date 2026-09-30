#!/usr/bin/env python3
"""RUBENS server: serves this folder on http://localhost:8766 and talks to
the machine on USB (Rubens_v2.md, section 6). One program, one address:
since 2026-09-29 it owns the serial port itself (class Board); before, the
bridge.py of the old machine repo held it on port 8765.

- Static files: the Create page (index.html), Calibration (calibration.html)
  and Job (job.html).
- /machine/<command> goes to the board (board_line: the page's address →
  the board's line). Only the commands in PASS get through: the ping, the
  look, the axes, and the axis zero. The arm is not among them.
- /calibration and /job: GET returns calibration.json / job.json, PUT saves
  it. The Job tab writes job.json — the job in mm, in the order it runs.
- /library: the Library tab's drawings (library/, on this Mac only). GET is
  the list, newest first; POST {svg, png} saves a new drawing named by the
  time (💾 SAVE on the Create tab); GET /library/<name>.svg|.png gives one;
  DELETE /library/<name> moves it to library/.deleted/.
- /arm: GET the arm in RUBENS's degrees (0° = the working pose); POST
  /arm?j=<joint>&d=<deg> moves one joint there (class Arm). /brush/off and
  /brush/on go through it too.
- /park (GET), POST /shutdown and /restore: the place where the carriage
  stood when the motors were shut down, put back after power-on (class Park).
- /run: the runner (class Runner) — GET is its state; POST starts the machine
  blocks of job.json, or the blocks in its body (a calibration run); POST /run/stop brakes along the path, /run/kill stops at
  once; /run/pause and /run/continue pause a run and go on from the same point. POST /brush/off and /brush/on swing the wrist to −54° or back to 0° (never past +10°: REACH)
  (only the wrist, only these two, not while a job runs — the owner asked for
  them on the Job tab, 2026-09-27). A board without the pass firmware
  (../firmware/CNCDM-001) fails a start on the first path command, and
  nothing moves.

Run:  python3 rubens.py   (needs pyserial for the board)
Listens on this Mac only: the machine is driven from here, not from the
network.
"""

import base64
import glob
import json
import math
import os
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8766
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


# ---------- the board, on USB ----------
# The board speaks lines: one command, one reply. What was bridge.py's (the
# old machine repo, 2026-09-20…29), in the same words, now here.
PORT_GLOB = "/dev/cu.usbserial-*"
BAUD = 115200
AXIS_LIMIT = {"X": 20, "Y": 9}   # jog levels, 10 mm/s each (X_LEVEL_MAX, Y_LEVEL_MAX in the firmware)
PATH_LETTERS = "FTLAMG"          # speeds, path pieces, go: the only lines /raw lets through


def board_line(path):
    """A machine address → (the line for the board, seconds to wait for its
    reply). ValueError with the reply when the address is refused."""
    u = urlparse(path)
    q = parse_qs(u.query)
    p = u.path
    if p == "/ping":
        return "P", 0.25
    if p == "/look":
        return "V", 2.0              # a silent servo answers by its own timeout, and there are three
    if p == "/cmd":
        a = (q.get("a", ["S"])[0] or "S").upper()[0]
        if a in ("S", "K"):          # stop braking; stop at once
            return a, 0.25
        if a in AXIS_LIMIT:
            try:
                level = max(-AXIS_LIMIT[a], min(AXIS_LIMIT[a], int(q.get("n", ["0"])[0])))
            except ValueError:
                level = 0
            return f"{a} {level}", 0.25
        raise ValueError("?")
    if p == "/zero":                 # the arm's zero where it stands: nothing moves
        return "Z", 0.25
    if p in ("/origin/x", "/origin/y"):   # the carriage's place becomes the axis zero, or ?at=<steps>
        try:
            at = int(q.get("at", ["0"])[0])
        except ValueError:
            raise ValueError("? at")
        return f"O {p[-1].upper()} {at}", 0.25
    if p == "/raw":
        # the pass: a speed, a piece of path, go — the line as it is, but only
        # with these letters and no control characters: no arm, jog or zero
        line = q.get("c", [""])[0]
        if (not line or len(line) > 60 or line[0].upper() not in PATH_LETTERS
                or any(ord(ch) < 32 for ch in line)):
            raise ValueError("? raw")
        return line, 0.25
    if p == "/servo":
        joint = q.get("j", ["?"])[0]
        if joint not in JOINTS:
            raise ValueError("? joint")
        jid, _, lim = JOINTS[joint]   # the firmware's degrees: its sign is its own
        try:
            deg = max(-lim, min(lim, int(q.get("d", ["0"])[0])))
        except ValueError:
            deg = 0
        return f"J {jid} {deg}", 0.25
    raise ValueError(f"? {p}")


def pyserial(port):
    import serial                    # pyserial: the server needs it, the tests do not
    return serial.Serial(port, BAUD, timeout=0.2, write_timeout=0.3)


class Board:
    """The serial port. Opens the first /dev/cu.usbserial-*, and keeps
    looking while there is none or it drops (the USB pulled, the board reset,
    the 12 V switched): the server runs without a board all the same.

    open_port(name) is pyserial's Serial; the tests pass a fake.
    """

    def __init__(self, open_port=pyserial, ports=lambda: sorted(glob.glob(PORT_GLOB)),
                 sleep=time.sleep, log=lambda s: print(s, flush=True)):
        self.open_port, self.ports, self.sleep, self.log = open_port, ports, sleep, log
        self.ser, self.last, self.seen = None, "", 0
        self.lock = threading.Lock()

    def start(self):
        if not self.open():
            self.log(f"no board at {PORT_GLOB} — waiting for one")
        threading.Thread(target=self._reader, daemon=True).start()

    def open(self):
        ports = self.ports()
        if not ports:
            return False
        try:
            ser = self.open_port(ports[0])
            # No reset at every opening. The order matters: RTS without DTR
            # is the board's reset (the upload resets it so). DTR used to go
            # first, and the board rebooted at every start of the bridge and
            # forgot the axis zero (found 2026-09-23).
            ser.setRTS(False)
            ser.setDTR(False)
        except Exception as e:
            self.log(f"{ports[0]} did not open: {e}")
            return False
        self.ser = ser
        self.log(f"board: {ports[0]}")
        return True

    def drop(self, why):
        try:
            self.ser.close()
        except Exception:
            pass
        self.ser = None
        self.log(f"board lost: {why}")

    def _reader(self):
        while True:
            if self.ser is None:
                self.sleep(2.0)
                self.open()
                continue
            try:
                line = self.ser.readline()
                if line:
                    self.last = line.decode("utf-8", "replace").strip()
                    self.seen += 1
            except Exception as e:
                self.drop(e)

    def send(self, text, wait=0.25):
        # The lock holds through the wait for the reply too: one command, one
        # reply, or a page's ping could slip in and take another command's
        # reply — a piece of path lost or sent twice is a bent line on the
        # canvas (2026-09-27).
        if self.ser is None:
            return "no board"
        with self.lock:
            try:
                was = self.seen
                self.ser.write((text + "\n").encode())
            except Exception as e:
                self.drop(e)
                return "no board"
            t0 = time.time()
            while self.seen == was and time.time() - t0 < wait:
                time.sleep(0.005)
            return self.last


BOARD = None   # the Board once the server runs (__main__); nothing opens a port on import


def board_get(path):
    """What the pages, the arm and the runner send: a machine address, and
    the board's reply."""
    try:
        line, wait = board_line(path)
    except ValueError as e:
        return str(e)
    if BOARD is None:
        return "no board"
    return BOARD.send(line, wait)


# The arm (../firmware/CNCDM-001/src/main.cpp: JOINT_ID, JOINT_SIGN,
# JOINT_LIMIT): servo id, the firmware's sign, limit in degrees.
JOINTS = {"shoulder": (1, -1, 45), "elbow": (2, +1, 45), "wrist": (3, +1, 90)}
# RUBENS's degrees against the firmware's. Plus is the brush to the right
# for the shoulder as for the elbow (the owner, 2026-09-29: the shoulder
# stands face down, and the pose that reaches the right edge read −15.5°).
# The firmware's −1 for the shoulder was meant to give just that ("right
# plus everywhere"), yet on the machine its minus goes right, as on the MELNICOMM
# pendant (images_CNC_drawing_machine/servo direction.png). RUBENS turns it
# round; once the firmware is flashed with its sign put right, this is +1.
# The wrist: minus left, plus right, as on the pendant.
TURN = {"shoulder": -1, "elbow": +1, "wrist": +1}
# How far RUBENS lets each joint go, in its own degrees. The firmware's
# JOINT_LIMIT is wider (the wrist ±90°) and is not trusted with this: every
# joint move goes through Arm.move_to, and it refuses anything outside.
# The wrist: a USB camera on the holder (2026-09-30, photos
# images_CNC_drawing_machine/photo_2026-09-30 00.42.*) is in the way past
# +10°, clockwise — the owner: "the arm would break the camera". The brush
# now leaves the canvas at −54°, the other way (SWING_DEG; it was +90°).
# Degrees from the brush upright: the wrist's zero was set there the same
# night (it had been 9.4° off), and +10° from upright is the owner's canon;
# −54° is the brush-off pose he found safe (it read −45° on the old zero).
REACH = {"shoulder": (-45, 45), "elbow": (-45, 45), "wrist": (-90, 10)}
TICKS_PER_DEG = 4096 / 360
# The working pose, raw servo poses (4096 a turn). calibration.json "arm" is
# the one in use; this is its copy for when the file has none. 2026-09-28,
# late: the owner set the arm to the middle of the field with the handles —
# the elbow 24.6° from the pose of the evening before (2501 · 1759 · 1489).
ARM_ZERO = {"shoulder": 2498, "elbow": 2039, "wrist": 1599}   # the wrist: the brush upright, 2026-09-30


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
            out[k] = None if jid not in raw else round(TURN[k] * sign * (raw[jid] - z[k]) / TICKS_PER_DEG, 1)
        return out, raw

    def move_to(self, joint, deg):
        jid, sign, lim = JOINTS[joint]
        lo, hi = REACH[joint]
        if not lo <= deg <= hi:
            raise ArmError(f"the {joint} may go {lo}…+{hi}° only, not {deg:+g}°"
                           + (": the camera is in the way past +10°" if joint == "wrist" else ""))
        with self.lock:
            for _ in range(6):
                ang, raw = self.angles()
                if ang[joint] is None:
                    raise ArmError(f"the {joint} does not answer: is the 12 V on?")
                a = ang[joint]
                d = deg - a
                # whole degrees from where it stands, and no step past the reach
                step = round(d)
                step = min(step, math.floor(hi - a + 1e-9)) if step > 0 else max(step, math.ceil(lo - a - 1e-9))
                step = max(-lim, min(lim, step))
                if abs(d) < 0.6 or step == 0:
                    return a
                r = self.send("/zero")
                if not r.startswith("ok Z"):
                    raise ArmError(f"arm zero: {in_english(r)}")
                fw = TURN[joint] * step                    # the firmware's degrees
                r = self.send(f"/servo?j={joint}&d={fw}")
                if not r.startswith("ok J"):
                    raise ArmError(f"{joint}: {in_english(r)}")
                self._settle(jid, raw[jid] + sign * fw * TICKS_PER_DEG)
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
SWING_DEG = -54                                         # brush off: the wrist to −54° (src/machine.js; +90° until the camera, 2026-09-30)
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


def path_pieces(start, path):
    """The pieces of a path (L, M, A commands, the first from `start`) as the
    board runs them: start, end, length in mm; an arc's radius from its
    start, its sweep from the start angle to the end's (firmware path.h)."""
    TAU = 2 * math.pi
    out, at = [], start
    for c in path:
        p = c.split()
        if p[0] in ("L", "M"):
            end = (float(p[1]), float(p[2]))
            out.append({"a": at, "b": end, "len": math.hypot(end[0] - at[0], end[1] - at[1])})
        else:
            cen, end, turn = (float(p[1]), float(p[2])), (float(p[3]), float(p[4])), int(p[5])
            r = math.hypot(at[0] - cen[0], at[1] - cen[1])
            a0 = math.atan2(at[1] - cen[1], at[0] - cen[0])
            s = math.atan2(end[1] - cen[1], end[0] - cen[0]) - a0
            if turn > 0:
                while s <= 0:
                    s += TAU
                while s > TAU:
                    s -= TAU
            else:
                while s >= 0:
                    s -= TAU
                while s < -TAU:
                    s += TAU
            out.append({"a": at, "b": end, "c": cen, "r": r, "a0": a0, "sweep": s, "len": abs(s) * r})
        at = end
    return out


def along_piece(pc, q):
    """How far along a piece (path_pieces) the point q is, mm, held to the piece."""
    if "c" not in pc:
        (ax, ay), (bx, by), L = pc["a"], pc["b"], pc["len"]
        if L == 0:
            return 0.0
        return max(0.0, min(1.0, ((q[0] - ax) * (bx - ax) + (q[1] - ay) * (by - ay)) / (L * L))) * L
    TAU = 2 * math.pi
    ang = math.atan2(q[1] - pc["c"][1], q[0] - pc["c"][0])
    d = (ang - pc["a0"]) % TAU if pc["sweep"] > 0 else (pc["a0"] - ang) % TAU
    S = abs(pc["sweep"])
    if d > S:                                    # just before the start, or past the end
        d = 0.0 if d > (S + TAU) / 2 else S
    return d * pc["r"]


def painted_so_far(track, done, here):
    """The painted length of a block by now, mm: the pieces the board has run
    whole, and on the piece it is running, how far along it the carriage is.
    track: (pieces, painted length of each — 0 for a turn —, their sum)."""
    geo, plen, _ = track
    done = max(0, min(len(geo), done))
    got = sum(plen[:done])
    if done < len(geo) and plen[done] and here is not None:
        got += min(plen[done], along_piece(geo[done], here))
    return got


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
    """Runs the machine blocks of job.json on the board (Rubens_v2.md,
    section 6: the job is run here, not by the page).

    A block is either {"kind": "arm", "cmd": "J 3 <deg>"} — the wrist swings
    the brush off or onto the canvas — or {"kind": "move", "cmds": [...]}: a
    speed (F or T), path pieces (L, A, M) and G. Pieces go to the board until
    its queue is full; then G, and the rest follow as the queue empties. The
    block is over when the ping no longer says "путь". Every command and ping
    feeds the board's watchdog, so a dead runner stops the axes by itself.

    send(path) -> reply is board_get, a machine address; the tests pass a
    fake board.
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
        # A job saved before the camera (2026-09-30) swings the brush off to
        # +90°: refuse the whole job before anything is sent.
        lo, hi = REACH["wrist"]
        for b in blocks:
            if b.get("kind") == "arm" and not lo <= int(b["cmd"].split()[2]) <= hi:
                return False, (f"{b['cmd']}: the wrist may go {lo}…+{hi}° only, the camera is in the way. "
                               "This job.json is from before the camera: Save job.json again on the Job tab.")
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
            # firmware did not know it.
            probe = next((c for b in self.blocks if b.get("kind") == "move" for c in b["cmds"][:1]), "T 100")
            r = self._raw(probe)
            if not r.startswith("ok "):
                raise Abort("the board cannot run a path (" + r + "): flash the firmware, "
                            "firmware/CNCDM-001")
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
        lo, hi = REACH["wrist"]
        if not lo <= deg <= hi:                        # the camera (2026-09-30); Arm.move_to refuses it too
            raise Abort(f"{cmd}: the wrist may go {lo}…+{hi}° only: the camera is in the way past +10°")
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
        base, share = self.painted, b.get("paintMM") or 0
        # A pass (brush on) can be paused on its line; a travel ends first.
        pausable = self.brush_on and any(c[0] == "F" for c in pieces)
        start = self._here() if pausable or share else None
        # The percent goes by painted length (job.json marks each piece
        # painted or a turn; without the marks every piece counts).
        track = None
        if share and start:
            geo = path_pieces(start, [c for c in pieces if c[0] in "LAM"])
            marks = b.get("painted") or []
            plen = [g["len"] if (marks[i] if i < len(marks) else 1) else 0.0 for i, g in enumerate(geo)]
            if sum(plen) > 0:
                track = (geo, plen, sum(plen))
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
                    self._progress(base, share, sent, track)
                    continue
                raise Abort(f"{c}: {in_english(r)}")
            if c[0] in "LAM":
                sent += 1
                room = int(r.split()[-1])
                if room == 0 and not started:
                    started = self._go()
        if not started:
            started = self._go()
        if not self._finish(started, base, share, sent, track, pausable):
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
        self._move({"kind": "move", "cmds": rest_of(b["cmds"], j), "paintMM": left,
                    "painted": (b.get("painted") or [])[j:]})

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

    def _progress(self, base, share, sent, track):
        # What the block has painted by the last ping, by length: the pieces
        # the board has run (those sent less those still queued), and on the
        # piece it is running, how far along it the carriage is. Counted also
        # while the rest is still being sent (a Brush lane stood at 0 %,
        # 2026-09-28). By counting pieces the percent stood still for the
        # whole of a long line and jumped at its end (2026-09-30: 89.5 % shown
        # with the carriage at 92.8 %).
        pos = self.pos or {}
        queued = pos.get("path")
        if not track or queued is None:
            return
        here = None if pos.get("x") is None or pos.get("y") is None else \
            (pos["x"] / STEPS_PER_MM[0], pos["y"] / STEPS_PER_MM[1])
        got = painted_so_far(track, sent - queued, here) / track[2]
        with self.lock:
            self.painted = max(self.painted, base + share * got)

    def _finish(self, started, base=None, share=0, sent=0, track=None, pausable=False):
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
            if base is not None:
                self._progress(base, share, sent, track)
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


# ---------- the Library: the drawings saved from the Create tab ----------
# The owner, 2026-09-30: every 💾 SAVE is a new drawing, named by the date and
# time ("2026-09-30 01:15"); an older one stays as it was. The drawings are
# the owner's own work: they live on this Mac only, not in git (library/ is
# ignored). A drawing is two files: <name>.svg — the drawing with its whole
# state, as Export SVG writes it — and <name>.png, its preview. The file name
# has "01-15" for "01:15" (a colon is no good in a file name on a Mac).
# Deleting moves both into library/.deleted/, so nothing is lost by a slip.
LIBRARY_DIR = os.path.join(HERE, "library")
LIBRARY_NAME = re.compile(r"^\d{4}-\d\d-\d\d \d\d-\d\d(?: \((\d+)\))?$")
PNG_DATA = "data:image/png;base64,"


def library_display(base):
    """'2026-09-30 01-15 (2)' → '2026-09-30 01:15 (2)'."""
    return base[:13] + ":" + base[14:]


def library_list(folder):
    """The saved drawings, newest first: name, file name, format, strokes."""
    out = []
    try:
        names = os.listdir(folder)
    except OSError:
        return out
    for f in names:
        base, ext = os.path.splitext(f)
        if ext != ".svg" or not LIBRARY_NAME.match(base):
            continue
        info = {"file": base, "name": library_display(base), "format": None, "strokes": None,
                "png": os.path.exists(os.path.join(folder, base + ".png"))}
        try:
            with open(os.path.join(folder, f), encoding="utf-8") as fh:
                m = re.search(r'<metadata id="rubens-state">(.*?)</metadata>', fh.read(), re.S)
            if m:
                st = json.loads(m.group(1).replace("- -", "--"))
                info["format"], info["strokes"] = st.get("format"), len(st.get("paths") or [])
        except (OSError, ValueError):
            pass
        out.append(info)
    # newest first: the name is the time; "(2)" is later than none, "(10)" than "(9)"
    key = lambda i: (i["file"][:16], int((LIBRARY_NAME.match(i["file"]).group(1)) or 1))
    return sorted(out, key=key, reverse=True)


def library_save(folder, svg, png, now=None):
    """Save a drawing under a new name from the time; returns the file name.
    ValueError when it is not a RUBENS drawing."""
    if not isinstance(svg, str) or "<svg" not in svg or 'id="rubens-state"' not in svg:
        raise ValueError("not a RUBENS drawing")
    if not isinstance(png, str) or not png.startswith(PNG_DATA):
        raise ValueError("no preview")
    image = base64.b64decode(png[len(PNG_DATA):], validate=True)
    os.makedirs(folder, exist_ok=True)
    stem = time.strftime("%Y-%m-%d %H-%M", time.localtime(now))
    base, n = stem, 1
    while os.path.exists(os.path.join(folder, base + ".svg")):
        n += 1
        base = f"{stem} ({n})"
    with open(os.path.join(folder, base + ".png"), "wb") as f:
        f.write(image)
    tmp = os.path.join(folder, base + ".svg.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(svg)
    os.replace(tmp, os.path.join(folder, base + ".svg"))   # the .svg last: it is what makes it a drawing
    return base


def library_delete(folder, base):
    """Move a drawing into .deleted/. False if there is no such drawing."""
    if not LIBRARY_NAME.match(base or "") or not os.path.exists(os.path.join(folder, base + ".svg")):
        return False
    bin_ = os.path.join(folder, ".deleted")
    os.makedirs(bin_, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for ext in (".svg", ".png"):
        src = os.path.join(folder, base + ext)
        if os.path.exists(src):
            os.replace(src, os.path.join(bin_, f"{base} · deleted {stamp}{ext}"))
    return True


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
        if r == "no board":
            return False, "No board: the motors were not reached, nothing saved.", None
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


def arm_zero():
    try:
        with open(FILES["/calibration"], encoding="utf-8") as f:
            z = json.load(f).get("arm") or {}
        return {k: int(z.get(k, v)) for k, v in ARM_ZERO.items()}
    except (OSError, ValueError, TypeError):
        return dict(ARM_ZERO)


ARM = Arm(board_get, arm_zero)
RUNNER = Runner(board_get, arm=ARM)
PARK = Park(PARK_FILE, board_get)


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
        if u.path == "/library":
            return self.reply(200, json.dumps(library_list(LIBRARY_DIR)), "application/json")
        if u.path.startswith("/library/"):
            # a drawing or its preview, by its library name only
            base, ext = os.path.splitext(unquote(u.path[len("/library/"):]))
            f = os.path.join(LIBRARY_DIR, base + ext)
            if ext not in (".svg", ".png") or not LIBRARY_NAME.match(base) or not os.path.exists(f):
                return self.reply(404, "no such drawing")
            with open(f, "rb") as fh:
                return self.reply(200, fh.read(), "image/svg+xml" if ext == ".svg" else "image/png")
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
        answer = board_get(cmd + ("?" + u.query if u.query else ""))
        return self.reply(200, answer, board="ok" if BOARD is not None and BOARD.ser is not None else "lost")

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/library":
            # 💾 SAVE on the Create tab: {"svg": the drawing, "png": its preview as a data URL}
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)))
                base = library_save(LIBRARY_DIR, body.get("svg"), body.get("png"))
            except (ValueError, TypeError, AttributeError) as e:
                return self.reply(400, json.dumps({"ok": False, "message": str(e) or "not a drawing"}), "application/json")
            return self.reply(200, json.dumps({"ok": True, "file": base, "name": library_display(base)}), "application/json")
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

    def do_DELETE(self):
        path = unquote(urlparse(self.path).path)
        if not path.startswith("/library/"):
            return self.reply(404, "")
        ok = library_delete(LIBRARY_DIR, path[len("/library/"):])
        return self.reply(200 if ok else 404, "moved to library/.deleted" if ok else "no such drawing")

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
            # The Calibration tab saves the corners with whatever arm zero it
            # loaded; a tab opened before the arm zero changed would put the
            # old one back (2026-09-30: the wrist's zero was set right while
            # the tab was open). The arm zero is never the page's: keep the file's.
            new = json.loads(body)
            try:
                with open(path, encoding="utf-8") as f:
                    old = json.load(f)
            except (OSError, ValueError):
                old = {}
            if "arm" in old:
                new["arm"] = old["arm"]
            else:
                new.pop("arm", None)
            body = json.dumps(new, indent=2).encode("utf-8")
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, path)
        return self.reply(200, "saved")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)   # the port first: a second copy stops here
    BOARD = Board()
    BOARD.start()
    print(f"RUBENS: http://localhost:{PORT}  (the board on USB, {PORT_GLOB})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
