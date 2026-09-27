#!/usr/bin/env python3
"""RUBENS server: serves this folder on http://localhost:8766 and talks to
the machine through its bridge (Rubens_v2.md, section 6).

- Static files: the Paint page (index.html), Calibration (calibration.html)
  and Job (job.html).
- /machine/<command> goes to the machine bridge (RAIL-drawing_machine,
  bridge.py, port 8765), which stays the only owner of the serial port.
  Only the commands in PASS get through: the ping, the look, the axes, and
  the axis zero. The arm is not among them.
- /calibration and /job: GET returns calibration.json / job.json, PUT saves
  it. The Job tab writes job.json — the job in mm, in the order it runs.

Run:  python3 rubens.py
Listens on this Mac only: the machine is driven from here, not from the
network.
"""

import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8766
BRIDGE = "http://127.0.0.1:8765"
FILES = {"/calibration": os.path.join(HERE, "calibration.json"), "/job": os.path.join(HERE, "job.json")}
PASS = {"/ping", "/look", "/cmd", "/origin/x", "/origin/y"}


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
