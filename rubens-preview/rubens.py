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
- /run: the runner (class Runner) — GET is its state; POST starts the machine
  blocks of job.json; POST /run/stop brakes along the path, /run/kill stops at
  once. POST /brush/off and /brush/on swing the wrist to +90° or back to 0°
  (only the wrist, only these two, not while a job runs — the owner asked for
  them on the Job tab, 2026-09-27). It needs the firmware and bridge from
  RAIL-drawing_machine/drafts/rubens-pass (not flashed yet); until then a
  start fails on the first path command and nothing moves.

Run:  python3 rubens.py
Listens on this Mac only: the machine is driven from here, not from the
network.
"""

import json
import os
import re
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8766
BRIDGE = "http://127.0.0.1:8765"
FILES = {"/calibration": os.path.join(HERE, "calibration.json"), "/job": os.path.join(HERE, "job.json")}
PASS = {"/ping", "/look", "/cmd", "/origin/x", "/origin/y"}
STEPS_PER_MM = (80.0, 3200.0 / 120.0)   # X, Y — the same as src/machine.js


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

    def __init__(self, send, sleep=time.sleep, swing_s=1.8):
        self.send, self.sleep, self.swing_s = send, sleep, swing_s
        self.lock = threading.Lock()
        self.state, self.message = "idle", ""
        self.blocks, self.block = [], 0
        self.paint_total = self.painted = 0.0
        self.pos = None                  # last ping: {"x", "y", "path"}
        self.brush_on = False
        self._stop = None                # None, "S" or "K"

    def status(self):
        with self.lock:
            pct = 100.0 * self.painted / self.paint_total if self.paint_total else 0.0
            pos = self.pos or {}
            mm = lambda a, i: None if pos.get(a) is None else pos[a] / STEPS_PER_MM[i]
            return {"state": self.state, "message": self.message, "block": self.block,
                    "blocks": len(self.blocks), "painted_mm": round(self.painted, 1),
                    "paint_mm": round(self.paint_total, 1), "percent": round(pct, 1),
                    "x_mm": mm("x", 0), "y_mm": mm("y", 1), "brush_on": self.brush_on}

    def start(self, blocks):
        with self.lock:
            if self.state in ("running", "stopping"):
                return False, "already running"
            self.blocks, self.block, self.painted = list(blocks), 0, 0.0
            self.paint_total = sum(b.get("paintMM") or 0 for b in blocks if b.get("kind") == "move")
            self.state, self.message, self._stop = "running", "", None
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()
        return True, "started"

    def stop(self, hard=False):
        with self.lock:
            if self.state != "running":
                return
            self._stop = "K" if hard else "S"
            self.state = "stopping"
        self.send("/cmd?a=K&n=0" if hard else "/cmd?a=S&n=0")

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
            for i, b in enumerate(self.blocks):
                if self._stop:
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
        r = self.send(f"/servo?j=wrist&d={deg}")
        if not r.startswith("ok J"):
            raise Abort(f"{cmd}: {r}")
        self.brush_on = deg == 0
        self._wait(self.swing_s)

    def _raw(self, cmd):
        return self.send("/raw?c=" + quote(cmd))

    def _go(self):
        r = self._raw("G")
        if r != "ok G":
            raise Abort(f"G: {r}")

    def _move(self, b):
        pieces = [c for c in b["cmds"] if c != "G"]
        total = sum(1 for c in pieces if c[0] in "LAM")
        base, share = self.painted, b.get("paintMM") or 0
        started, sent = False, 0
        for c in pieces:
            while True:
                if self._stop:
                    return self._finish(started)
                r = self._raw(c)
                if r.startswith("ok "):
                    break
                if "очередь полна" in r:
                    if not started:
                        self._go()
                        started = True
                    self._wait(0.1)
                    continue
                raise Abort(f"{c}: {r}")
            if c[0] in "LAM":
                sent += 1
                room = int(r.split()[-1])
                if room == 0 and not started:
                    self._go()
                    started = True
        if not started:
            self._go()
        self._finish(True, base, share, sent, total)

    def _finish(self, started, base=None, share=0, sent=0, total=0):
        # the block is over when the board no longer reports a path
        while started:
            p = self._ping()
            if p is None:
                raise Abort("lost the board")
            if p["path"] is None:
                break
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


def bridge_get(path):
    try:
        with urlopen(BRIDGE + path, timeout=3) as r:
            return r.read().decode("utf-8", "replace").strip()
    except HTTPError as e:
        return f"bridge answers {e.code} to {urlparse(path).path}"
    except (URLError, OSError):
        return "no bridge"


RUNNER = Runner(bridge_get)


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
        url = BRIDGE + cmd + ("?" + u.query if u.query else "")
        try:
            with urlopen(url, timeout=3) as r:
                return self.reply(200, r.read(), board=r.headers.get("X-Board", "ok"))
        except (URLError, OSError):
            return self.reply(502, "no bridge", board="none")

    def do_POST(self):
        path = urlparse(self.path).path
        if path in ("/brush/off", "/brush/on"):
            if RUNNER.state in ("running", "stopping"):
                return self.reply(409, "a job is running")
            deg = 90 if path == "/brush/off" else 0
            r = bridge_get(f"/servo?j=wrist&d={deg}")
            if r.startswith("ok J"):
                RUNNER.brush_on = deg == 0
            return self.reply(200, r)
        if path == "/run/stop":
            RUNNER.stop()
            return self.reply(200, "ok")
        if path == "/run/kill":
            RUNNER.stop(hard=True)
            return self.reply(200, "ok")
        if path != "/run":
            return self.reply(404, "")
        try:
            with open(FILES["/job"], encoding="utf-8") as f:
                blocks = json.load(f)["machine"]["blocks"]
        except (OSError, ValueError, KeyError, TypeError):
            return self.reply(400, "job.json has no machine blocks: record the canvas corners, then Save job.json")
        ok, msg = RUNNER.start(blocks)
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
